#!/usr/bin/env node
// Gate MCP server — standalone Node process spawned by the opencode runtime.
//
// Exposes ONE blocking tool, `submit_for_review`, that writes a review request
// into the shared `.gate/` bus under the opencode configDir and then BLOCKS,
// polling for a signed decision from the Electron app, until a verdict is
// returned or the request expires.
//
// CRITICAL: this is NOT the Electron process. It cannot `require('electron')`
// or call `app.getPath()`. It derives userDataDir/configDir from platform
// conventions (mirroring how the app resolves them) and reuses the SHARED
// `electron/gate/security.js` so HMAC signatures match the app byte-for-byte.
//
// Trust model (spec §5.3, §7.3): the gate fails CLOSED. A missing secret, a
// missing/invalid signature, malformed decision, or expiry all resolve to
// `rejected`. The agent cannot self-approve because it cannot produce a valid
// signature without the secret, which lives OUTSIDE configDir in userData.
//
// Transport: JSON-RPC 2.0 over stdio with LSP-style Content-Length framing
// (the MCP standard). CommonJS, Node built-ins only (+ the shared security
// module). No external npm dependencies.

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

// ── stderr-only logging (stdout is the JSON-RPC channel) ──────────────────────

function logError(...args) {
  // NEVER write to stdout — it carries framed JSON-RPC messages.
  process.stderr.write(`[gate-mcp] ${args.join(' ')}\n`)
}

// ── userData / configDir derivation (OQ3) ─────────────────────────────────────

// Ordered list of candidate userData dirs to probe (BUG 2). Electron derives
// app.getPath('userData') from the package `name` in dev but from
// `build.productName` once packaged, so we probe BOTH — package-name dir FIRST
// (favors dev), productName dir SECOND.
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
  // Linux / other: Electron uses XDG_CONFIG_HOME or ~/.config; single candidate.
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return [path.join(xdg, 'opencode-agent-manager')]
}

// Resolve the userData dir. An explicit override (the `--userDataDir` arg passed
// by the app via the MCP entry) always wins. Otherwise probe the candidates and
// return the first whose gate-secret.key exists; if none has the secret yet,
// fall back to the first candidate (fail-closed: null secret → rejected).
function deriveUserDataDir(explicitOverride = null) {
  if (explicitOverride) return explicitOverride
  const candidates = userDataCandidates()
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, SECRET_FILE_NAME))) return dir
  }
  return candidates[0]
}

// Read the HMAC secret directly from <userDataDir>/gate-secret.key. The app
// OWNS creation of this key — the tool must NOT create it. If it is absent we
// return null and every verify() call fails → fail-closed (rejected).
function loadSecretReadOnly(userDataDir) {
  const secretPath = path.join(userDataDir, SECRET_FILE_NAME)
  try {
    const raw = fs.readFileSync(secretPath, 'utf8')
    const secret = raw.trim()
    if (!secret) {
      logError(`secret file is empty at ${secretPath}; gate will fail closed`)
      return null
    }
    return secret
  } catch (err) {
    if (err.code === 'ENOENT') {
      logError(
        `secret not found at ${secretPath}; the app must run once to create it. ` +
          `Gate will fail closed until then.`,
      )
      return null
    }
    logError(`failed to read secret at ${secretPath}: ${err.message}`)
    return null
  }
}

// Resolve the opencode configDir the same way the app does: read
// <userDataDir>/prefs.json → configDir; fall back to the platform default
// (~/.config/opencode on every platform, matching electron/main.js).
function deriveConfigDir(userDataDir) {
  const fallback = path.join(os.homedir(), '.config', 'opencode')
  const prefsPath = path.join(userDataDir, 'prefs.json')
  try {
    const raw = fs.readFileSync(prefsPath, 'utf8')
    const prefs = JSON.parse(raw)
    if (prefs && typeof prefs.configDir === 'string' && prefs.configDir) {
      return prefs.configDir
    }
    return fallback
  } catch {
    return fallback
  }
}

// ── .gate/ bus paths (the tool writes requests, reads decisions) ──────────────

function requestsDir(configDir) {
  return path.join(configDir, '.gate', 'requests')
}

