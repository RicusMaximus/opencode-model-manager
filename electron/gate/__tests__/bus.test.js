// Tests for electron/gate/bus.js
// §9 matrix: Integration — gate bus read/write/archive/list/audit

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const require = createRequire(import.meta.url)
const {
  GATE_DIR,
  ensureGateDirs,
  writeRequest,
  readRequest,
  writeDecision,
  readDecision,
  readDecisionOrArchive,
  archiveReview,
  listPendingRequests,
  listArchivedReviews,
  appendAuditEntry,
} = require('../bus.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gate-bus-test-'))
}

let tmpDir

beforeEach(async () => {
  tmpDir = await makeTempDir()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// Build a valid, minimal review request.
function makeRequest(overrides = {}) {
  const now = new Date().toISOString()
  const exp = new Date(Date.now() + 86400000).toISOString()
  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: 1,
    createdAt: now,
    expiresAt: exp,
    stage: 'design',
    agent: 'architect',
    title: 'Test review',
    artifacts: [{ kind: 'architecture', path: 'docs/arch.md' }],
    checklist: null,
    ...overrides,
  }
}

// Build a valid decision (no sig — tests add sig as needed).
function makeDecision(requestId, overrides = {}) {
  return {
    id: requestId,
    schemaVersion: 1,
    status: 'approved',
    notes: '',
    decidedAt: new Date().toISOString(),
    sig: 'fakesig-for-bus-tests',
    ...overrides,
  }
}

// ── ensureGateDirs ────────────────────────────────────────────────────────────

describe('ensureGateDirs', () => {
  it('creates requests/, decisions/, and archive/ under .gate/', async () => {
    await ensureGateDirs(tmpDir)
    const gateRoot = path.join(tmpDir, GATE_DIR)
    const [reqStat, decStat, arcStat] = await Promise.all([
      fs.stat(path.join(gateRoot, 'requests')),
      fs.stat(path.join(gateRoot, 'decisions')),
      fs.stat(path.join(gateRoot, 'archive')),
    ])
    expect(reqStat.isDirectory()).toBe(true)
    expect(decStat.isDirectory()).toBe(true)
    expect(arcStat.isDirectory()).toBe(true)
  })

  it('is idempotent (calling twice does not throw)', async () => {
    await ensureGateDirs(tmpDir)
    await expect(ensureGateDirs(tmpDir)).resolves.not.toThrow()
  })
})

// ── writeRequest / readRequest ────────────────────────────────────────────────

describe('writeRequest / readRequest', () => {
  it('round-trips a valid request', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const loaded = await readRequest(tmpDir, req.id)
    expect(loaded).not.toBeNull()
    expect(loaded.id).toBe(req.id)
    expect(loaded.title).toBe(req.title)
    expect(loaded.agent).toBe(req.agent)
    expect(loaded.artifacts).toEqual(req.artifacts)
  })

  it('readRequest returns null on ENOENT', async () => {
    const result = await readRequest(tmpDir, 'nonexistent-id')
    expect(result).toBeNull()
  })

  it('writeRequest validates before writing (throws on invalid input)', async () => {
    const invalid = makeRequest({ schemaVersion: 99 })
    await expect(writeRequest(tmpDir, invalid)).rejects.toThrow()
  })

  it('writeRequest strips unknown fields', async () => {
    const req = makeRequest({ unknownField: 'should-be-stripped' })
    const written = await writeRequest(tmpDir, req)
    expect(written).not.toHaveProperty('unknownField')
    const loaded = await readRequest(tmpDir, req.id)
    expect(loaded).not.toHaveProperty('unknownField')
  })

  it('written file is valid JSON on disk', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const filePath = path.join(tmpDir, GATE_DIR, 'requests', `${req.id}.json`)
    const raw = await fs.readFile(filePath, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

// ── writeDecision / readDecision ──────────────────────────────────────────────

describe('writeDecision / readDecision', () => {
  it('round-trips a valid approved decision', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const decision = makeDecision(req.id)
    await writeDecision(tmpDir, decision)

    const loaded = await readDecision(tmpDir, req.id)
    expect(loaded).not.toBeNull()
    expect(loaded.id).toBe(req.id)
    expect(loaded.status).toBe('approved')
    expect(loaded.sig).toBe(decision.sig)
  })

  it('readDecision returns null on ENOENT', async () => {
    const result = await readDecision(tmpDir, 'nonexistent-id')
    expect(result).toBeNull()
  })

  it('writeDecision validates before writing (throws on missing sig)', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const invalid = makeDecision(req.id, { sig: '' })
    await expect(writeDecision(tmpDir, invalid)).rejects.toThrow()
  })

  it('writeDecision validates notes required for rejected', async () => {
    const req = makeRequest()
    const invalid = makeDecision(req.id, { status: 'rejected', notes: '' })
    await expect(writeDecision(tmpDir, invalid)).rejects.toThrow()
  })
})

// ── archiveReview ─────────────────────────────────────────────────────────────

describe('archiveReview', () => {
  it('creates an archive file containing merged request+decision', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    await writeDecision(tmpDir, makeDecision(req.id))
    await archiveReview(tmpDir, req.id)

    const archivePath = path.join(tmpDir, GATE_DIR, 'archive', `${req.id}.json`)
    const raw = await fs.readFile(archivePath, 'utf8')
    const archived = JSON.parse(raw)
    expect(archived).toHaveProperty('request')
    expect(archived).toHaveProperty('decision')
    expect(archived.request.id).toBe(req.id)
    expect(archived.decision.id).toBe(req.id)
  })

  it('removes the live request and decision files after archiving', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    await writeDecision(tmpDir, makeDecision(req.id))
    await archiveReview(tmpDir, req.id)

    const reqPath = path.join(tmpDir, GATE_DIR, 'requests', `${req.id}.json`)
    const decPath = path.join(tmpDir, GATE_DIR, 'decisions', `${req.id}.json`)
    await expect(fs.access(reqPath)).rejects.toThrow()
    await expect(fs.access(decPath)).rejects.toThrow()
  })

  it('is idempotent: calling twice does not throw and does not create a second archive file', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    await writeDecision(tmpDir, makeDecision(req.id))

    await archiveReview(tmpDir, req.id)
    // Second call: request/decision already gone, archive already exists.
    await expect(archiveReview(tmpDir, req.id)).resolves.not.toThrow()

    // Only one archive file should exist.
    const archiveDir = path.join(tmpDir, GATE_DIR, 'archive')
    const files = await fs.readdir(archiveDir)
    const matching = files.filter((f) => f === `${req.id}.json`)
    expect(matching).toHaveLength(1)
  })
})

