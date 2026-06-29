// Project Scaffolding Tool — core engine (spec §7).
//
// CommonJS, no Electron imports, so the whole engine is unit-testable under
// vitest (node env) against a temp dir — mirrors electron/gate/bus.js.
//
// Split into three layers:
//   1. computePlan(selections, catalog)        — PURE. What should exist.
//   2. mergeConfig(existingConfig, plan)        — PURE. The opencode.jsonc result.
//   3. sync()/preview()                         — filesystem effects, built on (1)+(2).
//
// Hard rules enforced here (spec §7.4):
//   • never overwrite an existing real secret file (create-if-missing)
//   • never clobber opencode.jsonc (deep-merge, preserve $schema + unknown fields)
//   • no trailing newline in secret / .example files ({file:} is literal)
//   • real secret files chmod 0600 where the OS supports it
//   • .gitignore is authoritative; re-run is additive (skip what exists)

const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')

const SECRETS_DIR = '.opencode-secrets'
const GITIGNORE_BEGIN = '# >>> opencode-agent-manager: project secrets (auto-managed) >>>'
const GITIGNORE_END = '# <<< opencode-agent-manager: project secrets <<<'

// ── 1. computePlan — PURE ───────────────────────────────────────────────────
// Resolves every selected capability into a flat plan of artifacts. No I/O, so
// the per-profile generation matrix (spec §12) is testable in isolation.
function computePlan(selections, catalog) {
  const { MCP_CATALOG } = catalog
  const mcpServers = selections.mcpServers || []
  const authProfile = selections.authProfile || {}
  const configValues = selections.configValues || {}

  const servers = []          // { id, profile, descriptor, profileSpec }
  const secretInputs = []     // per (server,input) — drives {file:} env refs
  const configInline = []     // { serverId, envVar, value, required }
  const external = []         // { serverId, via, note, check }
  const missingConfigValues = []

  for (const id of mcpServers) {
    const descriptor = MCP_CATALOG[id]
    if (!descriptor) continue
    const profileId = authProfile[id] || descriptor.defaultAuthProfile
    const profileSpec = descriptor.authProfiles[profileId]
    if (!profileSpec) continue
    servers.push({ id, profile: profileId, descriptor, profileSpec })

    for (const input of profileSpec.inputs) {
      if (input.kind === 'secret') {
        secretInputs.push({
          serverId: id,
          envVar: input.envVar,
          fileName: input.fileName,
          placeholder: input.placeholder,
          required: !!input.required,
          source: input.source,
          validate: input.validate,
        })
      } else if (input.kind === 'config') {
        const value =
          input.defaultValue !== undefined
            ? input.defaultValue
            : configValues[input.envVar]
        if (input.required && (value === undefined || value === '')) {
          missingConfigValues.push({ serverId: id, envVar: input.envVar })
        }
        configInline.push({
          serverId: id,
          envVar: input.envVar,
          value: value ?? '',
          required: !!input.required,
        })
      } else if (input.kind === 'external') {
        external.push({
          serverId: id,
          via: input.via,
          note: input.note,
          check: input.check,
        })
      }
    }
  }

  // Files to create are deduped by fileName (spec §7.4.5 — shared secret = one
  // file, multiple {file:} refs). The env refs above stay per-input.
  const secretFiles = []
  const seenFiles = new Set()
  for (const s of secretInputs) {
    if (seenFiles.has(s.fileName)) continue
    seenFiles.add(s.fileName)
    secretFiles.push({ fileName: s.fileName, placeholder: s.placeholder, required: s.required })
  }

  const skills = (selections.skills || [])
    .map((id) => catalog.SKILLS_CATALOG[id])
    .filter(Boolean)
    .map((s) => ({ id: s.id, name: s.name, body: s.body }))

  return {
    servers,
    secretInputs,
    secretFiles,
    configInline,
    external,
    skills,
    // Copy the user's global agents into the project (resolved at sync/preview
    // time from deps.globalAgentsDir — the listing is I/O so it's not done here).
    includeAgents: !!selections.includeAgents,
    projectMemory: selections.projectMemory
      ? { folder: (selections.memoryFolder || 'project-memory').trim() || 'project-memory' }
      : null,
    specsFolder: !!selections.specsFolder,
    needsSecretsFolder: secretFiles.length > 0,
    missingConfigValues,
  }
}

// List the .agent.md files in a global agents folder. fs.readdir/readFile follow
// symlinks transparently, so a folder that is itself a symlink (or contains
// symlinked files) resolves to the real files — letting us copy real content
// into the project rather than recreating the user's symlink/repo dependency.
async function listAgentFiles(dir) {
  if (!dir) return []
  try {
    const entries = await fs.readdir(dir)
    return entries
      .filter((f) => f.endsWith('.agent.md'))
      .sort()
      .map((f) => ({ name: f, id: f.replace(/\.agent\.md$/, ''), src: path.join(dir, f) }))
  } catch {
    return [] // folder doesn't exist (user has no global agents) → nothing to copy
  }
}

