// Claude Code Subscription Provider — wrapper supervisor (spec §8).
//
// Owns the lifecycle of the local `claude-code-openai-wrapper` process: spawn,
// health-poll, stop, and the status the Models screen renders. Single instance
// per manager (spec §8 rule 1); loopback only (rule 4); stopped on app quit
// unless detached (rule 5).
//
// CommonJS. All side-effecting collaborators (spawn, http health probe, free-port
// finder, claude-login check, secret reader, provider-block writer) are injected
// via `deps`, so the pure orchestration is unit-testable without a real process.

const net = require('net')
const http = require('http')
const path = require('path')
const fs = require('fs/promises')
const childProcess = require('child_process')

const {
  WRAPPER_DESCRIPTOR,
  buildSpawnEnv,
  resolveCommand,
  normalizeProfiles,
  baseURLForPort,
  parseAuthStatus,
  modelsFromList,
  API_KEY_FILE,
  CLIENT_GUARD_FILE,
} = require('./descriptor')
const provider = require('./provider')

const SECRETS_DIR = '.opencode-secrets'
const LOG_RING_MAX = 200

// State machine (spec §9 status pill):
//   stopped | starting | running | auth-needed | crashed
const State = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  AUTH_NEEDED: 'auth-needed',
  CRASHED: 'crashed',
}

// ── module-level singleton state ────────────────────────────────────────────
let handle = null // the spawned ChildProcess (null when not running)
let state = State.STOPPED
let boundPort = null
let activeProfile = null
let detached = false
let lastError = null
let liveModels = null // seeded from GET /v1/models once running
const logRing = []

function pushLog(line) {
  logRing.push(line)
  if (logRing.length > LOG_RING_MAX) logRing.shift()
}

