import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const {
  buildProviderBlock,
  mergeProviderBlock,
  writeProviderBlock,
  readPersistedBaseURL,
} = require('../provider.js')

describe('wrapper provider block', () => {
  it('builds a provider block without apiKey by default', () => {
    const block = buildProviderBlock({ baseURL: 'http://localhost:8000/v1' })
    expect(block.npm).toBe('@ai-sdk/openai-compatible')
    expect(block.options.baseURL).toBe('http://localhost:8000/v1')
    expect(block.options.apiKey).toBeUndefined()
    expect(Object.keys(block.models)).toContain('claude-opus-4-8')
  })

  it('emits an apiKey {file:} ref only under client-guard', () => {
    const block = buildProviderBlock({ baseURL: 'http://localhost:8000/v1', clientGuard: true })
    expect(block.options.apiKey).toBe('{file:./.opencode-secrets/wrapper-client-key}')
  })

  it('merge preserves $schema, sibling providers, and unknown top-level fields', () => {
    const existing = {
      $schema: 'https://opencode.ai/config.json',
      mcp: { gate: { type: 'local' } },
      provider: { ollama: { npm: 'x', options: { baseURL: 'http://localhost:11434/v1' } } },
      model: 'anthropic/claude-sonnet-4-6',
    }
    const merged = mergeProviderBlock(existing, buildProviderBlock({ baseURL: 'http://localhost:8123/v1' }))
    expect(merged.mcp.gate.type).toBe('local')
    expect(merged.provider.ollama.npm).toBe('x') // sibling untouched
    expect(merged.provider['claude-sub'].options.baseURL).toBe('http://localhost:8123/v1')
    expect(merged.model).toBe('anthropic/claude-sonnet-4-6')
  })
})

describe('writeProviderBlock (temp dir)', () => {
  let dir
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrapper-prov-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes the provider block atomically and round-trips, rewriting baseURL on port change', async () => {
    await writeProviderBlock(dir, { port: 8000 })
    let drift = await readPersistedBaseURL(dir, 8000)
    expect(drift.present).toBe(true)
    expect(drift.matches).toBe(true)

    // Simulate an auto-bump: rewrite with a new port; baseURL must follow.
    await writeProviderBlock(dir, { port: 8123 })
    drift = await readPersistedBaseURL(dir, 8123)
    expect(drift.baseURL).toBe('http://localhost:8123/v1')
    expect(drift.matches).toBe(true)

    // Old port now reads as drift.
    const stale = await readPersistedBaseURL(dir, 8000)
    expect(stale.matches).toBe(false)
  })

  it('preserves a pre-existing config when writing the provider block', async () => {
    const configPath = path.join(dir, 'opencode.jsonc')
    await fs.writeFile(
      configPath,
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { figma: { type: 'local' } } }, null, 2),
      'utf8',
    )
    await writeProviderBlock(dir, { port: 8000 })
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.mcp.figma.type).toBe('local')
    expect(parsed.provider['claude-sub']).toBeTruthy()
  })

  it('writes into an existing opencode.json (not a stray .jsonc) when that is the global form', async () => {
    const jsonPath = path.join(dir, 'opencode.json')
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'anthropic/claude-sonnet-4-6' }, null, 2),
      'utf8',
    )
    await writeProviderBlock(dir, { port: 8000 })

    // The provider must land in the existing .json, and NO .jsonc should appear.
    const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
    expect(parsed.provider['claude-sub']).toBeTruthy()
    expect(parsed.model).toBe('anthropic/claude-sonnet-4-6')
    await expect(fs.access(path.join(dir, 'opencode.jsonc'))).rejects.toThrow()
  })
})
