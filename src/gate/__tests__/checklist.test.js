// Tests for src/gate/checklist.js
// §9 matrix: Unit — MTF checklist rules MTF-001 through MTF-010

import { describe, it, expect } from 'vitest'
import { runMtfChecklist } from '../checklist.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a string with a given number of lines. */
function makeLines(count, content = 'line content here') {
  return Array.from({ length: count }, (_, i) => `${content} ${i + 1}`).join('\n')
}

/** Run and find a specific rule by id. */
function rule(text, id) {
  const results = runMtfChecklist(text)
  const r = results.find((x) => x.id === id)
  expect(r, `rule ${id} not found in results`).toBeDefined()
  return r
}

// ── runMtfChecklist API ────────────────────────────────────────────────────────

describe('runMtfChecklist', () => {
  it('returns exactly 10 results for any input', () => {
    expect(runMtfChecklist('').length).toBe(10)
    expect(runMtfChecklist('some text').length).toBe(10)
  })

  it('returns an array of objects with id, name, level, detail fields', () => {
    const results = runMtfChecklist('test input')
    for (const r of results) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.name).toBe('string')
      expect(['pass', 'warn', 'fail', 'info']).toContain(r.level)
      expect(typeof r.detail).toBe('string')
      expect(r.detail.length).toBeGreaterThan(0)
    }
  })

  it('handles non-string input gracefully (treats as empty string)', () => {
    expect(() => runMtfChecklist(null)).not.toThrow()
    expect(() => runMtfChecklist(undefined)).not.toThrow()
    expect(() => runMtfChecklist(42)).not.toThrow()
  })

  it('result ids are MTF-001 through MTF-010', () => {
    const results = runMtfChecklist('')
    const ids = results.map((r) => r.id)
    const expected = [
      'MTF-001', 'MTF-002', 'MTF-003', 'MTF-004', 'MTF-005',
      'MTF-006', 'MTF-007', 'MTF-008', 'MTF-009', 'MTF-010',
    ]
    for (const id of expected) {
      expect(ids).toContain(id)
    }
  })
})

// ── MTF-001 — Gate call present ───────────────────────────────────────────────

describe('MTF-001 — Gate call present', () => {
  it('pass: text contains submit_for_review', () => {
    const r = rule('Call submit_for_review to block at the gate.', 'MTF-001')
    expect(r.level).toBe('pass')
    expect(r.detail).toBeTruthy()
  })

  it('warn: text does not contain submit_for_review', () => {
    const r = rule('Design document with no gate reference.', 'MTF-001')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })
})

// ── MTF-002 — Stage responsibilities defined ──────────────────────────────────

describe('MTF-002 — Stage responsibilities defined', () => {
  it('pass: text contains ## Responsibilities heading', () => {
    const r = rule('## Responsibilities\n- Do things', 'MTF-002')
    expect(r.level).toBe('pass')
  })

  it('pass: text contains ## Workflow heading (fallback)', () => {
    const r = rule('## Workflow\n1. Do step one', 'MTF-002')
    expect(r.level).toBe('pass')
  })

  it('warn: no ## Responsibilities or ## Workflow heading', () => {
    const r = rule('Just a plain document without any headings.', 'MTF-002')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })
})

// ── MTF-003 — File-level specificity ─────────────────────────────────────────

describe('MTF-003 — File-level specificity', () => {
  it('pass: at least 3 distinct file references', () => {
    const r = rule('See main.js, README.md, vite.config.js, and schema.json.', 'MTF-003')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('Found')
  })

  it('warn: fewer than 3 distinct file references', () => {
    const r = rule('See main.js for more details.', 'MTF-003')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })

  it('warn: empty document has zero file references', () => {
    const r = rule('', 'MTF-003')
    expect(r.level).toBe('warn')
  })
})

// ── MTF-004 — Atomic write referenced ────────────────────────────────────────

