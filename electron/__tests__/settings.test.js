import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const settings = require('../settings.js')

let dir
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-settings-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('app settings store', () => {
  it('returns defaults when the file is missing', async () => {
    const s = await settings.readSettings(dir)
    expect(s).toEqual({ runClaudeSubOnStartup: false })
  })

  it('persists a partial update merged over defaults', async () => {
    const next = await settings.writeSettings(dir, { runClaudeSubOnStartup: true })
    expect(next.runClaudeSubOnStartup).toBe(true)
    // round-trips from disk
    expect(await settings.readSettings(dir)).toEqual({ runClaudeSubOnStartup: true })
  })

  it('preserves unknown keys and fills missing defaults on read', async () => {
    await fs.writeFile(path.join(dir, settings.FILE_NAME), JSON.stringify({ someOther: 1 }), 'utf8')
    const s = await settings.readSettings(dir)
    expect(s.runClaudeSubOnStartup).toBe(false) // default filled in
    expect(s.someOther).toBe(1) // unknown key preserved
  })

  it('tolerates a corrupt file by falling back to defaults', async () => {
    await fs.writeFile(path.join(dir, settings.FILE_NAME), 'not json', 'utf8')
    expect(await settings.readSettings(dir)).toEqual({ runClaudeSubOnStartup: false })
  })
})
