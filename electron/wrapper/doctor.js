// Claude Code Subscription Provider — doctor checks (spec §10).
//
// CommonJS. Re-runnable diagnostics that validate prereqs, process health, auth
// posture, config drift, and the optional client guard. Reads only — never
// writes. Each check returns { id, level: 'ok'|'warn'|'fail', message }.

const net = require('net')
const http = require('http')
const path = require('path')
const fs = require('fs/promises')
const childProcess = require('child_process')

const {
  WRAPPER_DESCRIPTOR,
  normalizeProfiles,
  parseAuthStatus,
  API_KEY_FILE,
  CLIENT_GUARD_FILE,
} = require('./descriptor')
const provider = require('./provider')

const SECRETS_DIR = '.opencode-secrets'

function tcpProbe(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function httpGet(port, urlPath, timeoutMs = 4000) {
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

// Resolve an executable on PATH by running `<tool> --version` (or `where`).
function commandExists(tool, args = ['--version'], deps = {}) {
  if (deps.commandExists) return deps.commandExists(tool)
  return new Promise((resolve) => {
    try {
      const cp = childProcess.spawn(tool, args, { shell: true })
      cp.on('error', () => resolve(false))
      cp.on('close', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

async function readFileOrNull(p, deps = {}) {
  const readFile = deps.readFile || fs.readFile
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

// Run all checks. `opts`: { profile, port, spawnedEnv }. `spawnedEnv` is the env
// the supervisor used (so we can detect a leaked ANTHROPIC_API_KEY); falls back
// to process.env.
async function runDoctor(configDir, opts = {}, deps = {}) {
  const checks = []
  const profiles = normalizeProfiles(opts.profile || WRAPPER_DESCRIPTOR.defaultAuthProfile)
  const port = opts.port || WRAPPER_DESCRIPTOR.process.port
  const get = deps.httpGet || httpGet
  const probe = deps.tcpProbe || tcpProbe
  const env = opts.spawnedEnv || process.env

  // — prereqs (spec §10) —
  const py = await commandExists('python', ['--version'], deps)
  checks.push({ id: 'prereq:python', level: py ? 'ok' : 'fail', message: py ? 'python found' : 'python (>=3.10) not found on PATH' })
  const runner = WRAPPER_DESCRIPTOR.process.runner
  const runnerOk = await commandExists(runner, ['--version'], deps)
  checks.push({ id: `prereq:${runner}`, level: runnerOk ? 'ok' : 'fail', message: runnerOk ? `${runner} found` : `${runner} not found on PATH` })
  const claudeOk = await commandExists('claude', ['--version'], deps)
  checks.push({ id: 'prereq:claude', level: claudeOk ? 'ok' : 'fail', message: claudeOk ? 'claude CLI found' : 'claude CLI not found on PATH' })

  // — process —
  const portOpen = await probe('127.0.0.1', port)
  if (!portOpen) {
    checks.push({ id: 'process:port', level: 'fail', message: `wrapper not listening on 127.0.0.1:${port}` })
  } else {
    checks.push({ id: 'process:port', level: 'ok', message: `listening on 127.0.0.1:${port}` })
    try {
      const { status } = await get(port, WRAPPER_DESCRIPTOR.process.health.path, 3000)
      checks.push({ id: 'process:health', level: status >= 200 && status < 300 ? 'ok' : 'warn', message: `/health → ${status}` })
    } catch (err) {
      checks.push({ id: 'process:health', level: 'warn', message: `/health unreachable: ${err.message}` })
    }
  }

  // — auth posture —
  if (profiles.includes('api-key')) {
    const content = await readFileOrNull(path.join(configDir, SECRETS_DIR, API_KEY_FILE), deps)
    if (content === null) checks.push({ id: 'auth:api-key', level: 'fail', message: `missing ${SECRETS_DIR}/${API_KEY_FILE}` })
    else if (content.includes('REPLACE_ME')) checks.push({ id: 'auth:api-key', level: 'fail', message: `${API_KEY_FILE} still holds the placeholder` })
    else if (!/^sk-ant-/.test(content)) checks.push({ id: 'auth:api-key', level: 'warn', message: `${API_KEY_FILE} doesn't match ^sk-ant-` })
    else checks.push({ id: 'auth:api-key', level: 'ok', message: 'ANTHROPIC_API_KEY present' })
  } else {
    // subscription posture: the SDK must NOT see an API key, or it bills the API.
    if (env.ANTHROPIC_API_KEY) {
      checks.push({ id: 'auth:subscription', level: 'warn', message: 'ANTHROPIC_API_KEY present in env — billing to API, not subscription' })
    } else {
      checks.push({ id: 'auth:subscription', level: 'ok', message: 'ANTHROPIC_API_KEY absent (subscription billing)' })
    }
    if (portOpen) {
      try {
        const { body } = await get(port, WRAPPER_DESCRIPTOR.process.health.authStatus, 3000)
        const auth = parseAuthStatus(body)
        checks.push({
          id: 'auth:status',
          level: auth.authenticated ? 'ok' : 'warn',
          message: auth.authenticated
            ? `wrapper authenticated via ${auth.method || 'subscription'}`
            : 'wrapper reports not authenticated — run `claude auth login`',
        })
      } catch {
        checks.push({ id: 'auth:status', level: 'warn', message: '/v1/auth/status unreachable' })
      }
    }
  }

  // — config drift —
  const persisted = await provider.readPersistedBaseURL(configDir, port, deps)
  if (!persisted.present) {
    checks.push({ id: 'config:provider', level: 'warn', message: 'provider.claude-sub not in opencode.jsonc — start the wrapper to write it' })
  } else if (!persisted.matches) {
    checks.push({ id: 'config:provider', level: 'fail', message: `baseURL drift: config has ${persisted.baseURL}, live port is ${port}` })
  } else {
    checks.push({ id: 'config:provider', level: 'ok', message: 'provider baseURL matches live port' })
  }

  // — client guard (if active) —
  if (profiles.includes('client-guard')) {
    const content = await readFileOrNull(path.join(configDir, SECRETS_DIR, CLIENT_GUARD_FILE), deps)
    if (content === null) checks.push({ id: 'client-guard', level: 'fail', message: `missing ${SECRETS_DIR}/${CLIENT_GUARD_FILE}` })
    else if (content.includes('REPLACE_ME')) checks.push({ id: 'client-guard', level: 'warn', message: `${CLIENT_GUARD_FILE} still holds the placeholder` })
    else checks.push({ id: 'client-guard', level: 'ok', message: 'client guard key present' })
  }

  return { checks }
}

module.exports = { runDoctor }