function getStatus() {
  return {
    state,
    port: boundPort,
    profile: activeProfile,
    detached,
    error: lastError,
    baseURL: boundPort ? baseURLForPort(boundPort) : null,
    models: liveModels,
    logsTail: logRing.slice(-20),
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

// First free TCP port at/above `start` on loopback. Probes by attempting to
// listen — the only reliable cross-platform check.
function firstFreePort(start, attempts = 20, deps = {}) {
  const tryListen = deps.tryListen || _tryListen
  return (async () => {
    for (let p = start; p < start + attempts; p++) {
      if (await tryListen(p)) return p
    }
    throw new Error(`no free port in [${start}, ${start + attempts})`)
  })()
}

function _tryListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

// GET http://127.0.0.1:<port><path> → resolves the parsed body, rejects on error.
function httpGet(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'GET', timeout: timeoutMs },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let body = data
          try {
            body = JSON.parse(data)
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, body })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

// Poll <path> until a 2xx or the deadline. Returns true on healthy, false on timeout.
async function waitForHealth(port, urlPath, timeoutMs, deps = {}) {
  const get = deps.httpGet || httpGet
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const { status } = await get(port, urlPath, 2000)
      if (status >= 200 && status < 300) return true
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  return false
}

// Read a secret file (no trailing newline expected). Returns null if absent.
async function readSecret(configDir, fileName, deps = {}) {
  const readFile = deps.readFile || fs.readFile
  try {
    return (await readFile(path.join(configDir, SECRETS_DIR, fileName), 'utf8')).replace(/\r?\n$/, '')
  } catch {
    return null
  }
}

// Probe whether the Claude CLI is logged in to a subscription (spec §8
// requireClaudeLogin). Default impl shells `claude auth status`; injectable.
function checkClaudeLogin(deps = {}) {
  if (deps.checkClaudeLogin) return deps.checkClaudeLogin()
  return new Promise((resolve) => {
    try {
      const cp = childProcess.spawn('claude', ['auth', 'status'], { shell: true })
      let out = ''
      cp.stdout?.on('data', (d) => (out += d))
      cp.stderr?.on('data', (d) => (out += d))
      cp.on('error', () => resolve({ ok: false, reason: 'claude CLI not found on PATH' }))
      cp.on('close', (code) => resolve({ ok: code === 0, output: out.trim() }))
    } catch {
      resolve({ ok: false, reason: 'claude CLI not found on PATH' })
    }
  })
}

// ── lifecycle ───────────────────────────────────────────────────────────────

// Idempotent: if a healthy process is already running, returns it untouched
// (spec §8). Otherwise validates auth (subscription), picks a free port, spawns
// the wrapper, waits for /health, and writes the provider block with the live
// baseURL. `opts`: { profile, projectDir, configDir, runnerCwd, detach }.
async function ensureWrapper(opts = {}, deps = {}) {
  if (handle && state === State.RUNNING) {
    return getStatus()
  }

  const profile = opts.profile || WRAPPER_DESCRIPTOR.defaultAuthProfile
  const profiles = normalizeProfiles(profile)
  const configDir = opts.configDir
  activeProfile = profile
  lastError = null
  state = State.STARTING

  // Subscription billing requires a logged-in Claude CLI (spec §8 / §13).
  if (profiles.includes('subscription') && !profiles.includes('api-key')) {
    const login = await checkClaudeLogin(deps)
    if (!login.ok) {
      state = State.AUTH_NEEDED
      lastError = login.reason || 'Run `claude auth login` (Pro/Max subscription).'
      pushLog(`auth: ${lastError}`)
      return getStatus()
    }
  }

  // Resolve secrets the active profile needs.
  const secrets = {}
  if (profiles.includes('api-key')) {
    secrets.anthropicApiKey = await readSecret(configDir, API_KEY_FILE, deps)
  }
  if (profiles.includes('client-guard')) {
    secrets.clientGuardKey = await readSecret(configDir, CLIENT_GUARD_FILE, deps)
  }

  // Pick a free port (auto-bump off 8000 if busy — spec §8 rule 4).
  const port = await firstFreePort(WRAPPER_DESCRIPTOR.process.port, 20, deps)

  const env = buildSpawnEnv(opts.baseEnv || process.env, {
    profile,
    port,
    projectDir: opts.projectDir,
    secrets,
  })
  // opts.command (built by main.js from the venv Python) wins; it may still carry
  // a ${PORT} token which resolveCommand fills in. No fallback launch command
  // exists — the wrapper must be installed first (main.js guards on this).
  if (!opts.command) {
    state = State.CRASHED
    lastError = 'wrapper is not installed — run Install first'
    return getStatus()
  }
  const command = resolveCommand(opts.command, { port })
  const [cmd, ...args] = command

  // An absolute venv Python path spawns without a shell; only fall back to a
  // shell when explicitly asked (e.g. a PATH-resolved runner).
  const useShell = opts.shell != null ? opts.shell : false
  const spawn = deps.spawn || childProcess.spawn
  const child = spawn(cmd, args, {
    cwd: opts.runnerCwd || undefined,
    env,
    shell: useShell,
    windowsHide: true,
  })
  handle = child
  boundPort = port
  detached = !!opts.detach

  child.stdout?.on('data', (d) => pushLog(String(d).trimEnd()))
  child.stderr?.on('data', (d) => pushLog(String(d).trimEnd()))
  child.on('error', (err) => {
    lastError = err.message
    state = State.CRASHED
    pushLog(`spawn error: ${err.message}`)
  })
  child.on('exit', (code, signal) => {
    // Distinguish a deliberate stop (handle cleared) from a crash.
    if (handle === child) {
      handle = null
      if (state !== State.STOPPED) {
        state = code === 0 ? State.STOPPED : State.CRASHED
        if (code !== 0) lastError = `wrapper exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`
      }
    }
  })

  // Wait for the HTTP health endpoint.
  const healthy = await waitForHealth(
    port,
    WRAPPER_DESCRIPTOR.process.health.path,
    opts.startupTimeoutMs || WRAPPER_DESCRIPTOR.process.startupTimeoutMs,
    deps,
  )
  if (!healthy || state === State.CRASHED) {
    await stopWrapper(deps)
    state = State.CRASHED
    lastError = lastError || 'wrapper did not become healthy within startup timeout'
    return getStatus()
  }

  const get = deps.httpGet || httpGet

  // Confirm subscription auth via the wrapper, not an API key (spec §8/§10). The
  // real /v1/auth/status shape is { claude_code_auth: { method, status:{valid} } }.
  if (profiles.includes('subscription') && !profiles.includes('api-key')) {
    try {
      const { body } = await get(port, WRAPPER_DESCRIPTOR.process.health.authStatus, 4000)
      const auth = parseAuthStatus(body)
      if (!auth.authenticated) {
        state = State.AUTH_NEEDED
        lastError = 'Wrapper is up but Claude CLI is not authenticated — run `claude auth login`.'
        await stopWrapper(deps)
        state = State.AUTH_NEEDED
        return getStatus()
      }
    } catch {
      /* auth-status optional; don't fail the start over a probe */
    }
  }

  state = State.RUNNING

  // Seed the model list from the live wrapper (spec §6); fall back to static.
  try {
    const { body } = await get(port, WRAPPER_DESCRIPTOR.process.health.models, 4000)
    liveModels = modelsFromList(body)
  } catch {
    liveModels = WRAPPER_DESCRIPTOR.models
  }

  // Persist the provider block with the LIVE port + live models so config never
  // drifts from what the running wrapper actually serves.
  if (configDir) {
    try {
      const writeBlock = deps.writeProviderBlock || provider.writeProviderBlock
      await writeBlock(configDir, { port, models: liveModels, clientGuard: profiles.includes('client-guard') })
    } catch (err) {
      pushLog(`provider write failed: ${err.message}`)
    }
  }

  return getStatus()
}

// Graceful SIGTERM → SIGKILL after a grace period (spec §8 stopWrapper).
async function stopWrapper(deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const child = handle
  state = State.STOPPED
  handle = null
  boundPort = null
  detached = false
  liveModels = null
  if (!child) return getStatus()
  try {
    child.kill('SIGTERM')
    await sleep(deps.graceMs ?? 2000)
    if (!child.killed) child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
  return getStatus()
}

// For app-quit teardown: stop unless the user pinned a detached instance.
async function stopOnQuit(deps = {}) {
  if (handle && !detached) await stopWrapper(deps)
}

// Test seam: reset module state between cases.
function _reset() {
  handle = null
  state = State.STOPPED
  boundPort = null
  activeProfile = null
  detached = false
  lastError = null
  liveModels = null
  logRing.length = 0
}

module.exports = {
  State,
  ensureWrapper,
  stopWrapper,
  stopOnQuit,
  getStatus,
  firstFreePort,
  waitForHealth,
  readSecret,
  checkClaudeLogin,
  _reset,
}
