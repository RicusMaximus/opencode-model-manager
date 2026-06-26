// Tests for electron/gate/schema.js
// §9 matrix: Unit — request/decision validation

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  validateReviewRequest,
  validateDecisionInput,
  validateReviewDecision,
  MAX_ARTIFACT_COUNT,
  MAX_ARTIFACT_SIZE_BYTES,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  VALID_STAGES,
  VALID_STATUSES,
  VALID_CHECKLISTS,
  VALID_ARTIFACT_KINDS,
  SCHEMA_VERSION,
} = require('../schema.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

function validRequest(overrides = {}) {
  return {
    id: 'review-001',
    schemaVersion: 1,
    createdAt: '2026-06-25T10:00:00.000Z',
    expiresAt: '2026-06-26T10:00:00.000Z',
    stage: 'design',
    agent: 'architect',
    title: 'Architecture review',
    artifacts: [{ kind: 'architecture', path: 'docs/arch.md' }],
    checklist: 'mtf',
    ...overrides,
  }
}

function validDecisionInput(overrides = {}) {
  return {
    id: 'review-001',
    status: 'approved',
    notes: '',
    ...overrides,
  }
}

function validDecision(overrides = {}) {
  return {
    id: 'review-001',
    schemaVersion: 1,
    status: 'approved',
    notes: '',
    decidedAt: '2026-06-25T12:00:00.000Z',
    sig: 'abc123def456',
    ...overrides,
  }
}

// ── Exported constants ────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('SCHEMA_VERSION is 1', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('VALID_STAGES contains design', () => {
    expect(VALID_STAGES).toContain('design')
  })

  it('VALID_STATUSES contains approved and rejected', () => {
    expect(VALID_STATUSES).toContain('approved')
    expect(VALID_STATUSES).toContain('rejected')
  })

  it('VALID_ARTIFACT_KINDS includes the four canonical kinds', () => {
    expect(VALID_ARTIFACT_KINDS).toContain('architecture')
    expect(VALID_ARTIFACT_KINDS).toContain('figma-spec')
    expect(VALID_ARTIFACT_KINDS).toContain('handoff')
    expect(VALID_ARTIFACT_KINDS).toContain('other')
  })

  it('VALID_CHECKLISTS includes mtf and null', () => {
    expect(VALID_CHECKLISTS).toContain('mtf')
    expect(VALID_CHECKLISTS).toContain(null)
  })

  it('MAX_ARTIFACT_COUNT is at least 1', () => {
    expect(MAX_ARTIFACT_COUNT).toBeGreaterThanOrEqual(1)
  })
})

// ── validateReviewRequest ─────────────────────────────────────────────────────

