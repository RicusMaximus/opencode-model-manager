#!/usr/bin/env node
// Gate bash-fallback CLI — for environments without MCP support (spec §5.2).
//
// Submits a review request to the shared `.gate/` bus and BLOCKS, polling for a
// signed decision, exactly like the MCP server's submit_for_review tool. The
// verdict is written to STDOUT in a shell-friendly form:
//
//   line 1: "approved" or "rejected"
//   line 2+: the decision notes (may be multi-line)
//
// Exit code: 0 on approved, 1 on rejected/timeout/error. Diagnostics go to
// STDERR so stdout stays parseable.
//
// Usage:
//   node gate-submit.js \
//     --configDir <path> --stage design --agent <id> --title "..." \
//     --artifact-path <p> --artifact-kind <k> [--artifact-path <p2> --artifact-kind <k2> ...] \
//     [--expires-in <seconds>]
//
// CommonJS, Node built-ins only (+ the shared security/schema modules). Fails
// closed everywhere.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { verify } = require('../electron/gate/security')
const { validateReviewRequest } = require('../electron/gate/schema')
const { readDecisionOrArchive } = require('../electron/gate/bus')

const SECRET_FILE_NAME = 'gate-secret.key'
const PACKAGE_NAME = 'opencode-agent-gui'
const PRODUCT_NAME = 'OpenCode Agent Manager'
const POLL_INTERVAL_MS = 2000
const DEFAULT_EXPIRES_IN_SECONDS = 86400

function logError(...args) {
  process.stderr.write(`[gate-submit] ${args.join(' ')}\n`)
}

// ── userData / secret / configDir (mirrors gate-mcp-server.js) ────────────────

// Ordered candidate userData dirs (BUG 2): Electron uses the package `name` in
// dev but `build.productName` once packaged, so probe BOTH — package-name dir
// FIRST (favors dev), productName dir SECOND.
function userDataCandidates() {
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return [path.join(appData, PACKAGE_NAME), path.join(appData, PRODUCT_NAME)]
  }
  if (process.platform === 'darwin') {
    const base = path.join(os.homedir(), 'Library', 'Application Support')
    return [path.join(base, PACKAGE_NAME), path.join(base, PRODUCT_NAME)]
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return [path.join(xdg, 'opencode-agent-manager')]
}

// An explicit override always wins; otherwise return the first candidate whose
// gate-secret.key exists, falling back to the first candidate (fail-closed).
function deriveUserDataDir(explicitOverride = null) {
  if (explicitOverride) return explicitOverride
  const candidates = userDataCandidates()
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, SECRET_FILE_NAME))) return dir
  }
  return candidates[0]
}

// Read-only secret load: the app owns creation; absent ⇒ null ⇒ fail closed.
function loadSecretReadOnly(userDataDir) {
  const secretPath = path.join(userDataDir, SECRET_FILE_NAME)
  try {
    const secret = fs.readFileSync(secretPath, 'utf8').trim()
    if (!secret) {
      logError(`secret file is empty at ${secretPath}; failing closed`)
      return null
    }
    return secret
  } catch (err) {
    if (err.code === 'ENOENT') {
      logError(`secret not found at ${secretPath}; failing closed`)
      return null
    }
    logError(`failed to read secret: ${err.message}`)
    return null
  }
}

function platformDefaultConfigDir() {
  return path.join(os.homedir(), '.config', 'opencode')
}

// ── argument parsing ──────────────────────────────────────────────────────────

// Parse argv, collecting repeated --artifact-path / --artifact-kind into pairs
// (zipped positionally). Returns a plain options object.
function parseArgs(argv) {
  const opts = {
    configDir: null,
    userDataDir: null,
    stage: null,
    agent: null,
    title: null,
    expiresIn: null,
    artifactPaths: [],
    artifactKinds: [],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) {
        throw new Error(`missing value for ${flag}`)
      }
      return argv[i]
    }
    switch (flag) {
      case '--configDir':
        opts.configDir = next()
        break
      case '--userDataDir':
        opts.userDataDir = next()
        break
      case '--stage':
        opts.stage = next()
        break
      case '--agent':
        opts.agent = next()
        break
      case '--title':
        opts.title = next()
        break
      case '--expires-in':
        opts.expiresIn = next()
        break
      case '--artifact-path':
        opts.artifactPaths.push(next())
        break
      case '--artifact-kind':
        opts.artifactKinds.push(next())
        break
      default:
        throw new Error(`unknown argument: ${flag}`)
    }
  }
  return opts
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function atomicWriteSync(filePath, content) {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-${crypto.randomBytes(8).toString('hex')}`)
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

// ── submit + poll ─────────────────────────────────────────────────────────────

async function run() {
  const opts = parseArgs(process.argv.slice(2))

  const configDir = opts.configDir || platformDefaultConfigDir()
  const userDataDir = opts.userDataDir
    ? opts.userDataDir
    : deriveUserDataDir()
  const secret = loadSecretReadOnly(userDataDir)

  if (opts.artifactPaths.length !== opts.artifactKinds.length) {
    throw new Error(
      `--artifact-path count (${opts.artifactPaths.length}) must match ` +
        `--artifact-kind count (${opts.artifactKinds.length})`,
    )
  }
  const artifacts = opts.artifactPaths.map((p, i) => ({
    kind: opts.artifactKinds[i],
    path: p,
  }))

  const expiresInSeconds =
    opts.expiresIn != null && Number(opts.expiresIn) > 0
      ? Number(opts.expiresIn)
      : DEFAULT_EXPIRES_IN_SECONDS

  const nowMs = Date.now()
  const expiresAtMs = nowMs + expiresInSeconds * 1000
  const id = crypto.randomUUID()

  const request = {
    id,
    schemaVersion: 1,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    stage: opts.stage,
    agent: opts.agent,
    title: opts.title == null ? '' : opts.title,
    artifacts,
    checklist: null,
  }

  const clean = validateReviewRequest(request)

  const requestsDir = path.join(configDir, '.gate', 'requests')
  fs.mkdirSync(requestsDir, { recursive: true })
  atomicWriteSync(
    path.join(requestsDir, `${clean.id}.json`),
    JSON.stringify(clean, null, 2),
  )

  // Poll for the decision, falling back to the archived copy if the live
  // decision file was already consumed by the app's archival step (BUG 1).
  for (;;) {
    let decision = null
    try {
      decision = await readDecisionOrArchive(configDir, clean.id)
    } catch (err) {
      logError(`could not read decision: ${err.message}`)
      decision = null
    }

    if (decision !== null) {
      if (!verify(decision, secret)) {
        return {
          status: 'rejected',
          notes: 'gate: signature verification failed',
        }
      }
      if (decision.status === 'approved') {
        return { status: 'approved', notes: decision.notes || '' }
      }
      return { status: 'rejected', notes: decision.notes || '' }
    }

    if (Date.now() > expiresAtMs) {
      return { status: 'rejected', notes: 'gate: timeout — no decision received' }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

run()
  .then((result) => {
    process.stdout.write(`${result.status}\n`)
    if (result.notes) process.stdout.write(`${result.notes}\n`)
    process.exit(result.status === 'approved' ? 0 : 1)
  })
  .catch((err) => {
    logError(err.message)
    process.stdout.write('rejected\n')
    process.stdout.write(`gate: ${err.message}\n`)
    process.exit(1)
  })
