// Integration tests for gate-tool/gate-mcp-server.js
// §9 matrix: Integration — gate tool (spawn real process)
//
// Tests:
//   1. initialize → serverInfo.name === 'gate'
//   2. tools/list → includes submit_for_review
//   3. APPROVE round-trip: submit → write signed decision → {status:'approved'}
//   4. TIMEOUT: submit with expiresInSeconds:1, write no decision → {status:'rejected'}
//   5. FORGED: submit → write decision with bad sig → {status:'rejected', notes contains 'signature'}

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

const require = createRequire(import.meta.url)
const { generateSecret, sign } = require('../../electron/gate/security.js')

const SERVER_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  'gate-mcp-server.js'
)

// ── Content-Length framing helpers ────────────────────────────────────────────

/**
 * Serialize a JSON-RPC message with Content-Length framing (MCP standard).
 */
function frameMessage(obj) {
  const json = JSON.stringify(obj)
  const bodyBuf = Buffer.from(json, 'utf8')
  const header = `Content-Length: ${bodyBuf.length}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, 'utf8'), bodyBuf])
}

/**
 * Create an incremental Content-Length frame reader.
 * Returns an object with:
 *   - feed(chunk: Buffer): void  — feed incoming data
 *   - nextMessage(timeout): Promise<object>  — resolve with next parsed message
 */
function makeFrameReader() {
  let buf = Buffer.alloc(0)
  const pending = []  // unresolved nextMessage promises
  const ready = []    // parsed messages waiting to be consumed

  function tryParse() {
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n')
      if (sep === -1) return
      const headerText = buf.slice(0, sep).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        buf = buf.slice(sep + 4)
        continue
      }
      const length = parseInt(match[1], 10)
      const bodyStart = sep + 4
      if (buf.length < bodyStart + length) return
      const body = buf.slice(bodyStart, bodyStart + length)
      buf = buf.slice(bodyStart + length)
      let msg
      try {
        msg = JSON.parse(body.toString('utf8'))
      } catch {
        continue
      }
      // Deliver to next waiter or buffer.
      if (pending.length > 0) {
        const { resolve } = pending.shift()
        resolve(msg)
      } else {
        ready.push(msg)
      }
    }
  }

  return {
    feed(chunk) {
      buf = Buffer.concat([buf, chunk])
      tryParse()
    },
    nextMessage(timeoutMs = 10000) {
      if (ready.length > 0) return Promise.resolve(ready.shift())
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pending.findIndex((p) => p.resolve === resolve)
          if (idx !== -1) pending.splice(idx, 1)
          reject(new Error(`nextMessage timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        pending.push({
          resolve: (msg) => {
            clearTimeout(timer)
            resolve(msg)
          },
        })
      })
    },
  }
}

// ── Process lifecycle helpers ─────────────────────────────────────────────────

/**
 * Set up a temp dir structure and spawn the MCP server.
 * Returns { proc, reader, send, secret, configDir, requestsDir, decisionsDir,
 *           archiveDir, cleanup, tmpBase, userDataDir }.
 */