describe('MTF-004 — Atomic write referenced', () => {
  it('pass (not-applicable): no writeFile or write( in text', () => {
    const r = rule('This document mentions reading files but not writing them.', 'MTF-004')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('not applicable')
  })

  it('pass: writeFile is near atomic / rename / temp within 5 lines', () => {
    const text = [
      'Description of the write operation.',
      'atomicWrite helper ensures safety.',
      'fs.writeFile(tmpPath, content)',
      'then rename to final path.',
      'This avoids half-written files.',
    ].join('\n')
    const r = rule(text, 'MTF-004')
    expect(r.level).toBe('pass')
  })

  it('warn: writeFile without nearby atomic/rename/temp', () => {
    // NOTE: none of these lines may contain "atomic", "rename", or "temp"
    // within 5 lines of the writeFile call, or the rule fires as pass instead.
    const text = [
      'Overview of the system.',
      'Data flows through the pipeline.',
      'fs.writeFile(filePath, data)',  // line 3: the write — no safety nearby
      'Results are logged to the console.',
      'Further processing happens downstream.',
      'The module handles encoding.',
      'Validation occurs before submission.',
      'Output is verified by the caller.',
      'Error handling is documented elsewhere.',
      'Summary of the design decisions.',
      'Conclusion goes here.',
    ].join('\n')
    const r = rule(text, 'MTF-004')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })

  it('warn: detail includes the line number of the write', () => {
    const lines = [
      'Line 1',
      'Line 2',
      'Line 3',
      'Line 4',
      'Line 5',
      'Line 6',
      'Line 7',
      'fs.writeFile(path, data)', // line 8
      'Line 9',
      'Line 10',
      'Line 11',
      'Line 12',
      'Line 13',
      'Line 14', // far from any atomic mention
    ]
    const r = rule(lines.join('\n'), 'MTF-004')
    expect(r.level).toBe('warn')
    expect(r.detail).toContain('8')
  })
})

// ── MTF-005 — No unresolved markers ─────────────────────────────────────────

describe('MTF-005 — No unresolved markers', () => {
  it('pass: no TODO/TBD/FIXME/??? in the text', () => {
    const r = rule('Everything is resolved and documented.', 'MTF-005')
    expect(r.level).toBe('pass')
  })

  it('warn: TODO marker is found', () => {
    const r = rule('Line 1\nLine 2\nTODO: add validation\nLine 4', 'MTF-005')
    expect(r.level).toBe('warn')
  })

  it('warn: FIXME marker is found', () => {
    const r = rule('FIXME: this section needs review', 'MTF-005')
    expect(r.level).toBe('warn')
  })

  it('warn: TBD marker is found', () => {
    const r = rule('Approach: TBD', 'MTF-005')
    expect(r.level).toBe('warn')
  })

  it('warn: ??? marker is found', () => {
    const r = rule('Should we use X or Y ???', 'MTF-005')
    expect(r.level).toBe('warn')
  })

  it('warn: detail includes the line number of the marker', () => {
    const text = 'Line 1\nLine 2\nLine 3\nTODO: fix this\nLine 5'
    const r = rule(text, 'MTF-005')
    expect(r.level).toBe('warn')
    expect(r.detail).toContain('4') // line 4
  })
})

// ── MTF-006 — Handoff block present ──────────────────────────────────────────

describe('MTF-006 — Handoff block present', () => {
  it('pass: no ui_generator reference — handoff not required', () => {
    const r = rule('This spec uses the architect agent.', 'MTF-006')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('not required')
  })

  it('fail: ui_generator referenced without a HANDOFF block', () => {
    const r = rule('After ui_generator completes, proceed.', 'MTF-006')
    expect(r.level).toBe('fail')
    expect(r.detail).toBeTruthy()
  })

  it('pass: ui_generator paired with HANDOFF block', () => {
    const r = rule('After ui_generator completes:\n## HANDOFF\nScreen IDs: s1, s2', 'MTF-006')
    expect(r.level).toBe('pass')
  })
})

// ── MTF-007 — Error path addressed ───────────────────────────────────────────

