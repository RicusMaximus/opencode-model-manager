// Gate filesystem bus — read/write the `.gate/` message bus under configDir.
//
// Layout (see spec §7.1):
//   <configDir>/.gate/requests/<id>.json    WRITER: gate tool. READER: app.
//   <configDir>/.gate/decisions/<id>.json   WRITER: app (signed). READER: tool.
//   <configDir>/.gate/archive/<id>.json     WRITER: app. Merged history.
//   <configDir>/.gate/audit.jsonl           WRITER: app. Append-only audit log.
//
// All writes go through atomicWrite (temp → rename). CommonJS.

const path = require('path')
const fs = require('fs/promises')

const { atomicWrite } = require('./utils')
const {
  validateReviewRequest,
  validateReviewDecision,
} = require('./schema')

const GATE_DIR = '.gate'
const REQUESTS_DIR = 'requests'
const DECISIONS_DIR = 'decisions'
const ARCHIVE_DIR = 'archive'
const AUDIT_FILE = 'audit.jsonl'

// ── path helpers ──────────────────────────────────────────────────────────────

function gateRoot(configDir) {
  return path.join(configDir, GATE_DIR)
}
function requestsPath(configDir, id) {
  return id != null
    ? path.join(gateRoot(configDir), REQUESTS_DIR, `${id}.json`)
    : path.join(gateRoot(configDir), REQUESTS_DIR)
}
function decisionsPath(configDir, id) {
  return id != null
    ? path.join(gateRoot(configDir), DECISIONS_DIR, `${id}.json`)
    : path.join(gateRoot(configDir), DECISIONS_DIR)
}
function archivePath(configDir, id) {
  return id != null
    ? path.join(gateRoot(configDir), ARCHIVE_DIR, `${id}.json`)
    : path.join(gateRoot(configDir), ARCHIVE_DIR)
}
function auditPath(configDir) {
  return path.join(gateRoot(configDir), AUDIT_FILE)
}