// ── listPendingRequests ───────────────────────────────────────────────────────

describe('listPendingRequests', () => {
  it('returns [] when there are no request files', async () => {
    await ensureGateDirs(tmpDir)
    const result = await listPendingRequests(tmpDir)
    expect(result).toEqual([])
  })

  it('returns pending requests (those without a matching decision)', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const items = await listPendingRequests(tmpDir)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(req.id)
    expect(items[0].title).toBe(req.title)
    expect(items[0].agent).toBe(req.agent)
    expect(Array.isArray(items[0].artifactKinds)).toBe(true)
    expect(typeof items[0].isExpired).toBe('boolean')
  })

  it('does NOT include requests that already have a decision', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    await writeDecision(tmpDir, makeDecision(req.id))
    const items = await listPendingRequests(tmpDir)
    expect(items).toHaveLength(0)
  })

  it('skips a malformed request file without throwing', async () => {
    await ensureGateDirs(tmpDir)
    // Write garbage JSON to a request file.
    const garbagePath = path.join(tmpDir, GATE_DIR, 'requests', 'garbage-id.json')
    await fs.writeFile(garbagePath, 'NOT VALID JSON {{{', 'utf8')
    // Also write a valid request alongside.
    const good = makeRequest()
    await writeRequest(tmpDir, good)

    // Should not throw — just call and verify the result.
    const items = await listPendingRequests(tmpDir)
    // Only the valid request should appear.
    expect(items.length).toBe(1)
    expect(items[0].id).toBe(good.id)
  })

  it('sets isExpired=true for requests with a past expiresAt', async () => {
    const req = makeRequest({
      expiresAt: new Date(Date.now() - 10000).toISOString(), // 10 seconds in the past
    })
    await writeRequest(tmpDir, req)
    const items = await listPendingRequests(tmpDir)
    expect(items[0].isExpired).toBe(true)
  })

  it('sets isExpired=false for requests with a future expiresAt', async () => {
    const req = makeRequest({
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour ahead
    })
    await writeRequest(tmpDir, req)
    const items = await listPendingRequests(tmpDir)
    expect(items[0].isExpired).toBe(false)
  })

  it('sorts results by createdAt ascending', async () => {
    const older = makeRequest({
      id: 'older-req',
      createdAt: new Date(Date.now() - 5000).toISOString(),
    })
    const newer = makeRequest({
      id: 'newer-req',
      createdAt: new Date(Date.now()).toISOString(),
    })
    await writeRequest(tmpDir, newer)
    await writeRequest(tmpDir, older)

    const items = await listPendingRequests(tmpDir)
    expect(items[0].id).toBe('older-req')
    expect(items[1].id).toBe('newer-req')
  })
})