async function spawnServer() {
  // Create the temp base (this becomes APPDATA on Windows).
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-mcp-test-'))

  // userDataDir = <APPDATA>/OpenCode Agent Manager  (mirrors deriveUserDataDir on win32)
  const userDataDir = path.join(tmpBase, 'OpenCode Agent Manager')
  await fs.mkdir(userDataDir, { recursive: true })

  // Generate + write the HMAC secret (app-owned; server reads it).
  const secret = generateSecret()
  await fs.writeFile(path.join(userDataDir, 'gate-secret.key'), secret, 'utf8')

  // Write prefs.json so the server knows where configDir is.
  const configDir = path.join(tmpBase, 'config')
  await fs.mkdir(path.join(configDir, '.gate', 'requests'), { recursive: true })
  await fs.mkdir(path.join(configDir, '.gate', 'decisions'), { recursive: true })
  await fs.mkdir(path.join(configDir, '.gate', 'archive'), { recursive: true })
  await fs.writeFile(
    path.join(userDataDir, 'prefs.json'),
    JSON.stringify({ configDir }),
    'utf8'
  )

  const requestsDir = path.join(configDir, '.gate', 'requests')
  const decisionsDir = path.join(configDir, '.gate', 'decisions')
  const archiveDir  = path.join(configDir, '.gate', 'archive')

  const env = {
    ...process.env,
    APPDATA: tmpBase,  // win32: deriveUserDataDir uses APPDATA
  }

  const proc = spawn('node', [SERVER_PATH], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const reader = makeFrameReader()
  proc.stdout.on('data', (chunk) => reader.feed(chunk))

  const send = (obj) => {
    const buf = frameMessage(obj)
    proc.stdin.write(buf)
  }

  const cleanup = async () => {
    try { proc.stdin.end() } catch { /* ignore */ }
    await new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve()
      proc.once('exit', resolve)
      setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 200)
    })
    await fs.rm(tmpBase, { recursive: true, force: true })
  }

  return { proc, reader, send, secret, configDir, requestsDir, decisionsDir, archiveDir, cleanup, tmpBase, userDataDir }
}

/**
 * Flexible spawn helper for the userData-resolution and fail-closed tests.
 *
 * opts:
 *   userDataDirName        — subdirectory name under tmpBase for the userDataDir
 *                            (default: 'OpenCode Agent Manager').  The secret
 *                            and prefs.json are written here.
 *   noSecret               — if true, skip writing gate-secret.key (null secret).
 *   passExplicitUserDataDir — if true, pass `--userDataDir <computed userDataDir>`
 *                            to the server process (so the explicit arg wins over
 *                            any auto-probe logic).
 *
 * Returns the same shape as spawnServer() plus userDataDir.
 */
async function spawnServerWith(opts = {}) {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-mcp-test2-'))

  const userDataDirName = opts.userDataDirName || 'OpenCode Agent Manager'
  const userDataDir = path.join(tmpBase, userDataDirName)
  await fs.mkdir(userDataDir, { recursive: true })

  let secret = null
  if (!opts.noSecret) {
    secret = generateSecret()
    await fs.writeFile(path.join(userDataDir, 'gate-secret.key'), secret, 'utf8')
  }

  const configDir = path.join(tmpBase, 'config')
  await fs.mkdir(path.join(configDir, '.gate', 'requests'), { recursive: true })
  await fs.mkdir(path.join(configDir, '.gate', 'decisions'), { recursive: true })
  await fs.mkdir(path.join(configDir, '.gate', 'archive'),  { recursive: true })
  await fs.writeFile(
    path.join(userDataDir, 'prefs.json'),
    JSON.stringify({ configDir }),
    'utf8'
  )

  const requestsDir = path.join(configDir, '.gate', 'requests')
  const decisionsDir = path.join(configDir, '.gate', 'decisions')
  const archiveDir  = path.join(configDir, '.gate', 'archive')

  const env = { ...process.env, APPDATA: tmpBase }

  // If passExplicitUserDataDir is set, inject the computed path as --userDataDir.
  // This lets tests assert that the explicit arg wins over candidate probing.
  const serverArgs = [SERVER_PATH]
  if (opts.passExplicitUserDataDir) {
    serverArgs.push('--userDataDir', userDataDir)
  }

  const proc = spawn('node', serverArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const reader = makeFrameReader()
  proc.stdout.on('data', (chunk) => reader.feed(chunk))
  const send = (obj) => { proc.stdin.write(frameMessage(obj)) }

  const cleanup = async () => {
    try { proc.stdin.end() } catch { /* ignore */ }
    await new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve()
      proc.once('exit', resolve)
      setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 200)
    })
    await fs.rm(tmpBase, { recursive: true, force: true })
  }

  return { proc, reader, send, secret, configDir, requestsDir, decisionsDir, archiveDir, cleanup, tmpBase, userDataDir }
}