describe('MTF-007 — Error path addressed', () => {
  it('pass: text contains "error"', () => {
    const r = rule('Handle error cases gracefully.', 'MTF-007')
    expect(r.level).toBe('pass')
  })

  it('pass: text contains "fail"', () => {
    const r = rule('On fail, return rejected status.', 'MTF-007')
    expect(r.level).toBe('pass')
  })

  it('pass: text contains "timeout"', () => {
    const r = rule('On timeout, the gate closes.', 'MTF-007')
    expect(r.level).toBe('pass')
  })

  it('warn: no error/fail/reject/timeout language present', () => {
    const r = rule('Everything always succeeds without exception.', 'MTF-007')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })
})

// ── MTF-008 — Build-stage sequencing ─────────────────────────────────────────

describe('MTF-008 — Build-stage sequencing', () => {
  it('pass: no build-stage agents referenced', () => {
    const r = rule('The architect will design the system.', 'MTF-008')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('not applicable')
  })

  it('warn: builder mentioned before any gate/design word (sequencing inversion)', () => {
    // builder appears before "gate" in character position
    const r = rule('builder does the implementation. Then the design gate is passed.', 'MTF-008')
    expect(r.level).toBe('warn')
    expect(r.detail).toBeTruthy()
  })

  it('pass: gate/design precedes builder mention', () => {
    const r = rule('The design gate must be passed before builder runs.', 'MTF-008')
    expect(r.level).toBe('pass')
  })

  it('pass: build agents present but no gate/design anchor (cannot compare)', () => {
    const r = rule('Run builder then validator then scribe.', 'MTF-008')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('no gate/design anchor')
  })
})

// ── MTF-009 — Document length ─────────────────────────────────────────────────

describe('MTF-009 — Document length', () => {
  it('info: document is fewer than 50 lines', () => {
    const r = rule(makeLines(30), 'MTF-009')
    expect(r.level).toBe('info')
    expect(r.detail).toContain('30')
  })

  it('pass: document is exactly 50 lines', () => {
    const r = rule(makeLines(50), 'MTF-009')
    expect(r.level).toBe('pass')
    expect(r.detail).toContain('50')
  })

  it('pass: document is within 50–2000 lines', () => {
    const r = rule(makeLines(200), 'MTF-009')
    expect(r.level).toBe('pass')
  })

  it('info: document exceeds 2000 lines', () => {
    const r = rule(makeLines(2001), 'MTF-009')
    expect(r.level).toBe('info')
    expect(r.detail).toContain('2001')
  })
})

// ── MTF-010 — No inline secrets ──────────────────────────────────────────────

describe('MTF-010 — No inline secrets', () => {
  it('pass: no token-shaped strings with secret labels', () => {
    const r = rule('Here is some regular documentation text.', 'MTF-010')
    expect(r.level).toBe('pass')
  })

  it('fail: password field with a long random-looking value (>=32 chars)', () => {
    // Simulates a leaked credential in the design doc.
    const secret = 'abcdef1234567890abcdef1234567890abcdef12'  // 40 chars
    const r = rule(`password: ${secret}`, 'MTF-010')
    expect(r.level).toBe('fail')
    expect(r.detail).toBeTruthy()
  })

  it('fail: token field with a 32+ character value', () => {
    const token = 'sk_live_' + 'A'.repeat(32)  // 40 chars total
    const r = rule(`token: ${token}`, 'MTF-010')
    expect(r.level).toBe('fail')
    expect(r.detail).toBeTruthy()
  })

  it('fail: detail includes the line number', () => {
    const lines = ['Line 1', 'Line 2', `secret: ${'x'.repeat(35)}`, 'Line 4']
    const r = rule(lines.join('\n'), 'MTF-010')
    expect(r.level).toBe('fail')
    expect(r.detail).toContain('3') // line 3
  })

  it('pass: long string without a secret label (not flagged)', () => {
    // A long hash in a non-labeled context should not trigger the rule.
    const r = rule(`The commit hash is ${'a'.repeat(40)} (see git log).`, 'MTF-010')
    // This might or might not fire depending on the "hash" word — check the rule:
    // labelRe = /key|token|secret|password/i — "hash" is NOT in the label list.
    expect(r.level).toBe('pass')
  })
})
