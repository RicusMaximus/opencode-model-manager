// Claude Code Subscription Provider — opencode.jsonc provider block writer (spec §7).
//
// CommonJS, no Electron imports (pure-core + injectable I/O) so it's testable
// under vitest against a temp dir — mirrors electron/scaffold/engine.js.
//
// The provider DEFINITION lives in the GLOBAL config (project configs only
// reference models by id). Writes deep-merge so $schema, the `mcp` block, other
// providers (ollama), and unknown fields all survive (AGENTS.md round-trip rule).
//
// Hard rules:
//   • never clobber sibling providers / unknown top-level fields
//   • baseURL always reflects the live bound port (rewrite on drift, spec §7 note)
//   • apiKey is emitted as a {file:...} ref ONLY under the client-guard profile

const fs = require('fs/promises')
const path = require('path')
const {
  PROVIDER_ID,
  PROVIDER_NAME,
  NPM_LOADER,
  WRAPPER_MODELS,
  CLIENT_GUARD_FILE,
  baseURLForPort,
} = require('./descriptor')

const SECRETS_DIR = '.opencode-secrets'

// Resolve which config file to read/write in `configDir`. OpenCode supports both
// opencode.jsonc and opencode.json; prefer an existing .jsonc, else an existing
// .json, else default to .jsonc (created). This keeps the provider block in the
// SAME file as the user's existing global config instead of creating a stray one.
async function resolveConfigFile(configDir, deps = {}) {
  const access = deps.access || fs.access
  const jsonc = path.join(configDir, 'opencode.jsonc')
  const json = path.join(configDir, 'opencode.json')
  try {
    await access(jsonc)
    return jsonc
  } catch {
    /* no .jsonc */
  }
  try {
    await access(json)
    return json
  } catch {
    /* no .json */
  }
  return jsonc
}

// ── PURE: build the provider block ──────────────────────────────────────────
// `models` defaults to the static list; pass the live /v1/models result to seed
// from the running wrapper. `clientGuard` emits the apiKey {file:} ref.
function buildProviderBlock({ baseURL, models = WRAPPER_MODELS, clientGuard = false } = {}) {
  const options = { baseURL }
  if (clientGuard) {
    options.apiKey = `{file:./${SECRETS_DIR}/${CLIENT_GUARD_FILE}}`
  }
  const modelMap = {}
  for (const m of models) {
    modelMap[m.id] = { name: m.name || m.id }
  }
  return {
    npm: NPM_LOADER,
    name: PROVIDER_NAME,
    options,
    models: modelMap,
  }
}

// ── PURE: merge the provider block into a parsed config object ───────────────
// Spreads existing first so unknown fields survive; replaces only
// provider.claude-sub. Other providers (ollama) are untouched.
function mergeProviderBlock(existingConfig, block) {
  const config =
    existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig)
      ? { ...existingConfig }
      : {}
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
  const provider =
    config.provider && typeof config.provider === 'object' && !Array.isArray(config.provider)
      ? { ...config.provider }
      : {}
  provider[PROVIDER_ID] = block
  config.provider = provider
  return config
}

// ── I/O: read / write the global opencode.jsonc ─────────────────────────────

async function readConfig(configDir, deps = {}) {
  const readFile = deps.readFile || fs.readFile
  const configPath = await resolveConfigFile(configDir, deps)
  try {
    const raw = await readFile(configPath, 'utf8')
    const { default: strip } = await import('strip-json-comments')
    const parsed = JSON.parse(strip(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { existed: true, config: parsed, configPath }
    }
    return { existed: true, config: {}, configPath }
  } catch {
    return { existed: false, config: {}, configPath }
  }
}

async function writeConfig(configDir, config, deps = {}) {
  const writeFile = deps.writeFile || fs.writeFile
  const rename = deps.rename || fs.rename
  const configPath = await resolveConfigFile(configDir, deps)
  const tmpPath = configPath + '.tmp'
  await writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf8')
  await rename(tmpPath, configPath)
}

// Write/repair the provider block in the GLOBAL config. Idempotent: reads,
// merges, writes atomically. Returns the baseURL written.
async function writeProviderBlock(configDir, { port, models, clientGuard = false } = {}, deps = {}) {
  const baseURL = baseURLForPort(port)
  const block = buildProviderBlock({ baseURL, models, clientGuard })
  const { config } = await readConfig(configDir, deps)
  const merged = mergeProviderBlock(config, block)
  await writeConfig(configDir, merged, deps)
  return { baseURL, models: block.models }
}

// Drift check used by doctor (spec §10 config): does the persisted baseURL match
// the live bound port? Returns { present, baseURL, matches }.
async function readPersistedBaseURL(configDir, port, deps = {}) {
  const { config } = await readConfig(configDir, deps)
  const baseURL = config.provider?.[PROVIDER_ID]?.options?.baseURL ?? null
  return {
    present: baseURL != null,
    baseURL,
    matches: baseURL === baseURLForPort(port),
  }
}

module.exports = {
  SECRETS_DIR,
  resolveConfigFile,
  buildProviderBlock,
  mergeProviderBlock,
  readConfig,
  writeConfig,
  writeProviderBlock,
  readPersistedBaseURL,
}
