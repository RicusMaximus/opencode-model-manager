// Tests for electron/gate/security.js
// §9 matrix: Unit — signing, confinePath (adversarial table), loadOrCreateSecret

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const require = createRequire(import.meta.url)
const { generateSecret, loadOrCreateSecret, canonical, sign, verify, confinePath, SECRET_FILE_NAME } =
  require('../security.js')

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDecision(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'review-abc123',
    status: 'approved',
    notes: '',
    decidedAt: '2026-06-25T10:00:00.000Z',
    sig: '', // filled after signing in tests
    ...overrides,
  }
}

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gate-sec-test-'))
}

// ── generateSecret ────────────────────────────────────────────────────────────

describe('generateSecret', () => {
  it('returns a 64-character lowercase hex string', () => {
    const s = generateSecret()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a different value on each call (random)', () => {
    expect(generateSecret()).not.toBe(generateSecret())
  })
})

// ── loadOrCreateSecret ────────────────────────────────────────────────────────

describe('loadOrCreateSecret', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await makeTempDir()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a 64-hex key on first call (file must not exist)', async () => {
    const secret = await loadOrCreateSecret(tmpDir)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)

    // The file should now exist
    const content = await fs.readFile(path.join(tmpDir, SECRET_FILE_NAME), 'utf8')
    expect(content.trim()).toBe(secret)
  })

  it('returns the SAME secret on a second call (idempotent)', async () => {
    const first = await loadOrCreateSecret(tmpDir)
    const second = await loadOrCreateSecret(tmpDir)
    expect(second).toBe(first)
  })

  it('loads a pre-existing secret without overwriting it', async () => {
    const preset = generateSecret()
    await fs.writeFile(path.join(tmpDir, SECRET_FILE_NAME), preset + '\n', 'utf8')
    const loaded = await loadOrCreateSecret(tmpDir)
    expect(loaded).toBe(preset)
  })

  it('regenerates when the file is empty', async () => {
    await fs.writeFile(path.join(tmpDir, SECRET_FILE_NAME), '', 'utf8')
    const secret = await loadOrCreateSecret(tmpDir)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── canonical ─────────────────────────────────────────────────────────────────

describe('canonical', () => {
  it('serializes the five fields in fixed positional order', () => {
    const d = makeDecision()
    const result = canonical(d)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual([d.schemaVersion, d.id, d.status, d.notes, d.decidedAt])
  })

  it('is deterministic — same input produces same output every time', () => {
    const d = makeDecision()
    expect(canonical(d)).toBe(canonical(d))
  })

  it('excludes the sig field', () => {
    const d = makeDecision({ sig: 'should-not-appear' })
    expect(canonical(d)).not.toContain('should-not-appear')
    expect(canonical(d)).not.toContain('sig')
  })

  it('is order-stable regardless of object key insertion order', () => {
    const a = { id: 'x', schemaVersion: 1, status: 'approved', notes: '', decidedAt: 'T' }
    const b = { decidedAt: 'T', notes: '', status: 'approved', schemaVersion: 1, id: 'x' }
    expect(canonical(a)).toBe(canonical(b))
  })
})

// ── sign → verify round-trip ──────────────────────────────────────────────────

describe('sign / verify', () => {
  let secret

  beforeEach(() => {
    secret = generateSecret()
  })

  it('round-trips: sign then verify returns true', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    expect(verify(d, secret)).toBe(true)
  })

  it('verify returns false when id is tampered', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const tampered = { ...d, id: 'tampered-id' }
    expect(verify(tampered, secret)).toBe(false)
  })

  it('verify returns false when status is tampered', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const tampered = { ...d, status: 'rejected' }
    expect(verify(tampered, secret)).toBe(false)
  })

  it('verify returns false when notes is tampered', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const tampered = { ...d, notes: 'injected notes' }
    expect(verify(tampered, secret)).toBe(false)
  })

  it('verify returns false when decidedAt is tampered', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const tampered = { ...d, decidedAt: '2099-01-01T00:00:00.000Z' }
    expect(verify(tampered, secret)).toBe(false)
  })

  it('verify returns false when schemaVersion is tampered', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const tampered = { ...d, schemaVersion: 2 }
    expect(verify(tampered, secret)).toBe(false)
  })

  it('verify returns false on a wrong secret (forged decision)', () => {
    const d = makeDecision()
    d.sig = sign(d, secret)
    const wrongSecret = generateSecret()
    expect(verify(d, wrongSecret)).toBe(false)
  })

  it('verify returns false on missing sig field (unsigned decision)', () => {
    const d = makeDecision()
    // no sig set
    expect(verify(d, secret)).toBe(false)
  })

  it('verify returns false on empty string sig', () => {
    const d = makeDecision({ sig: '' })
    expect(verify(d, secret)).toBe(false)
  })

  it('verify returns false on sig that is correct length but wrong bytes', () => {
    const d = makeDecision()
    // A 64-char hex string (correct length for SHA-256 hex) but all zeroes
    d.sig = '0'.repeat(64)
    expect(verify(d, secret)).toBe(false)
  })

  it('verify returns false (never throws) on a sig with odd length (not valid hex)', () => {
    const d = makeDecision()
    d.sig = 'abc'  // odd length hex → Buffer.from will produce 1 byte, different from 32
    expect(() => verify(d, secret)).not.toThrow()
    // May return false because lengths differ
    expect(verify(d, secret)).toBe(false)
  })

  it('verify does not throw when given a valid decision shape with wrong sig', () => {
    const d = makeDecision({ sig: 'deadbeef'.repeat(8) })  // 64 chars
    expect(() => verify(d, secret)).not.toThrow()
    expect(verify(d, secret)).toBe(false)
  })
})

