// Gate schema validators — plain JS, no external validation lib.
//
// Every value crossing a trust boundary (agent-written request files, renderer
// IPC args, decision files read by the gate tool) is validated here. Validators
// throw a descriptive Error on the FIRST violation and return a clean object
// containing only known fields (unknown top-level keys are stripped).

const MAX_ARTIFACT_COUNT = 10
const MAX_ARTIFACT_SIZE_BYTES = 131072 // 128 KiB per artifact on read
const MAX_NOTES_LENGTH = 4096
const MAX_TITLE_LENGTH = 256

const MAX_ID_LENGTH = 128
const MAX_AGENT_LENGTH = 64
const MAX_ARTIFACT_PATH_LENGTH = 512

const VALID_STAGES = ['design']
const VALID_STATUSES = ['approved', 'rejected']
const VALID_CHECKLISTS = ['mtf', null]
const VALID_ARTIFACT_KINDS = ['architecture', 'figma-spec', 'handoff', 'other']

const SCHEMA_VERSION = 1

// ── internal helpers ──────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function requireNonEmptyString(value, field, maxLen) {
  if (typeof value !== 'string') {
    throw new Error(`gate: ${field} must be a string`)
  }
  if (value.length === 0) {
    throw new Error(`gate: ${field} must be non-empty`)
  }
  if (maxLen != null && value.length > maxLen) {
    throw new Error(`gate: ${field} exceeds max length ${maxLen}`)
  }
  return value
}

function requireIso8601(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`gate: ${field} must be an ISO-8601 string`)
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`gate: ${field} is not a valid ISO-8601 date`)
  }
  return value
}

// ── ReviewRequest (agent → app) ───────────────────────────────────────────────

// Validate an untrusted review request. Returns a clean ReviewRequest with only
// known fields. Throws on the first violation.
function validateReviewRequest(obj) {
  if (!isPlainObject(obj)) {
    throw new Error('gate: review request must be an object')
  }

  const id = requireNonEmptyString(obj.id, 'request.id', MAX_ID_LENGTH)

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`gate: request.schemaVersion must be ${SCHEMA_VERSION}`)
  }

  const createdAt = requireIso8601(obj.createdAt, 'request.createdAt')
  const expiresAt = requireIso8601(obj.expiresAt, 'request.expiresAt')

  if (!VALID_STAGES.includes(obj.stage)) {
    throw new Error(`gate: request.stage must be one of ${VALID_STAGES.join(', ')}`)
  }

  const agent = requireNonEmptyString(obj.agent, 'request.agent', MAX_AGENT_LENGTH)

  if (typeof obj.title !== 'string') {
    throw new Error('gate: request.title must be a string')
  }
  if (obj.title.length > MAX_TITLE_LENGTH) {
    throw new Error(`gate: request.title exceeds max length ${MAX_TITLE_LENGTH}`)
  }
  const title = obj.title

  if (!Array.isArray(obj.artifacts)) {
    throw new Error('gate: request.artifacts must be an array')
  }
  if (obj.artifacts.length > MAX_ARTIFACT_COUNT) {
    throw new Error(`gate: request.artifacts exceeds max count ${MAX_ARTIFACT_COUNT}`)
  }
  const artifacts = obj.artifacts.map((a, i) => {
    if (!isPlainObject(a)) {
      throw new Error(`gate: request.artifacts[${i}] must be an object`)
    }
    if (!VALID_ARTIFACT_KINDS.includes(a.kind)) {
      throw new Error(
        `gate: request.artifacts[${i}].kind must be one of ${VALID_ARTIFACT_KINDS.join(', ')}`,
      )
    }
    const aPath = requireNonEmptyString(
      a.path,
      `request.artifacts[${i}].path`,
      MAX_ARTIFACT_PATH_LENGTH,
    )
    return { kind: a.kind, path: aPath }
  })

  // checklist: allow undefined → null; otherwise must be a valid value.
  let checklist = obj.checklist
  if (checklist === undefined) checklist = null
  if (!VALID_CHECKLISTS.includes(checklist)) {
    throw new Error(`gate: request.checklist must be one of 'mtf' or null`)
  }

  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    expiresAt,
    stage: obj.stage,
    agent,
    title,
    artifacts,
    checklist,
  }
}

// ── DecisionInput (renderer → main, gate:decide args) ─────────────────────────

// Validate the renderer-supplied decision input. Returns { id, status, notes }.
// notes is required & non-empty when status === 'rejected'; defaults to '' when
// approved and absent. Throws on violation.
function validateDecisionInput(obj) {
  if (!isPlainObject(obj)) {
    throw new Error('gate: decision input must be an object')
  }

  const id = requireNonEmptyString(obj.id, 'decision.id', MAX_ID_LENGTH)

  if (!VALID_STATUSES.includes(obj.status)) {
    throw new Error(`gate: decision.status must be one of ${VALID_STATUSES.join(', ')}`)
  }
  const status = obj.status

  let notes = obj.notes
  if (notes === undefined || notes === null) {
    notes = ''
  }
  if (typeof notes !== 'string') {
    throw new Error('gate: decision.notes must be a string')
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error(`gate: decision.notes exceeds max length ${MAX_NOTES_LENGTH}`)
  }
  if (status === 'rejected' && notes.trim().length === 0) {
    throw new Error('gate: decision.notes is required when status is rejected')
  }

  return { id, status, notes }
}

// ── ReviewDecision (full decision file, including signature) ───────────────────

// Validate a full decision object (as written to decisions/<id>.json), including
// the `sig` field. Used by the gate tool before trusting a verdict. Throws on
// violation. Signature CORRECTNESS is checked separately by security.verify().
function validateReviewDecision(obj) {
  if (!isPlainObject(obj)) {
    throw new Error('gate: decision must be an object')
  }

  const id = requireNonEmptyString(obj.id, 'decision.id', MAX_ID_LENGTH)

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`gate: decision.schemaVersion must be ${SCHEMA_VERSION}`)
  }

  if (!VALID_STATUSES.includes(obj.status)) {
    throw new Error(`gate: decision.status must be one of ${VALID_STATUSES.join(', ')}`)
  }

  if (typeof obj.notes !== 'string') {
    throw new Error('gate: decision.notes must be a string')
  }
  if (obj.notes.length > MAX_NOTES_LENGTH) {
    throw new Error(`gate: decision.notes exceeds max length ${MAX_NOTES_LENGTH}`)
  }
  if (obj.status === 'rejected' && obj.notes.trim().length === 0) {
    throw new Error('gate: decision.notes is required when status is rejected')
  }

  const decidedAt = requireIso8601(obj.decidedAt, 'decision.decidedAt')
  const sig = requireNonEmptyString(obj.sig, 'decision.sig')

  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    status: obj.status,
    notes: obj.notes,
    decidedAt,
    sig,
  }
}

module.exports = {
  MAX_ARTIFACT_COUNT,
  MAX_ARTIFACT_SIZE_BYTES,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  VALID_STAGES,
  VALID_STATUSES,
  VALID_CHECKLISTS,
  VALID_ARTIFACT_KINDS,
  SCHEMA_VERSION,
  validateReviewRequest,
  validateDecisionInput,
  validateReviewDecision,
}
