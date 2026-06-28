// Claude Code Subscription Provider — descriptor (spec §4–§6).
//
// CommonJS, no Electron imports, so the descriptor + its pure helpers are
// unit-testable under vitest (node env) — mirrors electron/scaffold/catalog.js.
//
// We model the `claude-code-openai-wrapper` shim as ONE OpenCode custom provider
// (`claude-sub`) backed by a manager-supervised local process. This file owns the
// static facts about that provider:
//   • the provider id / npm loader / default baseURL
//   • how the manager launches the wrapper (process spec)
//   • the auth profiles (reusing the MCP InputSpec shape: secret/config/external)
//   • the model list exposed to OpenCode (static fallback when the wrapper is down)

const PROVIDER_ID = 'claude-sub'
const PROVIDER_NAME = 'Claude (subscription)'
const NPM_LOADER = '@ai-sdk/openai-compatible'
const DEFAULT_PORT = 8000
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}/v1`

// Static model list (spec §6). Seed from the wrapper's GET /v1/models at runtime;
// fall back to this when the wrapper is down so the Models screen still renders.
// IDs are bare (no provider prefix) — OpenCode references them as
// `claude-sub/<id>` per the provider/model-id convention (AGENTS.md).
const WRAPPER_MODELS = [
  { id: 'claude-opus-4-8', name: 'Opus 4.8 (subscription)' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6 (subscription)' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5 (subscription)' },
]

// Secret file (under .opencode-secrets/) the client-guard / api-key profiles emit,
// reusing the scaffolder's secret discipline (mcp-secret-scaffolding §7–8).
const CLIENT_GUARD_FILE = 'wrapper-client-key'
const API_KEY_FILE = 'anthropic-api-key'

// authProfiles reuse the InputSpec shape from electron/scaffold (kind:
// secret|config|external). `subscription` is the whole point (no secret,
// subscription billing); `api-key` is the metered escape hatch; `client-guard`
// is orthogonal and composes with either, protecting the loopback endpoint.
const AUTH_PROFILES = {
  subscription: {
    id: 'subscription',
    label: 'Subscription (Claude Pro/Max) — no secret',
    inputs: [
      {
        kind: 'external',
        via: 'command',
        note: 'claude auth login (Pro/Max subscription)',
        check: { type: 'command', target: 'claude auth status' },
      },
    ],
  },
  'api-key': {
    id: 'api-key',
    label: 'API key (metered — defeats subscription goal)',
    inputs: [
      {
        kind: 'secret',
        envVar: 'ANTHROPIC_API_KEY',
        fileName: API_KEY_FILE,
        required: true,
        placeholder: 'REPLACE_ME__anthropic_api_key',
        source: 'Anthropic Console',
        validate: '^sk-ant-',
      },
    ],
  },
  'client-guard': {
    id: 'client-guard',
    label: 'Client guard (lock the loopback endpoint)',
    inputs: [
      {
        kind: 'secret',
        envVar: 'API_KEY',
        fileName: CLIENT_GUARD_FILE,
        required: false,
        placeholder: 'REPLACE_ME__local_wrapper_guard',
        source: 'self-generated',
      },
    ],
  },
}

const WRAPPER_DESCRIPTOR = {
  id: PROVIDER_ID,
  npm: NPM_LOADER,
  name: PROVIDER_NAME,
  defaultBaseURL: DEFAULT_BASE_URL,
  process: {
    // We launch the FastAPI app object directly with the venv's uvicorn. This
    // BYPASSES upstream's run_server() interactive API-key prompt (which would
    // hang a spawned child) and binds loopback explicitly. The actual command is
    // built by buildRunCommand() with the venv Python from the installer.
    appModule: 'src.main:app',
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    health: { path: '/health', authStatus: '/v1/auth/status', models: '/v1/models', timeoutMs: 5000 },
    startupTimeoutMs: 45000, // first boot imports the Claude Agent SDK; allow headroom
  },
  defaultAuthProfile: 'subscription',
  authProfiles: AUTH_PROFILES,
  models: WRAPPER_MODELS,
}

// ── Pure helpers ────────────────────────────────────────────────────────────

// Normalize a profile selection into a set. The UI may pass a single profile
// ("subscription") or compose the orthogonal guard ("subscription"+"client-guard").
function normalizeProfiles(profile) {
  if (Array.isArray(profile)) return profile.filter(Boolean)
  if (!profile) return [WRAPPER_DESCRIPTOR.defaultAuthProfile]
  return [profile]
}

function isApiKeyProfile(profile) {
  return normalizeProfiles(profile).includes('api-key')
}

function isClientGuardProfile(profile) {
  return normalizeProfiles(profile).includes('client-guard')
}

// Build the environment the wrapper is spawned with (spec §5). HARD RULE: under
// any non-`api-key` profile, ANTHROPIC_API_KEY is SCRUBBED so the SDK bills the
// subscription, not the API (spec §5 "subscription vs API-key conflict").
//
// `baseEnv` is the inherited process env. `secrets` provides resolved values:
//   { anthropicApiKey?, clientGuardKey? }
function buildSpawnEnv(baseEnv, { profile, port, projectDir, secrets = {} } = {}) {
  const env = { ...baseEnv }
  const profiles = normalizeProfiles(profile)

  // Manager-driven vars (spec §5 table). NOTE: upstream's MAX_TIMEOUT is in
  // MILLISECONDS (default 600000), not seconds — leave its default unless overridden.
  env.PORT = String(port)
  env.CLAUDE_WRAPPER_HOST = '127.0.0.1' // belt-and-suspenders with the --host arg
  // CLAUDE_CWD must point at an EXISTING dir or the wrapper raises on first call.
  // Set it only when we have a real project dir; otherwise remove any inherited
  // (possibly stale) value so the wrapper falls back to its own temp dir.
  if (projectDir) env.CLAUDE_CWD = projectDir
  else delete env.CLAUDE_CWD
  // FAST_MODEL alias; DEFAULT_MODEL left unset so the wrapper resolves latest Sonnet.
  env.FAST_MODEL = env.FAST_MODEL || 'claude-haiku-4-5-20251001'

  if (profiles.includes('api-key')) {
    if (secrets.anthropicApiKey) env.ANTHROPIC_API_KEY = secrets.anthropicApiKey
  } else {
    // Subscription billing requires the key absent from the spawned env even if
    // it leaked in from the user's global shell.
    delete env.ANTHROPIC_API_KEY
  }

  if (profiles.includes('client-guard')) {
    if (secrets.clientGuardKey) env.API_KEY = secrets.clientGuardKey
  } else {
    delete env.API_KEY
  }

  return env
}

// Build the launch command for a given venv Python. ${PORT} is left as a token
// for the supervisor to resolve once it has picked a free port.
function buildRunCommand(pythonPath) {
  const { appModule, host } = WRAPPER_DESCRIPTOR.process
  return [pythonPath, '-m', 'uvicorn', appModule, '--host', host, '--port', '${PORT}']
}

// Substitute ${PORT} (and any future ${VAR}) tokens in the runner command.
function resolveCommand(command, { port }) {
  const subs = { PORT: String(port) }
  return command.map((arg) => arg.replace(/\$\{(\w+)\}/g, (_, name) => (name in subs ? subs[name] : `\${${name}}`)))
}

// Parse the wrapper's /v1/auth/status body → { authenticated, method }. The real
// shape is nested: { claude_code_auth: { method, status: { valid } } }.
function parseAuthStatus(body) {
  const a = body && body.claude_code_auth
  return {
    authenticated: !!(a && a.status && a.status.valid === true),
    method: a && a.method ? a.method : null,
    subscription: !!(a && a.method === 'claude_cli'),
  }
}

// Map the wrapper's GET /v1/models response → [{ id, name }] for the provider
// block + Models screen. Falls back to the static list when body is unusable.
function modelsFromList(body) {
  const data = body && Array.isArray(body.data) ? body.data : null
  if (!data || data.length === 0) return WRAPPER_MODELS
  return data
    .filter((m) => m && typeof m.id === 'string')
    .map((m) => ({ id: m.id, name: m.id }))
}

function baseURLForPort(port) {
  return `http://localhost:${port}/v1`
}

module.exports = {
  PROVIDER_ID,
  PROVIDER_NAME,
  NPM_LOADER,
  DEFAULT_PORT,
  DEFAULT_BASE_URL,
  WRAPPER_MODELS,
  CLIENT_GUARD_FILE,
  API_KEY_FILE,
  AUTH_PROFILES,
  WRAPPER_DESCRIPTOR,
  normalizeProfiles,
  isApiKeyProfile,
  isClientGuardProfile,
  buildSpawnEnv,
  buildRunCommand,
  resolveCommand,
  parseAuthStatus,
  modelsFromList,
  baseURLForPort,
}