// ── confinePath adversarial table ─────────────────────────────────────────────

describe('confinePath', () => {
  let base

  beforeEach(async () => {
    base = await makeTempDir()
  })

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  // ── REJECT cases ────────────────────────────────────────────────────────────

  it('rejects ../../../etc/passwd style traversal', async () => {
    await expect(confinePath(base, '../../../etc/passwd')).rejects.toThrow('path-escape')
  })

  it('rejects absolute path outside the base', async () => {
    const outside = os.tmpdir()
    await expect(confinePath(base, outside)).rejects.toThrow('path-escape')
  })

  it('rejects configDir/../sibling style traversal', async () => {
    // candidate tries to go up one level from base and into a sibling dir
    const candidate = path.join('..', path.basename(os.tmpdir()), 'x')
    await expect(confinePath(base, candidate)).rejects.toThrow('path-escape')
  })

  it('rejects UNC paths (\\\\server\\share\\file)', async () => {
    // On Windows these resolve to UNC paths outside any local base.
    // On POSIX, \\server is treated as a relative segment but resolves within base.
    // The check only applies when it would escape base.
    const uncCandidate = '\\\\server\\share\\file'
    if (process.platform === 'win32') {
      await expect(confinePath(base, uncCandidate)).rejects.toThrow('path-escape')
    } else {
      // On POSIX, double-backslash is treated as a literal directory name
      // and resolves inside base, so it must NOT throw path-escape.
      await expect(confinePath(base, uncCandidate)).resolves.toBeDefined()
    }
  })

  it('rejects a path that resolves exactly to base root via ..', async () => {
    // base + 'sub/../..' escapes above base
    await expect(confinePath(base, path.join('sub', '..', '..'))).rejects.toThrow('path-escape')
  })

  it('rejects out-of-base symlink (symlink inside base → target outside base)', async () => {
    // Create a real directory OUTSIDE the base.
    const outside = await makeTempDir()
    const linkName = path.join(base, 'escape-link')

    let symlinkCreated = false
    try {
      await fs.symlink(outside, linkName)
      symlinkCreated = true
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EPROTO') {
        // Windows without Developer Mode / elevated privileges cannot create symlinks.
        // Skip this specific assertion; the rest of the suite is unaffected.
        console.warn(
          `[security.test] Skipping out-of-base symlink test: symlink creation requires ` +
          `elevated privileges on this platform (${err.code}). ` +
          `Run in Developer Mode or as Administrator to enable this case.`
        )
        await fs.rm(outside, { recursive: true, force: true })
        return
      }
      throw err
    }

    try {
      await expect(confinePath(base, 'escape-link')).rejects.toThrow('path-escape')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  // ── ACCEPT cases ────────────────────────────────────────────────────────────

  it('accepts a simple relative path inside base (design/a.md)', async () => {
    const result = await confinePath(base, 'design/a.md')
    // Path doesn't exist yet — should return the normalized absolute path within base.
    expect(result.startsWith(base)).toBe(true)
    expect(result).toContain('a.md')
  })

  it('accepts a mixed-separator in-base path', async () => {
    // Forward slashes on Windows are normalized by path.resolve.
    const result = await confinePath(base, 'sub/dir/file.md')
    expect(result.startsWith(base)).toBe(true)
  })

  it('accepts in-base nested sub/../allowed.txt (net stays within base)', async () => {
    const result = await confinePath(base, path.join('sub', '..', 'allowed.txt'))
    expect(result.startsWith(base)).toBe(true)
    expect(result).toContain('allowed.txt')
  })

  it('returns the realpath for an existing in-base file', async () => {
    const filePath = path.join(base, 'real-file.txt')
    await fs.writeFile(filePath, 'hello')
    const result = await confinePath(base, 'real-file.txt')
    // On Windows, os.tmpdir() may return an 8.3 short path (e.g. RROBIN~1)
    // while fs.realpath expands it to the full long name. Compare via realpath.
    const canonical = await fs.realpath(filePath)
    expect(result.toLowerCase()).toBe(canonical.toLowerCase())
  })

  it('accepts a deeply nested in-base path', async () => {
    const result = await confinePath(base, path.join('a', 'b', 'c', 'deep.md'))
    expect(result.startsWith(base)).toBe(true)
  })
})