// Read + JSON.parse a file. Returns null on ENOENT; throws on parse error.
async function readJson(filePath) {
  let raw
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw new Error(`gate: failed to read ${filePath}: ${err.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`gate: invalid JSON in ${filePath}: ${err.message}`)
  }
}

// Unlink a file, ignoring ENOENT.
async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`gate: failed to unlink ${filePath}: ${err.message}`)
    }
  }
}

// ── directory bootstrap ───────────────────────────────────────────────────────

// Ensure the `.gate/` subdirectories exist (idempotent).
async function ensureGateDirs(configDir) {
  await fs.mkdir(requestsPath(configDir), { recursive: true })
  await fs.mkdir(decisionsPath(configDir), { recursive: true })
  await fs.mkdir(archivePath(configDir), { recursive: true })
}

// ── request / decision read-write ─────────────────────────────────────────────

// Write a (validated) review request to requests/<id>.json.
async function writeRequest(configDir, request) {
  const clean = validateReviewRequest(request)
  await ensureGateDirs(configDir)
  await atomicWrite(requestsPath(configDir, clean.id), JSON.stringify(clean, null, 2))
  return clean
}

// Read + validate a single request. Returns null on ENOENT; throws on
// parse/validation error.
async function readRequest(configDir, id) {
  const obj = await readJson(requestsPath(configDir, id))
  if (obj === null) return null
  return validateReviewRequest(obj)
}

// Write a (validated, signed) decision to decisions/<id>.json.
async function writeDecision(configDir, decision) {
  const clean = validateReviewDecision(decision)
  await ensureGateDirs(configDir)
  await atomicWrite(decisionsPath(configDir, clean.id), JSON.stringify(clean, null, 2))
  return clean
}

// Read + validate a single decision. Returns null on ENOENT; throws on
// parse/validation error.
async function readDecision(configDir, id) {
  const obj = await readJson(decisionsPath(configDir, id))
  if (obj === null) return null
  return validateReviewDecision(obj)
}

// Read a decision, falling back to the archived copy if the live decision file
// was already consumed by archival (BUG 1: archive-before-consume race).
//
// 1. Try decisions/<id>.json → validate + return if present.
// 2. On ENOENT/null, try archive/<id>.json → take its `.decision` field;
//    null/missing decision → null; otherwise validate + return.
// 3. Both absent → null.
//
// validateReviewDecision throwing on a corrupted archived decision is
// intentional — the caller (gate tool poll loop) treats it as fail-closed.
async function readDecisionOrArchive(configDir, id) {
  const live = await readJson(decisionsPath(configDir, id))
  if (live !== null) return validateReviewDecision(live)

  const archived = await readJson(archivePath(configDir, id))
  if (archived === null) return null
  if (archived.decision == null) return null
  return validateReviewDecision(archived.decision)
}

// ── archival ──────────────────────────────────────────────────────────────────

// Merge request+decision into archive/<id>.json, then remove the live request
// and decision files. The app is the single archiver (spec §7.7).
//
// Double-archive guard: if the archive file already exists, skip re-writing it
// but STILL unlink the live request/decision (so a retried archival converges).
// Keeps archival idempotent under races / two open windows.
async function archiveReview(configDir, id) {
  await ensureGateDirs(configDir)

  const existingArchive = await readJson(archivePath(configDir, id))
  if (existingArchive === null) {
    const request = await readJson(requestsPath(configDir, id))
    const decision = await readJson(decisionsPath(configDir, id))
    const merged = { request, decision }
    await atomicWrite(archivePath(configDir, id), JSON.stringify(merged, null, 2))
  }

  await unlinkIfExists(requestsPath(configDir, id))
  await unlinkIfExists(decisionsPath(configDir, id))
}

// ── listing ───────────────────────────────────────────────────────────────────

// Read a directory's *.json entries. Returns [] if the directory is missing.
async function listJsonFiles(dirPath) {
  let entries
  try {
    entries = await fs.readdir(dirPath)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw new Error(`gate: failed to read dir ${dirPath}: ${err.message}`)
  }
  return entries.filter((name) => name.endsWith('.json'))
}

// List pending requests: every request without a matching decision. Malformed
// entries are skipped with a console.warn (never throws). Returns QueueItem[]
// sorted by createdAt ascending.
async function listPendingRequests(configDir) {
  const files = await listJsonFiles(requestsPath(configDir))
  const now = Date.now()
  const items = []

  for (const file of files) {
    const id = file.replace(/\.json$/, '')
    try {
      const decision = await readJson(decisionsPath(configDir, id))
      if (decision !== null) continue // already decided → not pending

      const raw = await readJson(requestsPath(configDir, id))
      if (raw === null) continue // vanished between listing and read
      const request = validateReviewRequest(raw)

      items.push({
        id: request.id,
        title: request.title,
        agent: request.agent,
        stage: request.stage,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        artifactKinds: request.artifacts.map((a) => a.kind),
        isExpired: Date.parse(request.expiresAt) < now,
      })
    } catch (err) {
      console.warn(`gate: skipping malformed request '${id}': ${err.message}`)
    }
  }

  items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  return items
}

// List archived reviews for the History tab. Skips malformed entries. Returns
// array of { id, title, agent, status, notes, decidedAt } sorted by decidedAt
// descending (most recent first).
async function listArchivedReviews(configDir) {
  const files = await listJsonFiles(archivePath(configDir))
  const items = []

  for (const file of files) {
    const id = file.replace(/\.json$/, '')
    try {
      const archived = await readJson(archivePath(configDir, id))
      if (archived === null) continue
      const { request, decision } = archived
      if (!decision || !request) continue
      items.push({
        id: decision.id ?? request.id ?? id,
        title: request.title ?? '',
        agent: request.agent ?? '',
        status: decision.status ?? '',
        notes: decision.notes ?? '',
        decidedAt: decision.decidedAt ?? '',
      })
    } catch (err) {
      console.warn(`gate: skipping malformed archive '${id}': ${err.message}`)
    }
  }

  items.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt))
  return items
}

// ── audit log ─────────────────────────────────────────────────────────────────

// Append a newline-delimited JSON entry to .gate/audit.jsonl.
// entry: { id, status, decidedAt, agentName? }.
async function appendAuditEntry(configDir, entry) {
  await ensureGateDirs(configDir)
  const line = JSON.stringify(entry) + '\n'
  try {
    await fs.appendFile(auditPath(configDir), line, 'utf8')
  } catch (err) {
    throw new Error(`gate: failed to append audit entry: ${err.message}`)
  }
}

module.exports = {
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
}