// ── 2. mergeConfig — PURE ───────────────────────────────────────────────────
// Deep-merges the plan's MCP entries into an existing parsed opencode.jsonc
// object. Spreads existing first so $schema, comments-stripped unknown fields,
// sibling mcp entries, and prior agent config all survive (spec §7.4.2).
function mergeConfig(existingConfig, plan) {
  const config =
    existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig)
      ? { ...existingConfig }
      : {}

  config.mcp =
    config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)
      ? { ...config.mcp }
      : {}

  for (const server of plan.servers) {
    const prev =
      config.mcp[server.id] && typeof config.mcp[server.id] === 'object'
        ? config.mcp[server.id]
        : {}

    const environment = { ...(prev.environment || {}) }

    // secret inputs → {file:...} refs (per-input, not deduped)
    for (const s of plan.secretInputs) {
      if (s.serverId !== server.id) continue
      environment[s.envVar] = `{file:./${SECRETS_DIR}/${s.fileName}}`
    }
    // config inputs → inline values
    for (const c of plan.configInline) {
      if (c.serverId !== server.id) continue
      environment[c.envVar] = c.value
    }

    const entry = {
      ...prev,
      type: server.descriptor.transport === 'remote' ? 'remote' : 'local',
      enabled: true,
    }
    if (server.descriptor.transport === 'remote') {
      if (server.descriptor.url) entry.url = server.descriptor.url
    } else if (server.descriptor.command) {
      entry.command = server.descriptor.command
    }
    if (Object.keys(environment).length > 0) entry.environment = environment

    config.mcp[server.id] = entry
  }

  return config
}

// ── filesystem helpers ──────────────────────────────────────────────────────

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Create only if missing. Returns 'created' | 'skipped'. `mode` is best-effort
// (Windows largely ignores POSIX perms; we never let a chmod failure abort).
async function ensureFileIfMissing(filePath, content, { mode } = {}) {
  if (await pathExists(filePath)) return 'skipped'
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  if (mode != null) {
    try {
      await fs.chmod(filePath, mode)
    } catch {
      /* best-effort: unsupported on this OS */
    }
  }
  return 'created'
}

