const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const fsSync = require('fs') // callback API — needed for fs.watch (gate queue watcher)
const http = require('http')
const { atomicWrite } = require('./gate/utils')
const { loadOrCreateSecret, sign, confinePath } = require('./gate/security')
const {
  validateDecisionInput,
  MAX_ARTIFACT_COUNT,
  MAX_ARTIFACT_SIZE_BYTES,
} = require('./gate/schema')
const {
  ensureGateDirs,
  listPendingRequests,
  listArchivedReviews,
  readRequest,
  writeDecision,
  archiveReview,
  appendAuditEntry,
} = require('./gate/bus')
const scaffoldEngine = require('./scaffold/engine')
const { runDoctor } = require('./scaffold/doctor')
const { MCP_CATALOG, SKILLS_CATALOG } = require('./scaffold/catalog')

const isDev = process.env.NODE_ENV === 'development'
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode')

// Prevent "Unable to move the cache: Access is denied" errors on Windows.
// Electron/Chromium tries to relocate its GPU shader disk cache on startup;
// if the temp directory isn't writable (corporate policy, AV quarantine, etc.)
// it logs repeated errors.  Disabling the cache entirely is the safest fix.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

let mainWindow

// ── Gate (review queue) module-level state ──────────────────────────────────────
// The HMAC secret is loaded once from app.getPath('userData') (NOT configDir) so
// the gate tool's verify() matches sign() byte-for-byte. Watcher/fallback timers
// are tracked here so they can be torn down on window close / config-path change.
let gateSecret = null
let gateWatcher = null
let gateWatchDebounce = null
let gatePollInterval = null
let gateRetryTimeout = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:2149')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Tear down the gate watcher + any fallback timers when the window goes away.
  mainWindow.on('closed', () => {
    stopGateWatcher()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  setupContentSecurityPolicy()
  createWindow()
  initGate()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Strict Content-Security-Policy so untrusted artifact content rendered in the
// Review Queue can neither run inline script nor reach the network. Inline STYLE
// is allowed (React/Vite inject style attributes); inline SCRIPT and eval are
// not. In dev we relax script/connect for Vite's HMR (inline bootstrap + ws).
// This does NOT weaken contextIsolation/nodeIntegration — those stay hardened.
function setupContentSecurityPolicy() {
  const policy = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
      + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
      + "connect-src 'self' ws://localhost:2149 http://localhost:2149; "
      + "object-src 'none'; base-uri 'self'; frame-src 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
      + "object-src 'none'; base-uri 'self'; frame-src 'none'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

// ── Gate init + watcher ─────────────────────────────────────────────────────────

// Load the signing secret (from userData) and bootstrap the .gate/ dirs, THEN
// start the watcher (sequenced after ensureGateDirs so requests/ exists).
async function initGate() {
  try {
    gateSecret = await loadOrCreateSecret(app.getPath('userData'))
  } catch (err) {
    console.error('gate: failed to load signing secret:', err.message)
  }
  try {
    const configDir = await getConfigDir()
    await ensureGateDirs(configDir)
    startGateWatcher(configDir)
  } catch (err) {
    console.error('gate: failed to init dirs/watcher:', err.message)
  }
}

function pushGateUpdate(payload) {
  mainWindow?.webContents?.send('gate:updated', payload)
}

function stopGateWatcher() {
  if (gateWatcher) {
    try { gateWatcher.close() } catch { /* already closed */ }
    gateWatcher = null
  }
  if (gateWatchDebounce) { clearTimeout(gateWatchDebounce); gateWatchDebounce = null }
  if (gatePollInterval) { clearInterval(gatePollInterval); gatePollInterval = null }
  if (gateRetryTimeout) { clearTimeout(gateRetryTimeout); gateRetryTimeout = null }
}

// Fallback when fs.watch is unsupported/fails (spec edge case 10): poll-push every
// 3s so the renderer still live-updates, and retry establishing a real watch after
// 30s (cheaper than polling forever if the platform recovers).
// fs.watch can fail under AV/corporate policy on Windows, so polling keeps the queue live.
function startGatePollingFallback(configDir) {
  if (!gatePollInterval) {
    gatePollInterval = setInterval(() => {
      pushGateUpdate({ type: 'queue-changed' })
    }, 3000)
  }
  if (!gateRetryTimeout) {
    gateRetryTimeout = setTimeout(() => {
      gateRetryTimeout = null
      if (gatePollInterval) { clearInterval(gatePollInterval); gatePollInterval = null }
      startGateWatcher(configDir)
    }, 30000)
  }
}

// Watch <configDir>/.gate/requests/ (non-recursive). On change/rename, debounce
// 500ms then push a 'queue-changed' event. On watch error/throw, fall back to
// interval polling. NOTE: configDir can change via config:set-path — that handler
// re-invokes startGateWatcher with the new dir, so the watcher always tracks the
// active configDir.
function startGateWatcher(configDir) {
  stopGateWatcher()
  const requestsDir = path.join(configDir, '.gate', 'requests')
  try {
    gateWatcher = fsSync.watch(requestsDir, { recursive: false }, () => {
      if (gateWatchDebounce) clearTimeout(gateWatchDebounce)
      gateWatchDebounce = setTimeout(() => {
        gateWatchDebounce = null
        pushGateUpdate({ type: 'queue-changed' })
      }, 500)
    })
    gateWatcher.on('error', (err) => {
      console.warn('gate: watcher error, falling back to polling:', err.message)
      if (gateWatcher) {
        try { gateWatcher.close() } catch { /* already closed */ }
        gateWatcher = null
      }
      startGatePollingFallback(configDir)
    })
  } catch (err) {
    console.warn('gate: failed to start watcher, falling back to polling:', err.message)
    startGatePollingFallback(configDir)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

async function getConfigDir() {
  try {
    const prefsPath = await getPrefsPath()
    const raw = await fs.readFile(prefsPath, 'utf8')
    const prefs = JSON.parse(raw)
    return prefs.configDir || DEFAULT_CONFIG_DIR
  } catch {
    return DEFAULT_CONFIG_DIR
  }
}

function parseAgentFile(content) {
  // Extract raw frontmatter block
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const fm = {}
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key) fm[key] = val
    }
    // Parse YAML list items (  - "value") for required_mcp_servers and required_env_vars
    const listFields = { required_mcp_servers: [], required_env_vars: [] }
    let currentListKey = null
    for (const line of fmMatch[1].split('\n')) {
      const listKeyMatch = line.match(/^(required_mcp_servers|required_env_vars)\s*:/)
      if (listKeyMatch) { currentListKey = listKeyMatch[1]; continue }
      if (currentListKey && line.match(/^\s+[-*]\s+/)) {
        listFields[currentListKey].push(line.replace(/^\s+[-*]\s+/, '').replace(/^["']|["']$/g, '').trim())
      } else if (!line.startsWith(' ') && !line.startsWith('\t')) {
        currentListKey = null
      }
    }
    fm.required_mcp_servers = listFields.required_mcp_servers
    fm.required_env_vars    = listFields.required_env_vars
  }

  // Strip frontmatter from body
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')

  // Extract ## Responsibilities bullet points
  const responsibilitiesMatch = body.match(/##\s*Responsibilities\s*\n([\s\S]*?)(?=\n##|\n#|$)/)
  const responsibilities = []
  if (responsibilitiesMatch) {
    const bullets = responsibilitiesMatch[1].match(/^[-*]\s+(.+)$/gm)
    if (bullets) responsibilities.push(...bullets.map(b => b.replace(/^[-*]\s+/, '').trim()))
  }

  // Extract ## Workflow bullet points (for orchestrator, which has no Responsibilities)
  if (responsibilities.length === 0) {
    const workflowMatch = body.match(/##\s*Workflow\s*\n([\s\S]*?)(?=\n##|\n#|$)/)
    if (workflowMatch) {
      const bullets = workflowMatch[1].match(/^\d+\.\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/gm)
      if (bullets) {
        responsibilities.push(...bullets.map(b => {
          const m = b.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/)
          return m ? `${m[1]}: ${m[2]}` : b.replace(/^\d+\.\s+/, '')
        }))
      }
    }
  }

  // Extract ## Rules bullet points (extra detail)
  const rulesMatch = body.match(/##\s*Rules\s*\n([\s\S]*?)(?=\n##|\n#|$)/)
  const rules = []
  if (rulesMatch) {
    const bullets = rulesMatch[1].match(/^[-*]\s+(.+)$/gm)
    if (bullets) rules.push(...bullets.map(b => b.replace(/^[-*]\s+/, '').trim()))
  }

  return {
    name:                 fm.name ?? '',
    description:          fm.description ?? '',
    version:              fm.version ?? '',
    mode:                 fm.mode ?? '',
    required_mcp_servers: fm.required_mcp_servers ?? [],
    required_env_vars:    fm.required_env_vars ?? [],
    responsibilities:     responsibilities.slice(0, 5),
    rules:                rules.slice(0, 3),
  }
}

// Parse a skill markdown file into { name, description }.
// Supports YAML frontmatter (name/description) and falls back to the first
// "# Heading" and the first non-empty paragraph below it.
function parseSkillFile(content) {
  let name = ''
  let description = ''

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  let body = content
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key === 'name') name = val
      else if (key === 'description') description = val
    }
    body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
  }

  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m)
    if (h1) name = h1[1].trim()
  }
  if (!description) {
    // First non-empty, non-heading line
    for (const line of body.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || t.startsWith('---')) continue
      description = t.replace(/[*_`]/g, '')
      break
    }
  }
  return { name, description }
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.setTimeout(options.timeout || 5000, () => req.destroy(new Error('timeout')))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ── Window Controls ───────────────────────────────────────────────────────────

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())

// ── Config Path ───────────────────────────────────────────────────────────────

ipcMain.handle('config:get-path', async () => {
  return await getConfigDir()
})

ipcMain.handle('config:set-path', async (_event, dirPath) => {
  const prefsPath = await getPrefsPath()
  await fs.writeFile(prefsPath, JSON.stringify({ configDir: dirPath }, null, 2), 'utf8')
  // Re-point the gate bus + watcher at the new configDir.
  try {
    await ensureGateDirs(dirPath)
    startGateWatcher(dirPath)
  } catch (err) {
    console.warn('gate: failed to re-init for new config path:', err.message)
  }
  return dirPath
})

ipcMain.handle('config:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select OpenCode Config Directory',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ── Config Read ───────────────────────────────────────────────────────────────
// Reads opencode.jsonc for model assignments + agents/*.agent.md for display metadata
// Returns: { configDir, defaultModel, ollamaProviderModels, agents: AgentEntry[] }

ipcMain.handle('config:read', async () => {
  const configDir = await getConfigDir()

  // 1. Parse opencode.jsonc
  let parsed = {}
  try {
    const jsoncPath = path.join(configDir, 'opencode.jsonc')
    const raw = await fs.readFile(jsoncPath, 'utf8')
    const { default: strip } = await import('strip-json-comments')
    parsed = JSON.parse(strip(raw))
  } catch { /* config may not exist yet */ }

  // 2. Read agent .agent.md files — parse full metadata
  const agentMeta = {}
  try {
    const agentsDir = path.join(configDir, 'agents')
    const files = await fs.readdir(agentsDir)
    for (const file of files) {
      if (!file.endsWith('.agent.md')) continue
      const content = await fs.readFile(path.join(agentsDir, file), 'utf8')
      const parsed = parseAgentFile(content)
      const agentId = file.replace('.agent.md', '')
      agentMeta[agentId] = parsed
    }
  } catch { /* no agents dir */ }

  // 3. Build AgentEntry[] from opencode.jsonc agent section
  const agentConfig = parsed.agent || {}
  const agents = Object.entries(agentConfig).map(([id, cfg]) => {
    const extra = { ...cfg }
    // Remove all fields that are now explicitly handled so they don't double-write
    for (const k of ['model', 'disable', 'mode', 'description', 'prompt',
                     'maxTokens', 'maxSteps', 'options', 'tools', 'permission', 'variant', 'color']) {
      delete extra[k]
    }
    const meta = agentMeta[id] || {}

    // Derive tool capabilities
    const tools = []
    if (cfg.permission?.task === 'allow') tools.push({ id: 'task', label: 'Task Tool', color: '#59a6ff' })
    for (const srv of meta.required_mcp_servers || []) {
      tools.push({ id: `mcp-${srv}`, label: srv, color: '#d19921' })
    }
    for (const env of meta.required_env_vars || []) {
      tools.push({ id: `env-${env}`, label: env, color: '#8c919e' })
    }

    return {
      id,
      displayName:      meta.name        || id,
      description:      cfg.description  || meta.description || '',
      version:          meta.version     || '',
      mode:             cfg.mode         || meta.mode        || '',
      responsibilities: meta.responsibilities || [],
      rules:            meta.rules || [],
      tools:            cfg.tools      ?? {},
      model:            cfg.model      ?? null,
      variant:          cfg.variant    ?? null,
      color:            cfg.color      ?? null,
      prompt:           cfg.prompt     ?? null,
      maxTokens:        cfg.maxTokens  ?? null,
      maxSteps:         cfg.maxSteps   ?? null,
      options:          cfg.options    ?? {},
      permission:       cfg.permission ?? {},
      disabled:         cfg.disable === true,
      _extra:           extra,
    }
  })

  return {
    configDir,
    defaultModel: parsed.model ?? 'anthropic/claude-sonnet-4-6',
    ollamaProviderModels: parsed.provider?.ollama?.models ?? {},
    agents,
  }
})

// ── Config Write ──────────────────────────────────────────────────────────────
// Writes the full opencode.jsonc atomically. Preserves $schema, provider block,
// and any unknown per-agent fields (like "permission").

ipcMain.handle('config:write', async (_event, { agents, defaultModel, ollamaProviderModels }) => {
  const configDir = await getConfigDir()
  const configPath = path.join(configDir, 'opencode.jsonc')
  const tmpPath = configPath + '.tmp'

  // Recover the existing config so we can preserve $schema AND unknown top-level
  // fields (e.g. the `mcp` block written by the scaffolder / gate setup, or extra
  // providers). Without this, a Save would clobber scaffolded MCP entries.
  let existing = {}
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const { default: strip } = await import('strip-json-comments')
    const parsed = JSON.parse(strip(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed
  } catch { /* no existing config */ }
  const schema = existing['$schema'] || 'https://opencode.ai/config.json'

  // Build agent block — persist all schema fields
  const agentBlock = {}
  for (const a of agents) {
    if (a.disabled) {
      agentBlock[a.id] = { disable: true }
    } else {
      const entry = {}
      // Core identity / behaviour
      if (a.mode)        entry.mode        = a.mode
      if (a.model)       entry.model       = a.model
      if (a.description) entry.description = a.description
      if (a.prompt)      entry.prompt      = a.prompt
      if (a.maxTokens != null) entry.maxTokens = a.maxTokens
      if (a.maxSteps  != null) entry.maxSteps  = a.maxSteps
      if (a.variant) entry.variant = a.variant
      // UI-only metadata: the accent colour shown on the agent card in the overview
      if (a.color) entry.color = a.color
      // Model options (temperature, topP, reasoningEffort, thinking)
      if (a.options && Object.keys(a.options).length > 0) {
        const opts = {}
        for (const [k, v] of Object.entries(a.options)) {
          if (v !== null && v !== undefined) opts[k] = v
        }
        if (Object.keys(opts).length > 0) entry.options = opts
      }
      // Tool overrides
      if (a.tools && Object.keys(a.tools).length > 0) entry.tools = a.tools
      // Permission overrides
      if (a.permission && Object.keys(a.permission).length > 0) entry.permission = a.permission
      // Any remaining extra fields not explicitly handled above
      if (a._extra) {
        for (const [k, v] of Object.entries(a._extra)) {
          if (!(k in entry)) entry[k] = v
        }
      }
      agentBlock[a.id] = entry
    }
  }

  // Spread existing first so unknown top-level fields (incl. `mcp` and any other
  // providers) survive; then layer the blocks this handler owns on top.
  const config = {
    ...existing,
    $schema: schema,
    provider: {
      ...(existing.provider || {}),
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama (local)',
        options: { baseURL: 'http://localhost:11434/v1' },
        models: ollamaProviderModels || {},
      },
    },
    model: defaultModel,
    agent: agentBlock,
  }

  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf8')
  await fs.rename(tmpPath, configPath)
  return { success: true }
})

// ── Agent File Create ─────────────────────────────────────────────────────────
// Writes a new {agentId}.agent.md to {configDir}/agents/ with frontmatter

ipcMain.handle('agent:create-file', async (_event, { agentId, agentData }) => {
  const configDir = await getConfigDir()
  const agentsDir = path.join(configDir, 'agents')
  await fs.mkdir(agentsDir, { recursive: true })

  const lines = ['---']
  if (agentData.name)        lines.push(`name: ${agentData.name}`)
  if (agentData.description) lines.push(`description: ${agentData.description}`)
  if (agentData.version)     lines.push(`version: ${agentData.version}`)
  if (agentData.mode)        lines.push(`mode: ${agentData.mode}`)
  lines.push('---')
  if (agentData.prompt)      lines.push('', agentData.prompt)

  const content = lines.join('\n')
  await fs.writeFile(path.join(agentsDir, `${agentId}.agent.md`), content, 'utf8')
  return { success: true }
})

// ── Agent File Read/Write (raw markdown) ──────────────────────────────────────
// Reads/writes the full raw {agentId}.agent.md so the user can edit the agent's
// markdown (frontmatter + body) exactly as it sits on disk.

ipcMain.handle('agent:read-file', async (_event, agentId) => {
  const configDir = await getConfigDir()
  const filePath = path.join(configDir, 'agents', `${agentId}.agent.md`)
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return { exists: true, content, path: filePath }
  } catch {
    return { exists: false, content: '', path: filePath }
  }
})

ipcMain.handle('agent:write-file', async (_event, { agentId, content }) => {
  const configDir = await getConfigDir()
  const agentsDir = path.join(configDir, 'agents')
  await fs.mkdir(agentsDir, { recursive: true })
  const filePath = path.join(agentsDir, `${agentId}.agent.md`)
  try {
    await atomicWrite(filePath, content ?? '')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── Skills ────────────────────────────────────────────────────────────────────
// Lists skills found in the config dir. Supports two layouts:
//   <configDir>/skill(s)/<name>.md
//   <configDir>/skill(s)/<name>/SKILL.md
// Returns [{ id, name, description, path }].

ipcMain.handle('skills:list', async () => {
  const configDir = await getConfigDir()
  const skills = []
  const seen = new Set()

  for (const dirName of ['skill', 'skills']) {
    const skillsDir = path.join(configDir, dirName)
    let entries
    try {
      entries = await fs.readdir(skillsDir, { withFileTypes: true })
    } catch {
      continue // directory doesn't exist
    }

    for (const entry of entries) {
      let id = null
      let filePath = null

      if (entry.isFile() && entry.name.endsWith('.md')) {
        id = entry.name.replace(/\.md$/, '')
        filePath = path.join(skillsDir, entry.name)
      } else if (entry.isDirectory()) {
        // Look for SKILL.md (case-insensitive) or <dir>.md inside the folder
        const subDir = path.join(skillsDir, entry.name)
        try {
          const subFiles = await fs.readdir(subDir)
          const skillMd = subFiles.find((f) => /^skill\.md$/i.test(f))
            || subFiles.find((f) => f === `${entry.name}.md`)
            || subFiles.find((f) => f.endsWith('.md'))
          if (skillMd) {
            id = entry.name
            filePath = path.join(subDir, skillMd)
          }
        } catch { /* skip */ }
      }

      if (!id || !filePath || seen.has(id)) continue
      seen.add(id)

      let meta = {}
      try {
        meta = parseSkillFile(await fs.readFile(filePath, 'utf8'))
      } catch { /* unreadable */ }

      skills.push({
        id,
        name: meta.name || id,
        description: meta.description || '',
        path: filePath,
      })
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills }
})

// ── Ollama ────────────────────────────────────────────────────────────────────

ipcMain.handle('ollama:list-models', async () => {
  try {
    const result = await httpRequest({
      hostname: '127.0.0.1', port: 11434,
      path: '/api/tags', method: 'GET', timeout: 5000,
    })
    return { connected: true, models: result.models || [] }
  } catch {
    return { connected: false, models: [] }
  }
})

ipcMain.handle('ollama:get-model-detail', async (_event, modelName) => {
  try {
    const result = await httpRequest(
      { hostname: '127.0.0.1', port: 11434, path: '/api/show', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
      { name: modelName }
    )
    const ctxLength = result.model_info?.['llama.context_length']
      ?? result.model_info?.['phi3.context_length']
      ?? null
    // capabilities is an array of strings e.g. ["completion", "thinking", "tools"]
    const capabilitiesArray = result.capabilities ?? []
    return { success: true, contextLength: ctxLength, capabilities: capabilitiesArray }
  } catch {
    return { success: false, capabilities: [] }
  }
})

// ── System Info ───────────────────────────────────────────────────────────────

ipcMain.handle('system:get-info', async () => {
  try {
    const si = require('systeminformation')
    const [mem, cpu, graphics] = await Promise.all([
      si.mem(), si.cpu(), si.graphics(),
    ])
    const gpu = graphics.controllers?.[0]
    const totalVramMb = gpu?.vram || 0
    const usedVramMb = gpu?.memoryUsed || 0
    return {
      ram: {
        total: Math.round(mem.total / 1073741824),
        used: Math.round(mem.active / 1073741824),
      },
      cpu: {
        brand: cpu.brand || 'Unknown CPU',
        cores: cpu.physicalCores || cpu.cores,
        speed: cpu.speed,
      },
      vram: {
        total: Math.round(totalVramMb / 1024),   // GB
        used: Math.round(usedVramMb / 1024),
      },
      gpu: gpu?.model || null,
    }
  } catch (err) {
    return {
      ram: { total: 0, used: 0 },
      cpu: { brand: 'Unknown', cores: 0, speed: 0 },
      vram: { total: 0, used: 0 },
      gpu: null,
      error: err.message,
    }
  }
})

// ── Gate (Review Queue) ─────────────────────────────────────────────────────────
// Trust rule: BOTH the renderer args AND the on-disk request files are untrusted.
// Every handler validates inputs, confines artifact paths, and caps sizes. The
// app is viewer + decider only — it never executes artifact content.

// List pending reviews (requests without a matching decision).
ipcMain.handle('gate:list', async () => {
  const configDir = await getConfigDir()
  await ensureGateDirs(configDir)
  return { reviews: await listPendingRequests(configDir) }
})

// List archived (already-decided) reviews for the History view.
ipcMain.handle('gate:list-archive', async () => {
  const configDir = await getConfigDir()
  await ensureGateDirs(configDir)
  return { reviews: await listArchivedReviews(configDir) }
})

// Read one review: the validated request + the confined, size-capped contents of
// each artifact (as text for inert rendering).
ipcMain.handle('gate:read', async (_event, id) => {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return { error: 'bad-id' }
  }

  const configDir = await getConfigDir()

  let request
  try {
    request = await readRequest(configDir, id)
  } catch (err) {
    // Existing-but-malformed request (parse/validation failure).
    console.warn(`gate: read failed for '${id}': ${err.message}`)
    return { error: 'unavailable' }
  }
  if (!request) return { error: 'not-found' }

  const artifacts = []
  // Cap the number of artifacts loaded regardless of what the request claims.
  for (const art of request.artifacts.slice(0, MAX_ARTIFACT_COUNT)) {
    try {
      const safePath = await confinePath(configDir, art.path)
      const stat = await fs.stat(safePath)
      if (stat.size > MAX_ARTIFACT_SIZE_BYTES) {
        artifacts.push({ kind: art.kind, path: art.path, content: null, error: 'artifact-too-large' })
        continue
      }
      const content = await fs.readFile(safePath, 'utf8')
      artifacts.push({ kind: art.kind, path: art.path, content })
    } catch (err) {
      if (err && err.message === 'path-escape') {
        artifacts.push({ kind: art.kind, path: art.path, content: null, error: 'path-confined' })
      } else {
        artifacts.push({ kind: art.kind, path: art.path, content: null, error: 'unavailable' })
      }
    }
  }

  return { request, artifacts }
})

// Record a human decision: validate input, sign it with the userData secret,
// atomically write the decision, archive the review, and append to the audit log.
ipcMain.handle('gate:decide', async (_event, rawInput) => {
  let input
  try {
    input = validateDecisionInput(rawInput)
  } catch (err) {
    return { success: false, error: err.message }
  }

  if (!gateSecret) {
    return { success: false, error: 'gate-secret-not-loaded' }
  }

  try {
    const configDir = await getConfigDir()
    const decision = {
      id: input.id,
      schemaVersion: 1,
      status: input.status,
      notes: input.notes ?? '',
      decidedAt: new Date().toISOString(),
    }
    // Sign with the SAME secret + sign() the gate tool uses to verify.
    decision.sig = sign(decision, gateSecret)

    await writeDecision(configDir, decision)
    await archiveReview(configDir, decision.id)
    await appendAuditEntry(configDir, {
      id: decision.id,
      status: decision.status,
      decidedAt: decision.decidedAt,
    })

    pushGateUpdate({ type: 'decision-made', id: decision.id })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// One-click wiring: register the gate MCP server + grant the orchestrator the
// submit-for-review tool in opencode.jsonc. Preserves all existing config fields
// (round-tripped through strip-json-comments + parse, mirroring config:write).
ipcMain.handle('gate:setup-mcp-entry', async () => {
  try {
    const configDir = await getConfigDir()
    const userDataPath = app.getPath('userData')
    const serverPath = isDev
      ? path.join(__dirname, '../gate-tool/gate-mcp-server.js')
      : path.join(process.resourcesPath, 'gate-tool/gate-mcp-server.js')

    const configPath = path.join(configDir, 'opencode.jsonc')

    // Read existing config (start from {} if it doesn't exist yet).
    let parsed = {}
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      const { default: strip } = await import('strip-json-comments')
      parsed = JSON.parse(strip(raw))
    } catch { /* no config yet → start fresh */ }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {}

    // Inject/merge the MCP server entry (preserve sibling mcp entries).
    if (!parsed.mcp || typeof parsed.mcp !== 'object' || Array.isArray(parsed.mcp)) parsed.mcp = {}
    parsed.mcp.gate = { type: 'local', command: ['node', serverPath, '--userDataDir', userDataPath], enabled: true }

    // Ensure the orchestrator can call the tool (preserve existing agent config).
    if (!parsed.agent || typeof parsed.agent !== 'object' || Array.isArray(parsed.agent)) parsed.agent = {}
    const orchId = 'agent-orchestrator'
    if (!parsed.agent[orchId] || typeof parsed.agent[orchId] !== 'object' || Array.isArray(parsed.agent[orchId])) {
      parsed.agent[orchId] = {}
    }
    const orch = parsed.agent[orchId]
    if (!orch.tools || typeof orch.tools !== 'object' || Array.isArray(orch.tools)) orch.tools = {}
    orch.tools['mcp_gate_submit_for_review'] = true

    await atomicWrite(configPath, JSON.stringify(parsed, null, 2))
    return { success: true, serverPath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── Project Scaffolding Tool ────────────────────────────────────────────────
// The scaffolder ALWAYS targets the active workspace (getConfigDir()) — there is
// no folder argument (spec §8). Writes are confined to that root, so one client's
// secrets can never leak into another's.

// Resolve the bundled obsidian-project-memory template per dev/prod. Exposed to
// the engine via SCAFFOLD_TEMPLATE_DIR so the engine stays Electron-free.
function getTemplateDir() {
  return isDev
    ? path.join(__dirname, '..', 'obsidian-project-memory')
    : path.join(process.resourcesPath, 'obsidian-project-memory')
}

// True when the active workspace is the global OpenCode config dir — the
// scaffolder must never run there (spec §10 edge case 1).
function isGlobalConfigDir(dir) {
  return path.resolve(dir) === path.resolve(DEFAULT_CONFIG_DIR)
}

// Catalog for the form — strip nothing; descriptors are already serializable.
ipcMain.handle('scaffold:catalog', async () => {
  return { mcp: MCP_CATALOG, skills: SKILLS_CATALOG }
})

// Header/guard info: the project root, display name, and whether scaffolding is
// allowed (disabled when pointed at the global config).
ipcMain.handle('scaffold:target-info', async () => {
  const root = await getConfigDir()
  let isGit = false
  try {
    await fs.access(path.join(root, '.git'))
    isGit = true
  } catch { /* not a git repo */ }
  return {
    root,
    name: path.basename(root) || root,
    isGlobal: isGlobalConfigDir(root),
    isGit,
  }
})

// Dry run — what would be created vs skipped (powers the live preview). No writes.
ipcMain.handle('scaffold:preview', async (_event, selections) => {
  try {
    const root = await getConfigDir()
    if (isGlobalConfigDir(root)) return { error: 'global-config' }
    return await scaffoldEngine.preview(root, selections || {}, { MCP_CATALOG, SKILLS_CATALOG })
  } catch (err) {
    return { error: err.message }
  }
})

// Execute the scaffold against the active workspace.
ipcMain.handle('scaffold:sync', async (_event, selections) => {
  try {
    const root = await getConfigDir()
    if (isGlobalConfigDir(root)) return { error: 'global-config' }
    process.env.SCAFFOLD_TEMPLATE_DIR = getTemplateDir()
    const result = await scaffoldEngine.sync(root, selections || {}, { MCP_CATALOG, SKILLS_CATALOG })
    return { success: true, ...result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Re-runnable diagnostics (spec §9) for the post-scaffold summary panel.
ipcMain.handle('scaffold:doctor', async (_event, selections) => {
  try {
    const root = await getConfigDir()
    if (isGlobalConfigDir(root)) return { error: 'global-config' }
    return await runDoctor(root, selections || {}, { MCP_CATALOG, SKILLS_CATALOG })
  } catch (err) {
    return { error: err.message }
  }
})