describe('validateReviewRequest', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('accepts a fully valid request and returns a clean object', () => {
    const result = validateReviewRequest(validRequest())
    expect(result.id).toBe('review-001')
    expect(result.schemaVersion).toBe(1)
    expect(result.stage).toBe('design')
    expect(result.checklist).toBe('mtf')
    expect(Array.isArray(result.artifacts)).toBe(true)
    expect(result.artifacts[0]).toEqual({ kind: 'architecture', path: 'docs/arch.md' })
  })

  it('strips unknown top-level keys', () => {
    const result = validateReviewRequest(validRequest({ unknownField: 'should-be-stripped' }))
    expect(result).not.toHaveProperty('unknownField')
  })

  it('allows checklist: null', () => {
    const result = validateReviewRequest(validRequest({ checklist: null }))
    expect(result.checklist).toBe(null)
  })

  it('defaults missing checklist to null', () => {
    const r = validRequest()
    delete r.checklist
    const result = validateReviewRequest(r)
    expect(result.checklist).toBe(null)
  })

  it('accepts all four valid artifact kinds', () => {
    const kinds = ['architecture', 'figma-spec', 'handoff', 'other']
    for (const kind of kinds) {
      const result = validateReviewRequest(
        validRequest({ artifacts: [{ kind, path: 'a.md' }] }),
      )
      expect(result.artifacts[0].kind).toBe(kind)
    }
  })

  it('accepts an empty title (title has no min-length constraint)', () => {
    const result = validateReviewRequest(validRequest({ title: '' }))
    expect(result.title).toBe('')
  })

  // ── Failure cases ─────────────────────────────────────────────────────────

  it('throws when passed a non-object', () => {
    expect(() => validateReviewRequest(null)).toThrow()
    expect(() => validateReviewRequest('string')).toThrow()
    expect(() => validateReviewRequest(42)).toThrow()
  })

  it('throws when id is missing', () => {
    const r = validRequest()
    delete r.id
    expect(() => validateReviewRequest(r)).toThrow()
  })

  it('throws when id is empty string', () => {
    expect(() => validateReviewRequest(validRequest({ id: '' }))).toThrow()
  })

  it('throws when id exceeds max length', () => {
    expect(() =>
      validateReviewRequest(validRequest({ id: 'x'.repeat(129) })),
    ).toThrow()
  })

  it('throws when schemaVersion is not 1', () => {
    expect(() => validateReviewRequest(validRequest({ schemaVersion: 2 }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ schemaVersion: '1' }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ schemaVersion: null }))).toThrow()
  })

  it('throws when createdAt is not a valid ISO-8601 date', () => {
    expect(() =>
      validateReviewRequest(validRequest({ createdAt: 'not-a-date' })),
    ).toThrow()
    expect(() => validateReviewRequest(validRequest({ createdAt: '' }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ createdAt: 12345 }))).toThrow()
  })

  it('throws when expiresAt is not a valid ISO-8601 date', () => {
    expect(() =>
      validateReviewRequest(validRequest({ expiresAt: 'never' })),
    ).toThrow()
  })

  it('throws when stage is not in VALID_STAGES', () => {
    expect(() => validateReviewRequest(validRequest({ stage: 'build' }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ stage: '' }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ stage: null }))).toThrow()
  })

  it('throws when agent is empty', () => {
    expect(() => validateReviewRequest(validRequest({ agent: '' }))).toThrow()
  })

  it('throws when title exceeds MAX_TITLE_LENGTH', () => {
    expect(() =>
      validateReviewRequest(validRequest({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })),
    ).toThrow()
  })

  it('throws when artifacts is not an array', () => {
    expect(() => validateReviewRequest(validRequest({ artifacts: null }))).toThrow()
    expect(() => validateReviewRequest(validRequest({ artifacts: {} }))).toThrow()
  })

  it('throws when artifacts exceed MAX_ARTIFACT_COUNT', () => {
    const tooMany = Array.from({ length: MAX_ARTIFACT_COUNT + 1 }, () => ({
      kind: 'other',
      path: 'a.md',
    }))
    expect(() => validateReviewRequest(validRequest({ artifacts: tooMany }))).toThrow()
  })

  it('throws when an artifact has an invalid kind', () => {
    expect(() =>
      validateReviewRequest(validRequest({ artifacts: [{ kind: 'invalid', path: 'a.md' }] })),
    ).toThrow()
  })

  it('throws when an artifact path is empty', () => {
    expect(() =>
      validateReviewRequest(validRequest({ artifacts: [{ kind: 'other', path: '' }] })),
    ).toThrow()
  })

  it('throws when checklist is not mtf or null', () => {
    expect(() =>
      validateReviewRequest(validRequest({ checklist: 'unknown-checklist' })),
    ).toThrow()
    expect(() =>
      validateReviewRequest(validRequest({ checklist: 123 })),
    ).toThrow()
  })
})

// ── validateDecisionInput ─────────────────────────────────────────────────────

