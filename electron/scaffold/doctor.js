// Project Scaffolding Tool — doctor checks (spec §9).
//
// CommonJS. Evaluates, per input kind, whether the scaffolded project is in a
// healthy state. Run after a scaffold (to power the post-scaffold summary) and
// re-runnable on demand. Pure-ish: filesystem/network reads only, never writes.
//
// Each check returns { id, level: 'ok'|'warn'|'fail', message }.

const fs = require('fs/promises')
const net = require('net')
const path = require('path')
const { computePlan, SECRETS_DIR, GITIGNORE_BEGIN } = require('./engine')

async function readFileOrNull(p) {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}

// Best-effort entropy heuristic: flags a config value that looks like a pasted
// secret (long + high character variety) so we can warn it shouldn't be inline.
function looksLikeSecret(value) {
  if (typeof value !== 'string' || value.length < 24) return false
  const variety = new Set(value).size
  return variety >= 16 && /[A-Za-z]/.test(value) && /\d/.test(value)
}

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

function expandEnvTarget(target) {
  // Expand %VAR% (Windows) so the gcloud ADC path resolves.
  return target.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '')
}

// Run all checks implied by the current selections against projectRoot.
async function runDoctor(projectRoot, selections, catalog) {
  const plan = computePlan(selections, catalog)
  const checks = []
  const rel = (...p) => path.join(projectRoot, ...p)

  // — secret inputs —
  for (const s of plan.secretInputs) {
    const filePath = rel(SECRETS_DIR, s.fileName)
    const content = await readFileOrNull(filePath)
    if (content === null) {
      checks.push({ id: `secret:${s.fileName}`, level: 'fail', message: `Missing secret file ${SECRETS_DIR}/${s.fileName}` })
      continue
    }
    if (content === s.placeholder) {
      checks.push({ id: `secret:${s.fileName}`, level: 'fail', message: `${SECRETS_DIR}/${s.fileName} still holds the placeholder — needs a real value` })
      continue
    }
    if (content.endsWith('\n')) {
      checks.push({ id: `secret:${s.fileName}`, level: 'warn', message: `${SECRETS_DIR}/${s.fileName} has a trailing newline — {file:} is literal, strip it` })
      continue
    }
    if (s.validate && !new RegExp(s.validate).test(content)) {
      checks.push({ id: `secret:${s.fileName}`, level: 'warn', message: `${SECRETS_DIR}/${s.fileName} doesn't match expected format` })
      continue
    }
    checks.push({ id: `secret:${s.fileName}`, level: 'ok', message: `${s.envVar} present` })
  }

  // — config inputs —
  for (const c of plan.configInline) {
    if (c.required && (c.value === undefined || c.value === '')) {
      checks.push({ id: `config:${c.envVar}`, level: 'fail', message: `${c.envVar} is required but empty` })
    } else if (looksLikeSecret(c.value)) {
      checks.push({ id: `config:${c.envVar}`, level: 'warn', message: `${c.envVar} looks like a secret pasted inline — move it to a secret file` })
    } else {
      checks.push({ id: `config:${c.envVar}`, level: 'ok', message: `${c.envVar} set` })
    }
  }

  // — external inputs —
  for (const e of plan.external) {
    if (e.check.type === 'file') {
      const target = expandEnvTarget(e.check.target)
      const exists = (await readFileOrNull(target)) !== null
      checks.push({
        id: `external:${e.serverId}`,
        level: exists ? 'ok' : 'warn',
        message: exists ? `${e.serverId}: ${e.note} ✓` : `${e.serverId}: ${e.note} (not found: ${target})`,
      })
    } else if (e.check.type === 'port') {
      const [host, portStr] = e.check.target.split(':')
      const ok = await tcpProbe(host, Number(portStr))
      checks.push({
        id: `external:${e.serverId}`,
        level: ok ? 'ok' : 'warn',
        message: ok ? `${e.serverId}: reachable on ${e.check.target}` : `${e.serverId}: not reachable on ${e.check.target} (${e.note})`,
      })
    } else {
      checks.push({ id: `external:${e.serverId}`, level: 'warn', message: `${e.serverId}: ${e.note}` })
    }
  }

  // — repo: gitignore block present —
  if (plan.needsSecretsFolder) {
    const gitignore = await readFileOrNull(rel('.gitignore'))
    if (gitignore === null) {
      checks.push({ id: 'repo:gitignore', level: 'warn', message: 'No .gitignore — secrets are not protected from commit' })
    } else if (!gitignore.includes(GITIGNORE_BEGIN)) {
      checks.push({ id: 'repo:gitignore', level: 'fail', message: '.gitignore is missing the secrets block' })
    } else {
      checks.push({ id: 'repo:gitignore', level: 'ok', message: 'gitignore secrets block present' })
    }
  }

  return { checks }
}

module.exports = { runDoctor, looksLikeSecret }
