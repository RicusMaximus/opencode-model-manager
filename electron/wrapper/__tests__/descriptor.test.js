import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  WRAPPER_MODELS,
  buildSpawnEnv,
  buildRunCommand,
  resolveCommand,
  parseAuthStatus,
  modelsFromList,
  baseURLForPort,
  normalizeProfiles,
  isApiKeyProfile,
} = require('../descriptor.js')

describe('wrapper descriptor', () => {
  it('exposes the static subscription model list with prefix-free ids', () => {
    expect(WRAPPER_MODELS.map((m) => m.id)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ])
  })

  it('normalizes profiles to an array, defaulting to subscription', () => {
    expect(normalizeProfiles()).toEqual(['subscription'])
    expect(normalizeProfiles('api-key')).toEqual(['api-key'])
    expect(normalizeProfiles(['subscription', 'client-guard'])).toEqual(['subscription', 'client-guard'])
    expect(isApiKeyProfile(['subscription', 'api-key'])).toBe(true)
  })

  it('resolves ${PORT} in the runner command', () => {
    const cmd = resolveCommand(['poetry', 'run', 'uvicorn', 'main:app', '--port', '${PORT}'], { port: 8123 })
    expect(cmd).toEqual(['poetry', 'run', 'uvicorn', 'main:app', '--port', '8123'])
  })

  it('builds the launch command from a venv python (src.main:app, loopback, ${PORT} token)', () => {
    const cmd = buildRunCommand('C:/venv/python.exe')
    expect(cmd).toEqual(['C:/venv/python.exe', '-m', 'uvicorn', 'src.main:app', '--host', '127.0.0.1', '--port', '${PORT}'])
  })

  it('parses the nested /v1/auth/status shape', () => {
    expect(parseAuthStatus({ claude_code_auth: { method: 'claude_cli', status: { valid: true } } })).toEqual({
      authenticated: true,
      method: 'claude_cli',
      subscription: true,
    })
    expect(parseAuthStatus({ claude_code_auth: { method: 'api_key', status: { valid: false } } }).authenticated).toBe(false)
    expect(parseAuthStatus(null).authenticated).toBe(false)
  })

  it('maps /v1/models to {id,name}, falling back to static on empty', () => {
    const live = modelsFromList({ data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4-6' }] })
    expect(live).toEqual([
      { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
      { id: 'claude-opus-4-6', name: 'claude-opus-4-6' },
    ])
    expect(modelsFromList({ data: [] })).toBe(WRAPPER_MODELS)
    expect(modelsFromList(null)).toBe(WRAPPER_MODELS)
  })

  it('builds a loopback baseURL for a port', () => {
    expect(baseURLForPort(8123)).toBe('http://localhost:8123/v1')
  })

  describe('buildSpawnEnv', () => {
    it('SCRUBS ANTHROPIC_API_KEY under subscription (hard rule §5)', () => {
      const env = buildSpawnEnv(
        { ANTHROPIC_API_KEY: 'sk-ant-leaked', PATH: '/bin' },
        { profile: 'subscription', port: 8000, projectDir: '/proj' },
      )
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.PORT).toBe('8000')
      expect(env.CLAUDE_CWD).toBe('/proj')
      expect(env.FAST_MODEL).toBe('claude-haiku-4-5-20251001')
      expect(env.PATH).toBe('/bin')
    })

    it('keeps ANTHROPIC_API_KEY under the api-key profile from the resolved secret', () => {
      const env = buildSpawnEnv(
        { PATH: '/bin' },
        { profile: 'api-key', port: 8000, secrets: { anthropicApiKey: 'sk-ant-real' } },
      )
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-real')
    })

    it('removes a stale inherited CLAUDE_CWD when no project dir is given', () => {
      const env = buildSpawnEnv(
        { CLAUDE_CWD: 'C:/old/gone', PATH: '/bin' },
        { profile: 'subscription', port: 8000 },
      )
      expect('CLAUDE_CWD' in env).toBe(false)
    })

    it('sets API_KEY only when client-guard is active', () => {
      const guarded = buildSpawnEnv({}, { profile: ['subscription', 'client-guard'], port: 8000, secrets: { clientGuardKey: 'local-guard' } })
      expect(guarded.API_KEY).toBe('local-guard')
      const plain = buildSpawnEnv({ API_KEY: 'stale' }, { profile: 'subscription', port: 8000 })
      expect(plain.API_KEY).toBeUndefined()
    })
  })
})