// ── submit_for_review tool ────────────────────────────────────────────────────

const submitInputSchema = {
  type: 'object',
  properties: {
    stage: {
      type: 'string',
      enum: ['design'],
      description: 'Gate stage. Only "design" is supported today.',
    },
    agent: {
      type: 'string',
      description: 'ID of the design agent whose output is under review.',
    },
    title: {
      type: 'string',
      description: 'Human-readable label shown in the review queue.',
    },
    artifacts: {
      type: 'array',
      description:
        'Design artifacts to review. Each path MUST be RELATIVE to the ' +
        'opencode configDir; absolute paths and ".." traversal are rejected.',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['architecture', 'figma-spec', 'handoff', 'other'],
          },
          path: {
            type: 'string',
            description: 'Path RELATIVE to the opencode configDir.',
          },
        },
        required: ['kind', 'path'],
      },
    },
    checklist: {
      type: ['string', 'null'],
      enum: ['mtf', null],
      description: 'Rule-based checklist to auto-run, or null for none.',
    },
    expiresInSeconds: {
      type: 'number',
      description:
        'How long to block before failing closed. Defaults to 86400 (24h).',
    },
  },
  required: ['stage', 'agent', 'title', 'artifacts'],
}

const submitTool = {
  name: 'submit_for_review',
  description:
    'Submit the current design-stage artifacts to the human review gate and ' +
    'BLOCK until a decision is returned. Returns { status: "approved" | ' +
    '"rejected", notes }. On "approved" proceed to the build stage; on ' +
    '"rejected" re-spawn only the flagged design agent with the notes ' +
    'injected and submit a NEW review. The gate fails closed: timeout, a ' +
    'missing/invalid signature, or the app being closed all return ' +
    '"rejected". IMPORTANT: every artifact path MUST be RELATIVE to the ' +
    'opencode configDir.',
  inputSchema: submitInputSchema,
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Atomic write via temp file + rename (sync is fine in this standalone tool).
function atomicWriteSync(filePath, content) {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-${crypto.randomBytes(8).toString('hex')}`)
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

// Core blocking logic: write the request, then poll for a signed decision.
async function submitForReview(args, ctx) {
  if (args === null || typeof args !== 'object') {
    throw new Error('submit_for_review: arguments must be an object')
  }

  const { configDir, secret } = ctx
  const nowMs = Date.now()
  const id = crypto.randomUUID()

  const expiresInSeconds =
    typeof args.expiresInSeconds === 'number' && args.expiresInSeconds > 0
      ? args.expiresInSeconds
      : DEFAULT_EXPIRES_IN_SECONDS
  const expiresAtMs = nowMs + expiresInSeconds * 1000

  const request = {
    id,
    schemaVersion: 1,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    stage: args.stage,
    agent: args.agent,
    title: args.title,
    artifacts: args.artifacts,
    checklist: args.checklist == null ? null : args.checklist,
  }

  // Validate (and normalize) the request before it touches the bus. Throws on
  // any violation — surfaced to the caller as a tool error.
  const clean = validateReviewRequest(request)

  fs.mkdirSync(requestsDir(configDir), { recursive: true })
  const reqPath = path.join(requestsDir(configDir), `${clean.id}.json`)
  atomicWriteSync(reqPath, JSON.stringify(clean, null, 2))

  // Poll for the decision until it appears or the request expires. Falls back
  // to the archived copy if the live decision file was already consumed by the
  // app's archival step (BUG 1: archive-before-consume race).
  for (;;) {
    let decision = null
    try {
      decision = await readDecisionOrArchive(configDir, clean.id)
    } catch (err) {
      // Malformed/partial decision or archive file — log and keep polling. A
      // truly invalid file will be caught by verify() once fully written.
      logError(`could not read decision for ${clean.id}: ${err.message}`)
      decision = null
    }

    if (decision !== null) {
      // verify() returns false on a null secret, missing/short sig, or any
      // tampering → fail closed.
      const ok = verify(decision, secret)
      if (!ok) {
        return {
          status: 'rejected',
          notes: 'gate: signature verification failed',
        }
      }
      if (decision.status === 'approved') {
        return { status: 'approved', notes: decision.notes ?? '' }
      }
      // Any verified non-approved status is a rejection.
      return { status: 'rejected', notes: decision.notes ?? '' }
    }

    if (Date.now() > expiresAtMs) {
      return {
        status: 'rejected',
        notes: 'gate: timeout — no decision received',
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

// ── JSON-RPC 2.0 dispatch ─────────────────────────────────────────────────────

async function dispatch(message, ctx) {
  const { method, id, params } = message

  // Notifications (no `id`) get no response.
  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gate', version: '1.0.0' },
      },
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: [submitTool] },
    }
  }

  if (method === 'tools/call') {
    const toolName = params && params.name
    const args = (params && params.arguments) || {}
    if (toolName !== 'submit_for_review') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `unknown tool: ${String(toolName)}` },
      }
    }
    try {
      const result = await submitForReview(args, ctx)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        },
      }
    } catch (err) {
      logError(`submit_for_review failed: ${err.message}`)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'rejected',
                notes: `gate: ${err.message}`,
              }),
            },
          ],
          isError: true,
        },
      }
    }
  }

  // Notifications we don't handle: ignore silently (no id → no response).
  if (id === undefined || id === null) {
    return null
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `method not found: ${String(method)}` },
  }
}

// ── stdio Content-Length framing ──────────────────────────────────────────────

function writeMessage(obj) {
  const json = JSON.stringify(obj)
  const payload = Buffer.from(json, 'utf8')
  const header = `Content-Length: ${payload.length}\r\n\r\n`
  process.stdout.write(header)
  process.stdout.write(payload)
}

// Incrementally parse a stream of Content-Length framed messages out of a
// growing buffer. Returns the remaining (unconsumed) buffer; complete messages
// are handed to `onMessage`.
function makeFramedReader(onMessage) {
  let buffer = Buffer.alloc(0)

  return function feed(chunk) {
    buffer = Buffer.concat([buffer, chunk])

    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return // headers not complete yet

      const headerText = buffer.slice(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        // Unparseable header block — drop it and resync past the separator.
        logError('dropping message with no Content-Length header')
        buffer = buffer.slice(headerEnd + 4)
        continue
      }

      const length = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + length) return // body not fully arrived

      const body = buffer.slice(bodyStart, bodyStart + length)
      buffer = buffer.slice(bodyStart + length)

      let message
      try {
        message = JSON.parse(body.toString('utf8'))
      } catch (err) {
        logError(`failed to parse JSON-RPC message: ${err.message}`)
        continue
      }
      // Hand off; never let one bad message abort the read loop.
      Promise.resolve()
        .then(() => onMessage(message))
        .catch((err) => logError(`message handler error: ${err.message}`))
    }
  }
}

// ── startup ───────────────────────────────────────────────────────────────────

// Parse `--userDataDir <path>` out of argv; returns the path or null if absent.
function parseUserDataDirArg(argv) {
  const idx = argv.indexOf('--userDataDir')
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1]
  return null
}

function main() {
  const userDataDirArg = parseUserDataDirArg(process.argv)
  const userDataDir = deriveUserDataDir(userDataDirArg)
  const secret = loadSecretReadOnly(userDataDir)
  const configDir = deriveConfigDir(userDataDir)
  const ctx = { userDataDir, configDir, secret }

  logError(
    `started. configDir=${configDir} secret=${secret ? 'loaded' : 'MISSING (fail-closed)'}`,
  )

  const handle = async (message) => {
    let response
    try {
      response = await dispatch(message, ctx)
    } catch (err) {
      logError(`dispatch error: ${err.message}`)
      const id = message && message.id
      if (id !== undefined && id !== null) {
        response = {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `internal error: ${err.message}` },
        }
      }
    }
    if (response) writeMessage(response)
  }

  const feed = makeFramedReader(handle)
  process.stdin.on('data', (chunk) => {
    try {
      feed(chunk)
    } catch (err) {
      logError(`reader error: ${err.message}`)
    }
  })
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('error', (err) => logError(`stdin error: ${err.message}`))
}

main()