// ── listArchivedReviews ───────────────────────────────────────────────────────

describe('listArchivedReviews', () => {
  it('returns [] when archive is empty', async () => {
    await ensureGateDirs(tmpDir)
    const result = await listArchivedReviews(tmpDir)
    expect(result).toEqual([])
  })

  it('returns archived entries with expected fields', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    await writeDecision(tmpDir, makeDecision(req.id))
    await archiveReview(tmpDir, req.id)

    const items = await listArchivedReviews(tmpDir)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(req.id)
    expect(items[0].title).toBe(req.title)
    expect(items[0].agent).toBe(req.agent)
    expect(items[0].status).toBe('approved')
  })

  it('sorts by decidedAt descending (most recent first)', async () => {
    const req1 = makeRequest({ id: 'req-1', title: 'Older review' })
    const req2 = makeRequest({ id: 'req-2', title: 'Newer review' })
    await writeRequest(tmpDir, req1)
    await writeRequest(tmpDir, req2)
    await writeDecision(tmpDir, makeDecision(req1.id, { decidedAt: new Date(Date.now() - 10000).toISOString() }))
    await writeDecision(tmpDir, makeDecision(req2.id, { decidedAt: new Date(Date.now()).toISOString() }))
    await archiveReview(tmpDir, req1.id)
    await archiveReview(tmpDir, req2.id)

    const items = await listArchivedReviews(tmpDir)
    expect(items[0].id).toBe('req-2') // newer first
    expect(items[1].id).toBe('req-1')
  })
})

// ── readDecisionOrArchive ─────────────────────────────────────────────────────
//
// These five tests cover the BUG 1 (archive-race) fix.  Test 3 is the headline
// regression: it proves that readDecisionOrArchive returns the decision AFTER
// archiveReview has unlinked the live decisions/<id>.json file.