describe('validateDecisionInput', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('approved without notes is valid (notes defaults to empty string)', () => {
    const r = validDecisionInput({ status: 'approved', notes: undefined })
    const result = validateDecisionInput(r)
    expect(result.status).toBe('approved')
    expect(result.notes).toBe('')
  })

  it('approved with notes is valid', () => {
    const result = validateDecisionInput(
      validDecisionInput({ status: 'approved', notes: 'LGTM' }),
    )
    expect(result.notes).toBe('LGTM')
  })

  it('rejected with notes is valid', () => {
    const result = validateDecisionInput(
      validDecisionInput({ status: 'rejected', notes: 'Needs rework on section 4' }),
    )
    expect(result.status).toBe('rejected')
    expect(result.notes).toBe('Needs rework on section 4')
  })

  it('null notes is coerced to empty string for approved', () => {
    const result = validateDecisionInput(validDecisionInput({ status: 'approved', notes: null }))
    expect(result.notes).toBe('')
  })

  // ── Failure cases ─────────────────────────────────────────────────────────

  it('throws when rejected without notes', () => {
    expect(() =>
      validateDecisionInput(validDecisionInput({ status: 'rejected', notes: '' })),
    ).toThrow()
  })

  it('throws when rejected with whitespace-only notes', () => {
    expect(() =>
      validateDecisionInput(validDecisionInput({ status: 'rejected', notes: '   ' })),
    ).toThrow()
  })

  it('throws when notes exceed MAX_NOTES_LENGTH', () => {
    expect(() =>
      validateDecisionInput(
        validDecisionInput({ notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }),
      ),
    ).toThrow()
  })

  it('throws when status is not in VALID_STATUSES', () => {
    expect(() =>
      validateDecisionInput(validDecisionInput({ status: 'pending' })),
    ).toThrow()
    expect(() =>
      validateDecisionInput(validDecisionInput({ status: '' })),
    ).toThrow()
    expect(() =>
      validateDecisionInput(validDecisionInput({ status: null })),
    ).toThrow()
  })

  it('throws when id is missing', () => {
    const d = validDecisionInput()
    delete d.id
    expect(() => validateDecisionInput(d)).toThrow()
  })

  it('throws when passed a non-object', () => {
    expect(() => validateDecisionInput(null)).toThrow()
    expect(() => validateDecisionInput('approved')).toThrow()
  })
})

// ── validateReviewDecision ────────────────────────────────────────────────────

describe('validateReviewDecision', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('accepts a valid approved decision with sig', () => {
    const result = validateReviewDecision(validDecision())
    expect(result.id).toBe('review-001')
    expect(result.sig).toBe('abc123def456')
    expect(result.status).toBe('approved')
  })

  it('accepts a valid rejected decision with notes', () => {
    const result = validateReviewDecision(
      validDecision({ status: 'rejected', notes: 'Needs changes' }),
    )
    expect(result.status).toBe('rejected')
  })

  // ── Failure cases ─────────────────────────────────────────────────────────

  it('throws when sig is missing', () => {
    const d = validDecision()
    delete d.sig
    expect(() => validateReviewDecision(d)).toThrow()
  })

  it('throws when sig is an empty string', () => {
    expect(() => validateReviewDecision(validDecision({ sig: '' }))).toThrow()
  })

  it('throws when rejected decision has no notes', () => {
    expect(() =>
      validateReviewDecision(validDecision({ status: 'rejected', notes: '' })),
    ).toThrow()
  })

  it('throws when schemaVersion is not 1', () => {
    expect(() => validateReviewDecision(validDecision({ schemaVersion: 2 }))).toThrow()
  })

  it('throws when decidedAt is not a valid ISO-8601 date', () => {
    expect(() => validateReviewDecision(validDecision({ decidedAt: 'not-a-date' }))).toThrow()
  })

  it('throws when status is invalid', () => {
    expect(() => validateReviewDecision(validDecision({ status: 'maybe' }))).toThrow()
  })

  it('throws when notes exceed MAX_NOTES_LENGTH', () => {
    expect(() =>
      validateReviewDecision(validDecision({ notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) })),
    ).toThrow()
  })

  it('throws when passed a non-object', () => {
    expect(() => validateReviewDecision(null)).toThrow()
    expect(() => validateReviewDecision('approved')).toThrow()
  })
})