// Poll a directory for new .json files (returns the first new filename found).
async function waitForFile(dir, existingFiles = [], timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let entries
    try { entries = await fs.readdir(dir) } catch { entries = [] }
    const newFile = entries.find((f) => f.endsWith('.json') && !existingFiles.includes(f))
    if (newFile) return newFile
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('gate-mcp-server', () => {
  let ctx

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup()
      ctx = null
    }
  })

  // ── 1. initialize ──────────────────────────────────────────────────────────

  it('initialize returns serverInfo.name === "gate"', async () => {
    ctx = await spawnServer()
    ctx.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test' } },
    })

    const resp = await ctx.reader.nextMessage(5000)
    expect(resp.id).toBe(1)
    expect(resp.result?.serverInfo?.name).toBe('gate')
    expect(resp.result?.capabilities?.tools).toBeDefined()
  }, 10000)

  // ── 2. tools/list ─────────────────────────────────────────────────────────

  it('tools/list includes submit_for_review', async () => {
    ctx = await spawnServer()

    // Initialize first (MCP protocol requirement).
    ctx.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await ctx.reader.nextMessage(5000)

    // Notify initialized.
    ctx.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    ctx.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const resp = await ctx.reader.nextMessage(5000)
    expect(resp.id).toBe(2)
    const tools = resp.result?.tools ?? []
    expect(tools.some((t) => t.name === 'submit_for_review')).toBe(true)
  }, 10000)

  // ── 3. APPROVE round-trip ─────────────────────────────────────────────────

  it('APPROVE: submit then write a valid signed decision → {status:"approved"}', async () => {
    ctx = await spawnServer()
    const { send, reader, secret, requestsDir, decisionsDir } = ctx

    // Initialize.
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    // Call submit_for_review with a long expiry.
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Approve test',
          artifacts: [{ kind: 'architecture', path: 'docs/arch.md' }],
          expiresInSeconds: 60,
        },
      },
    })

    // Wait for the request file to appear.
    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()

    const requestId = reqFile.replace(/\.json$/, '')

    // Build + sign an approved decision.
    const decidedAt = new Date().toISOString()
    const decision = {
      id: requestId,
      schemaVersion: 1,
      status: 'approved',
      notes: '',
      decidedAt,
    }
    decision.sig = sign(decision, secret)

    // Write the decision file atomically (match what the app does).
    const decPath = path.join(decisionsDir, `${requestId}.json`)
    const tmpPath = decPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(decision, null, 2), 'utf8')
    await fs.rename(tmpPath, decPath)

    // Wait for the tool to respond (up to 6s to allow for one 2s poll cycle).
    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(3)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('approved')
  }, 15000)

  // ── 4. TIMEOUT: no decision written ──────────────────────────────────────

  it('TIMEOUT: submit with expiresInSeconds:1 and no decision → {status:"rejected", notes contain "timeout"}', async () => {
    ctx = await spawnServer()
    const { send, reader } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Timeout test',
          artifacts: [{ kind: 'other', path: 'docs/spec.md' }],
          expiresInSeconds: 1, // expires in 1 second
        },
      },
    })

    // The server polls every 2s, expiry is 1s from creation.
    // After one sleep(2000) the expiry check fires → should respond ~2-3s.
    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(4)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('rejected')
    expect(result.notes.toLowerCase()).toContain('timeout')
  }, 15000)

  // ── 5. FORGED: decision with bogus signature ──────────────────────────────
  //
  // (Tests 6-9 follow below — archive-race E2E + userData resolution.)

  it('FORGED: decision with invalid sig → {status:"rejected", notes contain "signature"}', async () => {
    ctx = await spawnServer()
    const { send, reader, requestsDir, decisionsDir } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Forged decision test',
          artifacts: [{ kind: 'other', path: 'docs/spec.md' }],
          expiresInSeconds: 30,
        },
      },
    })

    // Wait for the request file to appear.
    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()
    const requestId = reqFile.replace(/\.json$/, '')

    // Build a forged (unsigned / wrong sig) decision.
    const forgedDecision = {
      id: requestId,
      schemaVersion: 1,
      status: 'approved',
      notes: '',
      decidedAt: new Date().toISOString(),
      sig: '0'.repeat(64), // all-zero signature: wrong but correct length
    }

    const decPath = path.join(decisionsDir, `${requestId}.json`)
    const tmpPath = decPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(forgedDecision, null, 2), 'utf8')
    await fs.rename(tmpPath, decPath)

    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(5)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('rejected')
    expect(result.notes.toLowerCase()).toContain('signature')
  }, 15000)

  // ── 6. ARCHIVE-RACE end-to-end ────────────────────────────────────────────
  //
  // Reproduces the exact Bug 1 scenario at the process level:
  //   1. submit_for_review is sent (server now blocking/polling).
  //   2. App writes archive/<id>.json (signed decision inside).
  //   3. App DOES NOT write decisions/<id>.json (or immediately unlinks it).
  //   4. Server's poll loop must fall back to the archive → return approved.
  //
  // On pre-fix code (readDecision() only) the tool would time-out → rejected.
  // On fixed code (readDecisionOrArchive()) the tool returns approved.

  it('ARCHIVE-RACE E2E: server returns approved after app writes archive but never writes decisions/<id>.json', async () => {
    ctx = await spawnServer()
    const { send, reader, secret, requestsDir, archiveDir } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Archive-race E2E test',
          artifacts: [{ kind: 'architecture', path: 'docs/arch.md' }],
          expiresInSeconds: 60,
        },
      },
    })

    // Wait for the request file to land.
    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()
    const requestId = reqFile.replace(/\.json$/, '')

    // Build a valid signed decision.
    const decidedAt = new Date().toISOString()
    const decision = { id: requestId, schemaVersion: 1, status: 'approved', notes: '', decidedAt }
    decision.sig = sign(decision, secret)

    // Read the request file so we can embed it in the archive (mimics what the
    // app does in bus.archiveReview: it merges request+decision).
    const reqRaw = await fs.readFile(path.join(requestsDir, reqFile), 'utf8')
    const request = JSON.parse(reqRaw)

    // SIMULATE THE RACE: write only the archive file — never write decisions/<id>.json.
    // This is the exact condition that caused the original bug.
    const archivePath = path.join(archiveDir, `${requestId}.json`)
    const tmpPath = archivePath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify({ request, decision }, null, 2), 'utf8')
    await fs.rename(tmpPath, archivePath)

    // The server's next poll must find the archive fallback and respond.
    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(6)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('approved')
  }, 18000)

  // ── 7. userData: package-name candidate (dev-dir resolution) ──────────────
  //
  // Secret lives in <APPDATA>/opencode-agent-gui (the package `name`).
  // No --userDataDir arg is passed.  The multi-candidate probe must find
  // opencode-agent-gui BEFORE OpenCode Agent Manager (package-name first).

  it('userData: secret in opencode-agent-gui candidate resolves without --userDataDir', async () => {
    // Place secret in the package-name dir, not the product-name dir.
    ctx = await spawnServerWith({ userDataDirName: 'opencode-agent-gui' })
    const { send, reader, secret, requestsDir, decisionsDir } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Package-name candidate test',
          artifacts: [{ kind: 'other', path: 'docs/plan.md' }],
          expiresInSeconds: 60,
        },
      },
    })

    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()
    const requestId = reqFile.replace(/\.json$/, '')

    const decidedAt = new Date().toISOString()
    const decision = { id: requestId, schemaVersion: 1, status: 'approved', notes: '', decidedAt }
    decision.sig = sign(decision, secret)

    const decPath = path.join(decisionsDir, `${requestId}.json`)
    const tmpPath = decPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(decision, null, 2), 'utf8')
    await fs.rename(tmpPath, decPath)

    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(7)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('approved')
  }, 18000)

  // ── 8. userData: explicit --userDataDir override ───────────────────────────
  //
  // Secret lives in 'custom-explicit-dir', which is NOT one of the auto-probe
  // candidates (opencode-agent-gui / OpenCode Agent Manager).  Without the
  // --userDataDir arg the probe would fall back to candidates[0] (wrong dir,
  // no secret), but the explicit arg passes the correct path → approve works.

  it('userData: explicit --userDataDir override wins over auto-probe candidates', async () => {
    // spawnServerWith with passExplicitUserDataDir:true threads --userDataDir
    // <computed userDataDir> into the server args in a single spawn — no
    // double-spawn / cleanup-before-use risk.
    ctx = await spawnServerWith({
      userDataDirName: 'custom-explicit-dir',   // NOT in the candidate list
      passExplicitUserDataDir: true,            // pass --userDataDir <path>
    })
    const { send, reader, secret, requestsDir, decisionsDir } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Explicit userDataDir override test',
          artifacts: [{ kind: 'other', path: 'docs/plan.md' }],
          expiresInSeconds: 60,
        },
      },
    })

    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()
    const requestId = reqFile.replace(/\.json$/, '')

    const decidedAt = new Date().toISOString()
    const decision = { id: requestId, schemaVersion: 1, status: 'approved', notes: '', decidedAt }
    decision.sig = sign(decision, secret)

    const decPath = path.join(decisionsDir, `${requestId}.json`)
    const tmpPath = decPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(decision, null, 2), 'utf8')
    await fs.rename(tmpPath, decPath)

    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(8)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('approved')
  }, 18000)

  // ── 9. fail-closed: null secret → verify always false → rejected ──────────
  //
  // userDataDir exists and has prefs.json (so the server's configDir is our
  // isolated temp dir, not ~/.config/opencode), but has NO gate-secret.key.
  // Server loads null secret.  Any well-formed decision fails verify() →
  // returned as rejected with "signature verification failed".
  //
  // We use passExplicitUserDataDir:true so the server is told exactly which dir
  // to use (keeping the test isolated) without a double-spawn pattern.

  it('fail-closed: null secret (no gate-secret.key) → any decision is rejected with signature note', async () => {
    ctx = await spawnServerWith({
      userDataDirName: 'no-secret-dir',
      noSecret: true,
      passExplicitUserDataDir: true,  // server reads prefs.json from this dir → controlled configDir
    })
    const { send, reader, requestsDir, decisionsDir } = ctx

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } })
    await reader.nextMessage(5000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    send({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'submit_for_review',
        arguments: {
          stage: 'design',
          agent: 'architect',
          title: 'Fail-closed null-secret test',
          artifacts: [{ kind: 'other', path: 'docs/plan.md' }],
          expiresInSeconds: 60,
        },
      },
    })

    const reqFile = await waitForFile(requestsDir, [], 5000)
    expect(reqFile).not.toBeNull()
    const requestId = reqFile.replace(/\.json$/, '')

    // Write a properly formatted decision with a non-empty fake sig.
    // Server has null secret → verify(decision, null) returns false regardless.
    const fakeDecision = {
      id: requestId,
      schemaVersion: 1,
      status: 'approved',
      notes: '',
      decidedAt: new Date().toISOString(),
      sig: 'a'.repeat(64), // valid length, wrong value; fails with null secret
    }

    const decPath = path.join(decisionsDir, `${requestId}.json`)
    const tmpPath = decPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(fakeDecision, null, 2), 'utf8')
    await fs.rename(tmpPath, decPath)

    const resp = await reader.nextMessage(8000)
    expect(resp.id).toBe(9)
    const content = resp.result?.content?.[0]?.text
    expect(content).toBeDefined()
    const result = JSON.parse(content)
    expect(result.status).toBe('rejected')
    expect(result.notes.toLowerCase()).toContain('signature')
  }, 18000)
})