// Always (re)write — used for *.example and the generated README. Returns
// 'created' | 'refreshed' so the summary can distinguish.
async function writeFileAlways(filePath, content) {
  const existed = await pathExists(filePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  return existed ? 'refreshed' : 'created'
}

// Append the authoritative secrets block to .gitignore once (idempotent via
// markers). Returns 'created' | 'updated' | 'present'. (spec §7.4.6)
async function ensureGitignoreBlock(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const block = [
    GITIGNORE_BEGIN,
    `/${SECRETS_DIR}/*`,
    `!/${SECRETS_DIR}/*.example`,
    `!/${SECRETS_DIR}/README.md`,
    GITIGNORE_END,
    '',
  ].join('\n')

  let existing = ''
  const had = await pathExists(gitignorePath)
  if (had) existing = await fs.readFile(gitignorePath, 'utf8')

  if (existing.includes(GITIGNORE_BEGIN)) return 'present'

  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  await fs.writeFile(gitignorePath, existing + sep + block, 'utf8')
  return had ? 'updated' : 'created'
}

// ── secrets README "active matrix" (committed) ──────────────────────────────
function renderSecretsReadme(plan) {
  const lines = [
    '# .opencode-secrets',
    '',
    'Auto-generated by OpenCode Agent Manager. **Real secret values live here but',
    'are git-ignored** — only `*.example` and this README are committed.',
    '',
    'OpenCode does not auto-load `.env`; each secret is surfaced into the MCP',
    "server's environment via `{file:...}` substitution in `opencode.jsonc`.",
    '',
    '## Active matrix',
    '',
    '| Server | Profile | Env var | File |',
    '| --- | --- | --- | --- |',
  ]
  const seen = new Set()
  for (const s of plan.secretInputs) {
    const key = `${s.serverId}:${s.envVar}`
    if (seen.has(key)) continue
    seen.add(key)
    const server = plan.servers.find((sv) => sv.id === s.serverId)
    lines.push(`| ${s.serverId} | ${server ? server.profile : ''} | \`${s.envVar}\` | \`${s.fileName}\` |`)
  }
  if (plan.secretInputs.length === 0) lines.push('| _none_ | | | |')
  lines.push('')
  return lines.join('\n')
}

function renderSpecsReadme() {
  return [
    '# specs',
    '',
    'SDD-style design specs for this project. One markdown file per feature:',
    'goal, problem, design, idempotency/safety rules, edge cases, testing.',
    '',
    'See `TEMPLATE.md` for the house style.',
    '',
  ].join('\n')
}

function renderSpecTemplate() {
  return [
    '# SDD Design Spec — <Feature>',
    '',
    '| | |',
    '|---|---|',
    '| **Status** | Draft |',
    '| **Date** | <YYYY-MM-DD> |',
    '| **Owner** | <name> |',
    '',
    '## 1. Goal',
    '',
    '## 2. Problem',
    '',
    '## 3. Design',
    '',
    '## 4. Idempotency & safety rules',
    '',
    '## 5. Edge cases',
    '',
    '## 6. Testing strategy',
    '',
  ].join('\n')
}

// ── 3. sync — filesystem effects ────────────────────────────────────────────
// Executes the plan against projectRoot. Returns { created, skipped, needsFill,
// warnings }. `deps` is injectable for tests: { readExistingConfig, writeConfig,
// copyTemplate, isGitRepo }.
async function sync(projectRoot, selections, catalog, deps = {}) {
  const plan = computePlan(selections, catalog)
  const created = []
  const skipped = []
  const needsFill = []
  const warnings = []

  const rel = (...p) => path.join(projectRoot, ...p)

  // — secret + .example files —
  if (plan.needsSecretsFolder) {
    await fs.mkdir(rel(SECRETS_DIR), { recursive: true })
  }
  for (const f of plan.secretFiles) {
    const realPath = rel(SECRETS_DIR, f.fileName)
    const examplePath = rel(SECRETS_DIR, `${f.fileName}.example`)
    // Real file: create-if-missing, no trailing newline, 0600 best-effort.
    const realResult = await ensureFileIfMissing(realPath, f.placeholder, { mode: 0o600 })
    ;(realResult === 'created' ? created : skipped).push(`${SECRETS_DIR}/${f.fileName}`)
    // Example file: always present, placeholder content, no trailing newline.
    const exResult = await writeFileAlways(examplePath, f.placeholder)
    if (exResult === 'created') created.push(`${SECRETS_DIR}/${f.fileName}.example`)
    // Unfilled required secret → still needs a real value.
    const current = await fs.readFile(realPath, 'utf8')
    if (f.required && current === f.placeholder) {
      needsFill.push({ file: `${SECRETS_DIR}/${f.fileName}`, envVar: f.fileName })
    }
  }

  // — opencode.jsonc merge (never clobber) —
  const readExistingConfig = deps.readExistingConfig || defaultReadConfig
  const writeConfig = deps.writeConfig || defaultWriteConfig
  const existing = await readExistingConfig(projectRoot)
  const merged = mergeConfig(existing.config, plan)
  await writeConfig(projectRoot, merged)
  ;(existing.existed ? skipped : created).push('opencode.jsonc')
  if (existing.existed) warnings.push('opencode.jsonc existed — merged additively (preserved existing fields).')

  // — config inputs that were left blank —
  for (const m of plan.missingConfigValues) {
    needsFill.push({ envVar: m.envVar, config: true })
  }

  // — skills —
  for (const skill of plan.skills) {
    const skillPath = rel('skill', skill.id, 'SKILL.md')
    const r = await ensureFileIfMissing(skillPath, skill.body)
    ;(r === 'created' ? created : skipped).push(`skill/${skill.id}/SKILL.md`)
  }

  // — agents: copy all .agent.md from the user's global agents folder —
  // Real file contents are copied (create-if-missing) so the project is
  // self-contained; the source symlink/repo is never referenced (spec portability).
  if (plan.includeAgents) {
    const agentFiles = await listAgentFiles(deps.globalAgentsDir)
    if (agentFiles.length === 0) {
      warnings.push('Include agents was on, but no .agent.md files were found in the global agents folder.')
    }
    for (const a of agentFiles) {
      let content
      try {
        content = await fs.readFile(a.src, 'utf8')
      } catch {
        continue // unreadable source file — skip
      }
      const r = await ensureFileIfMissing(rel('agents', a.name), content)
      ;(r === 'created' ? created : skipped).push(`agents/${a.name}`)
    }
  }

  // — Obsidian project-memory vault —
  if (plan.projectMemory) {
    const dest = rel(plan.projectMemory.folder)
    if (await pathExists(dest)) {
      skipped.push(`${plan.projectMemory.folder}/ (vault)`)
    } else {
      const copyTemplate = deps.copyTemplate || defaultCopyTemplate
      await copyTemplate(dest)
      created.push(`${plan.projectMemory.folder}/ (vault)`)
    }
  }

  // — specs/ —
  if (plan.specsFolder) {
    const r1 = await ensureFileIfMissing(rel('specs', 'README.md'), renderSpecsReadme())
    ;(r1 === 'created' ? created : skipped).push('specs/README.md')
    const r2 = await ensureFileIfMissing(rel('specs', 'TEMPLATE.md'), renderSpecTemplate())
    if (r2 === 'created') created.push('specs/TEMPLATE.md')
  }

  // — committed active-matrix README —
  if (plan.needsSecretsFolder) {
    const r = await writeFileAlways(rel(SECRETS_DIR, 'README.md'), renderSecretsReadme(plan))
    if (r === 'created') created.push(`${SECRETS_DIR}/README.md`)
  }

  // — gitignore (only when a git repo; else warn loudly) —
  const isGitRepo = deps.isGitRepo || defaultIsGitRepo
  if (plan.needsSecretsFolder) {
    if (await isGitRepo(projectRoot)) {
      const g = await ensureGitignoreBlock(projectRoot)
      if (g === 'created' || g === 'updated') created.push('.gitignore (secrets block)')
      else skipped.push('.gitignore (secrets block)')
    } else {
      warnings.push(
        'Not a git repository — skipped .gitignore management. Your real secret files are NOT protected from commit.',
      )
    }
  }

  return { created, skipped, needsFill, warnings }
}

// ── preview — dry run, no writes (spec §8 scaffold:preview) ──────────────────
// Mirrors sync's artifact set so preview parity (spec §12) holds: each artifact
// is classified create | skip by checking on-disk existence only.
async function preview(projectRoot, selections, catalog, deps = {}) {
  const plan = computePlan(selections, catalog)
  const willCreate = []
  const willSkip = []
  const rel = (...p) => path.join(projectRoot, ...p)
  const classify = async (relPath, label) => {
    ;(await pathExists(rel(relPath)) ? willSkip : willCreate).push(label || relPath)
  }

  for (const f of plan.secretFiles) {
    await classify(path.join(SECRETS_DIR, f.fileName), `${SECRETS_DIR}/${f.fileName}`)
    // .example is always (re)written → always shown as create in preview
    willCreate.push(`${SECRETS_DIR}/${f.fileName}.example`)
  }
  await classify('opencode.jsonc')
  for (const skill of plan.skills) {
    await classify(path.join('skill', skill.id, 'SKILL.md'), `skill/${skill.id}/SKILL.md`)
  }
  if (plan.includeAgents) {
    for (const a of await listAgentFiles(deps.globalAgentsDir)) {
      await classify(path.join('agents', a.name), `agents/${a.name}`)
    }
  }
  if (plan.projectMemory) {
    await classify(plan.projectMemory.folder, `${plan.projectMemory.folder}/ (vault)`)
  }
  if (plan.specsFolder) {
    await classify(path.join('specs', 'README.md'), 'specs/README.md')
  }
  if (plan.needsSecretsFolder) {
    willCreate.push(`${SECRETS_DIR}/README.md`)
    const isGitRepo = deps.isGitRepo || defaultIsGitRepo
    if (await isGitRepo(projectRoot)) willCreate.push('.gitignore (secrets block)')
  }

  return {
    willCreate,
    willSkip,
    missingConfigValues: plan.missingConfigValues,
    needsSecretsFolder: plan.needsSecretsFolder,
  }
}

// ── default I/O deps (overridable in tests) ─────────────────────────────────

async function defaultReadConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'opencode.jsonc')
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const { default: strip } = await import('strip-json-comments')
    return { existed: true, config: JSON.parse(strip(raw)) }
  } catch {
    return { existed: false, config: {} }
  }
}

async function defaultWriteConfig(projectRoot, config) {
  const configPath = path.join(projectRoot, 'opencode.jsonc')
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
  const tmpPath = configPath + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf8')
  await fs.rename(tmpPath, configPath)
}

async function defaultIsGitRepo(projectRoot) {
  return pathExists(path.join(projectRoot, '.git'))
}

// Copy the bundled obsidian-project-memory template tree to dest. Resolved from
// SCAFFOLD_TEMPLATE_DIR (set by main.js per dev/prod) with a repo-relative
// fallback so the engine also works under vitest.
async function defaultCopyTemplate(dest) {
  const src =
    process.env.SCAFFOLD_TEMPLATE_DIR ||
    path.join(__dirname, '..', '..', 'obsidian-project-memory')
  if (!fsSync.existsSync(src)) {
    throw new Error(`scaffold: obsidian template not found at ${src}`)
  }
  await fs.cp(src, dest, { recursive: true })
}

module.exports = {
  SECRETS_DIR,
  GITIGNORE_BEGIN,
  GITIGNORE_END,
  computePlan,
  mergeConfig,
  ensureFileIfMissing,
  writeFileAlways,
  ensureGitignoreBlock,
  renderSecretsReadme,
  listAgentFiles,
  sync,
  preview,
}
