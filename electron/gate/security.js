// Gate security core — HMAC signing/verification, secret provisioning, and
// path confinement for untrusted artifact paths.
//
// Uses only the Node built-in `crypto` module (no external deps). CommonJS.

const crypto = require('crypto')
const path = require('path')
const fs = require('fs/promises')

const { atomicWrite } = require('./utils')

const SECRET_FILE_NAME = 'gate-secret.key'
const SECRET_BYTES = 32 // 256-bit key → 64 hex chars

// Generate a fresh HMAC secret as a hex string (32 random bytes / 64 hex chars).
function generateSecret() {
  return crypto.randomBytes(SECRET_BYTES).toString('hex')
}

// Load the HMAC secret from `<userDataDir>/gate-secret.key`, creating it on
// first run. The secret lives in Electron's userData dir — deliberately OUTSIDE
// configDir — so the agent (which only knows how to read the config tree) can
// never reach it. The file holds a trimmed hex string.
async function loadOrCreateSecret(userDataDir) {
  const secretPath = path.join(userDataDir, SECRET_FILE_NAME)
  try {
    const raw = await fs.readFile(secretPath, 'utf8')
    const secret = raw.trim()
    if (secret) return secret
    // Empty/corrupt file → regenerate below.
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`gate: failed to read secret at ${secretPath}: ${err.message}`)
    }
  }
  const secret = generateSecret()
  await atomicWrite(secretPath, secret)
  return secret
}

// Canonical serialization of a decision for signing.
//
// The signed payload is a JSON array with a FIXED field ordering:
//   [ schemaVersion, id, status, notes, decidedAt ]
// Using a positional array (not an object) removes all key-ordering ambiguity,
// so signer and verifier agree byte-for-byte across platforms/JSON engines.
// The `sig` field is deliberately EXCLUDED (it is the output, not an input).
function canonical(decision) {
  return JSON.stringify([
    decision.schemaVersion,
    decision.id,
    decision.status,
    decision.notes,
    decision.decidedAt,
  ])
}

// Compute the HMAC-SHA256 signature (hex) of a decision using the shared
// secret. The secret is a hex string and is interpreted as raw key bytes.
function sign(decision, secret) {
  return crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(canonical(decision))
    .digest('hex')
}

// Verify a decision's signature in constant time. Returns false (never throws)
// on any anomaly: missing/empty sig, length mismatch, or signature mismatch.
function verify(decision, secret) {
  if (!decision || typeof decision.sig !== 'string' || decision.sig.length === 0) {
    return false
  }
  // A missing/non-string secret (e.g. secret file absent) must yield false, not
  // a TypeError from Buffer.from(null, 'hex') / the HMAC call.
  // Returning false here = fail-closed: no secret means no decision can be trusted.
  if (!secret || typeof secret !== 'string') {
    return false
  }
  const expected = sign(decision, secret)
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(decision.sig, 'hex')
  // timingSafeEqual throws on length mismatch — guard explicitly.
  if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) {
    return false
  }
  try {
    return crypto.timingSafeEqual(expectedBuf, actualBuf)
  } catch {
    return false
  }
}

// Confine an untrusted candidate path to an allowlisted base directory.
//
// Two-stage check:
//   1. path.resolve(base, candidate) and verify it sits under `base + sep`.
//      path.resolve normalizes mixed separators and collapses `..` segments.
//   2. fs.realpath the resolved path and re-check containment, so a symlink
//      whose target escapes `base` is rejected. If the path does not exist yet
//      (realpath ENOENT), fall back to the stage-1 resolved result, which is
//      already confined.
//
// Returns a safe absolute path (the realpath when it exists, else the resolved
// path). Throws Error('path-escape') on any escape, including UNC paths. Does
// NOT read the candidate file.
async function confinePath(base, candidate) {
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error('path-escape')
  }
  if (typeof candidate !== 'string') {
    throw new Error('path-escape')
  }

  const resolvedBase = path.resolve(base)
  const resolved = path.resolve(resolvedBase, candidate)

  // Reject UNC paths (\\server\share) — they point outside any local base.
  if (isUncPath(resolved) && !isUncPath(resolvedBase)) {
    throw new Error('path-escape')
  }

  if (!isWithin(resolvedBase, resolved)) {
    throw new Error('path-escape')
  }

  // Stage 2: resolve symlinks and re-check containment.
  try {
    const realResolved = await fs.realpath(resolved)
    // The base itself may be a symlink; resolve it too for a fair comparison.
    let realBase = resolvedBase
    try {
      realBase = await fs.realpath(resolvedBase)
    } catch {
      // Base not realpath-able (shouldn't happen) — fall back to resolvedBase.
    }
    if (!isWithin(realBase, realResolved)) {
      throw new Error('path-escape')
    }
    return realResolved
  } catch (err) {
    if (err && err.message === 'path-escape') throw err
    if (err && err.code === 'ENOENT') {
      // Path doesn't exist yet — stage-1 containment already holds.
      return resolved
    }
    throw new Error('path-escape')
  }
}

// True when `child` is `parent` itself or lives under `parent + sep`.
function isWithin(parent, child) {
  if (child === parent) return true
  return child.startsWith(parent + path.sep)
}

// Detect UNC paths on both POSIX (\\server\share) and the parsed Windows form.
function isUncPath(p) {
  return p.startsWith('\\\\') || p.startsWith('//')
}

module.exports = {
  SECRET_FILE_NAME,
  generateSecret,
  loadOrCreateSecret,
  canonical,
  sign,
  verify,
  confinePath,
}
