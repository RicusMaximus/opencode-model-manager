// Shared low-level filesystem utilities for the gate bus.
//
// CommonJS — these modules are loaded by the Electron main process and by the
// standalone gate tool, neither of which run through Vite/ESM.

const fs = require('fs/promises')

// Atomic write: temp file → rename, so a crash never leaves a half-written file.
// Extracted verbatim from electron/main.js so the gate modules and the main
// process share a single implementation.
async function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp'
  await fs.writeFile(tmpPath, content, 'utf8')
  await fs.rename(tmpPath, filePath)
}

module.exports = { atomicWrite }
