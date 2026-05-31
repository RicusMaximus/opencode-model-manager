const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const http = require('http')

const isDev = process.env.NODE_ENV === 'development'
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode')

// Prevent "Unable to move the cache: Access is denied" errors on Windows.
// Electron/Chromium tries to relocate its GPU shader disk cache on startup;
// if the temp directory isn't writable (corporate policy, AV quarantine, etc.)
// it logs repeated errors.  Disabling the cache entirely is the safest fix.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

let mainWindow

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
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

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
                     'maxTokens', 'maxSteps', 'options', 'tools', 'permission']) {
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

  // Recover schema URL from existing file
  let schema = 'https://opencode.ai/config.json'
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const { default: strip } = await import('strip-json-comments')
    const existing = JSON.parse(strip(raw))
    schema = existing['$schema'] || schema
  } catch { /* use default */ }

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

  const config = {
    $schema: schema,
    provider: {
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
    return { success: true, contextLength: ctxLength }
  } catch {
    return { success: false }
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