describe('readDecisionOrArchive', () => {
  // 1. Returns the live decision from decisions/<id>.json when present.
  it('returns the live decision when decisions/<id>.json is present', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const decision = makeDecision(req.id)
    await writeDecision(tmpDir, decision)

    const result = await readDecisionOrArchive(tmpDir, req.id)
    expect(result).not.toBeNull()
    expect(result.id).toBe(req.id)
    expect(result.status).toBe('approved')
    expect(result.sig).toBe(decision.sig)
  })

  // 2. Returns null when neither decisions/ nor archive/ has the id.
  it('returns null when neither decisions/ nor archive/ has the id', async () => {
    await ensureGateDirs(tmpDir)
    const result = await readDecisionOrArchive(tmpDir, 'nonexistent-id')
    expect(result).toBeNull()
  })

  // 3. ARCHIVE-RACE REGRESSION — the headline proof that the bug is fixed.
  //
  //    Before the fix: the poll loop called readDecision() directly.  After
  //    archiveReview() unlinked decisions/<id>.json, readDecision() returned null
  //    and the loop kept polling until timeout → rejected.
  //
  //    After the fix: readDecisionOrArchive() falls back to archive/<id>.json.
  //    This test MUST PASS on the fixed code and would have FAILED on the old code.
  it('ARCHIVE-RACE REGRESSION: returns decision from archive after archiveReview removes the live file', async () => {
    const req = makeRequest()
    await writeRequest(tmpDir, req)
    const decision = makeDecision(req.id)
    await writeDecision(tmpDir, decision)

    // Simulate the app archiving the review (writes archive/<id>.json, then
    // unlinks both decisions/<id>.json and requests/<id>.json).
    await archiveReview(tmpDir, req.id)

    // Verify the live decision file is gone — the race condition is now active.
    const decPath = path.join(tmpDir, GATE_DIR, 'decisions', `${req.id}.json`)
    await expect(fs.access(decPath)).rejects.toThrow()

    // KEY ASSERTION: readDecisionOrArchive must fall back to the archive and
    // return the decision — not null.
    const result = await readDecisionOrArchive(tmpDir, req.id)
    expect(result).not.toBeNull()
    expect(result.id).toBe(req.id)
    expect(result.status).toBe('approved')
    expect(result.sig).toBe(decision.sig)
  })

  // 4. Archive present but .decision is null → returns null.
  it('returns null when the archive file has decision: null', async () => {
    await ensureGateDirs(tmpDir)
    const id = `race-null-${Date.now()}`
    const archiveFilePath = path.join(tmpDir, GATE_DIR, 'archive', `${id}.json`)
    // Hand-craft an archive file that has no decision payload.
    await fs.writeFile(
      archiveFilePath,
      JSON.stringify({ request: makeRequest({ id }), decision: null }),
      'utf8',
    )

    const result = await readDecisionOrArchive(tmpDir, id)
    expect(result).toBeNull()
  })

  // 5. Archived decision with empty sig → validateReviewDecision throws (fail-closed).
  it('throws when the archived decision has an empty sig (validateReviewDecision enforcement)', async () => {
    await ensureGateDirs(tmpDir)
    const id = `race-badsig-${Date.now()}`
    const archiveFilePath = path.join(tmpDir, GATE_DIR, 'archive', `${id}.json`)
    // Hand-craft an archive with a malformed decision: sig is an empty string,
    // which requireNonEmptyString('decision.sig') rejects.
    const malformedDecision = {
      id,
      schemaVersion: 1,
      status: 'approved',
      notes: '',
      decidedAt: new Date().toISOString(),
      sig: '', // empty → validateReviewDecision throws
    }
    await fs.writeFile(
      archiveFilePath,
      JSON.stringify({ request: makeRequest({ id }), decision: malformedDecision }),
      'utf8',
    )

    await expect(readDecisionOrArchive(tmpDir, id)).rejects.toThrow()
  })
})

// ── appendAuditEntry ──────────────────────────────────────────────────────────

describe('appendAuditEntry', () => {
  it('creates the audit file and appends a valid JSONL entry', async () => {
    const entry = { id: 'review-001', status: 'approved', decidedAt: new Date().toISOString() }
    await appendAuditEntry(tmpDir, entry)

    const auditPath = path.join(tmpDir, GATE_DIR, 'audit.jsonl')
    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.id).toBe('review-001')
    expect(parsed.status).toBe('approved')
  })

  it('appends multiple entries as separate JSONL lines', async () => {
    const entries = [
      { id: 'r1', status: 'approved', decidedAt: new Date().toISOString() },
      { id: 'r2', status: 'rejected', decidedAt: new Date().toISOString() },
      { id: 'r3', status: 'approved', decidedAt: new Date().toISOString() },
    ]
    for (const entry of entries) {
      await appendAuditEntry(tmpDir, entry)
    }

    const auditPath = path.join(tmpDir, GATE_DIR, 'audit.jsonl')
    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(3)

    const parsed = lines.map((l) => JSON.parse(l))
    expect(parsed[0].id).toBe('r1')
    expect(parsed[1].id).toBe('r2')
    expect(parsed[2].id).toBe('r3')
  })

  it('each appended line is individually parseable as JSON', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAuditEntry(tmpDir, {
        id: `review-${i}`,
        status: i % 2 === 0 ? 'approved' : 'rejected',
        decidedAt: new Date().toISOString(),
        agentName: `agent-${i}`,
      })
    }

    const auditPath = path.join(tmpDir, GATE_DIR, 'audit.jsonl')
    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(5)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })
})
