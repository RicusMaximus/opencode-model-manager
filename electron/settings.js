// App-level settings for the OpenCode Agent Manager — stored SEPARATELY from any
// OpenCode config, in the app's own userData dir. CommonJS + injectable dir so
// it's unit-testable. Atomic write; tolerant read with defaults.

const path = require('path')
const fs = require('fs/promises')

const FILE_NAME = 'agent-manager-settings.json'

const DEFAULTS = {
  // Auto-start the managed Claude (subscription) wrapper when the app launches.
  runClaudeSubOnStartup: false,
}

function settingsPath(userDataDir) {
  return path.join(userDataDir, FILE_NAME)
}

async function readSettings(userDataDir) {
  try {
    const raw = await fs.readFile(settingsPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...DEFAULTS, ...parsed }
    }
  } catch {
    /* missing or unreadable — fall back to defaults */
  }
  return { ...DEFAULTS }
}

// Merge a partial update over current settings and persist atomically.
async function writeSettings(userDataDir, partial) {
  const current = await readSettings(userDataDir)
  const next = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) }
  const p = settingsPath(userDataDir)
  const tmp = p + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tmp, p)
  return next
}

module.exports = { FILE_NAME, DEFAULTS, settingsPath, readSettings, writeSettings }
