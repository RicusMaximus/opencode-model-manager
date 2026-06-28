import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequire } from 'module'
import { EventEmitter } from 'events'

const require = createRequire(import.meta.url)
const supervisor = require('../supervisor.js')

// A fake ChildProcess: EventEmitter with stdout/stderr streams + kill().
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}

const immediateSleep = () => Promise.resolve()

beforeEach(() => supervisor._reset())

describe('firstFreePort', () => {
  it('returns the first port the injected probe accepts', async () => {
    const tryListen = (p) => Promise.resolve(p === 8002)
    const port = await supervisor.firstFreePort(8000, 20, { tryListen })
    expect(port).toBe(8002)
  })

  it('throws when no port is free in range', async () => {
    await expect(supervisor.firstFreePort(8000, 3, { tryListen: () => Promise.resolve(false) })).rejects.toThrow()
  })
})

describe('waitForHealth', () => {
  it('resolves true once the probe returns 2xx', async () => {
    let calls = 0
    const httpGet = () => {
      calls += 1
      return Promise.resolve({ status: calls >= 2 ? 200 : 500 })
    }
    const ok = await supervisor.waitForHealth(8000, '/health', 5000, { httpGet, sleep: immediateSleep })
    expect(ok).toBe(true)
  })
})

// A real-shaped httpGet: /health 200, /v1/auth/status nested claude_cli/valid,
// /v1/models with a small data list.
function healthyHttpGet(port, urlPath) {
  if (urlPath === '/health') return Promise.resolve({ status: 200 })
  if (urlPath === '/v1/auth/status') {
    return Promise.resolve({ status: 200, body: { claude_code_auth: { method: 'claude_cli', status: { valid: true } } } })
  }
  if (urlPath === '/v1/models') {
    return Promise.resolve({ status: 200, body: { data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4-6' }] } })
  }
  return Promise.resolve({ status: 404 })
}

// A launch command as main.js would build it (venv python + ${PORT} token).
const RUN_CMD = ['C:/venv/python.exe', '-m', 'uvicorn', 'src.main:app', '--host', '127.0.0.1', '--port', '${PORT}']

function healthyDeps(overrides = {}) {
  return {
    spawn: () => fakeChild(),
    httpGet: healthyHttpGet,
    writeProviderBlock: () => Promise.resolve({}),
    checkClaudeLogin: () => Promise.resolve({ ok: true }),
    tryListen: (p) => Promise.resolve(p === 8000),
    sleep: immediateSleep,
    ...overrides,
  }
}

describe('ensureWrapper', () => {
  it('refuses to spawn under subscription when the Claude CLI is not logged in', async () => {
    const spawn = vi.fn()
    const status = await supervisor.ensureWrapper(
      { profile: 'subscription', configDir: '/cfg', command: RUN_CMD },
      healthyDeps({ spawn, checkClaudeLogin: () => Promise.resolve({ ok: false, reason: 'not logged in' }) }),
    )
    expect(status.state).toBe('auth-needed')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('returns crashed (not-installed) when no launch command is supplied', async () => {
    const spawn = vi.fn()
    const status = await supervisor.ensureWrapper({ profile: 'subscription', configDir: '/cfg' }, healthyDeps({ spawn }))
    expect(status.state).toBe('crashed')
    expect(status.error).toMatch(/not installed/i)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns, resolves ${PORT}, writes the provider block with live models, seeds status', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const writeProviderBlock = vi.fn(() => Promise.resolve({ baseURL: 'http://localhost:8000/v1' }))

    const status = await supervisor.ensureWrapper(
      { profile: 'subscription', configDir: '/cfg', projectDir: '/proj', command: RUN_CMD },
      healthyDeps({ spawn, writeProviderBlock }),
    )

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('running')
    expect(status.port).toBe(8000)
    expect(status.baseURL).toBe('http://localhost:8000/v1')

    // ${PORT} resolved in the spawned args.
    const args = spawn.mock.calls[0][1]
    expect(args).toContain('8000')
    expect(args).not.toContain('${PORT}')

    // Provider block written with the LIVE models from /v1/models.
    expect(writeProviderBlock).toHaveBeenCalledTimes(1)
    const [, writeArgs] = writeProviderBlock.mock.calls[0]
    expect(writeArgs.port).toBe(8000)
    expect(writeArgs.clientGuard).toBe(false)
    expect(writeArgs.models.map((m) => m.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-6'])
    expect(status.models.map((m) => m.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-6'])

    // Subscription env must NOT carry ANTHROPIC_API_KEY; CLAUDE_CWD = project.
    const spawnedEnv = spawn.mock.calls[0][2].env
    expect(spawnedEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(spawnedEnv.PORT).toBe('8000')
    expect(spawnedEnv.CLAUDE_CWD).toBe('/proj')
  })

  it('goes auth-needed when the wrapper is up but /v1/auth/status is not valid', async () => {
    const status = await supervisor.ensureWrapper(
      { profile: 'subscription', configDir: '/cfg', command: RUN_CMD },
      healthyDeps({
        httpGet: (port, urlPath) =>
          urlPath === '/health'
            ? Promise.resolve({ status: 200 })
            : Promise.resolve({ status: 200, body: { claude_code_auth: { method: 'claude_cli', status: { valid: false } } } }),
      }),
    )
    expect(status.state).toBe('auth-needed')
  })

  it('reports crashed when the process never becomes healthy', async () => {
    const status = await supervisor.ensureWrapper(
      { profile: 'subscription', configDir: '/cfg', startupTimeoutMs: 1, command: RUN_CMD },
      healthyDeps({ httpGet: () => Promise.reject(new Error('ECONNREFUSED')) }),
    )
    expect(status.state).toBe('crashed')
  })

  it('is idempotent — a second call while running does not spawn again', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const deps = healthyDeps({ spawn })
    await supervisor.ensureWrapper({ profile: 'subscription', configDir: '/cfg', command: RUN_CMD }, deps)
    await supervisor.ensureWrapper({ profile: 'subscription', configDir: '/cfg', command: RUN_CMD }, deps)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('stopWrapper', () => {
  it('SIGTERMs the running child and clears status', async () => {
    const child = fakeChild()
    await supervisor.ensureWrapper(
      { profile: 'subscription', configDir: '/cfg', command: RUN_CMD },
      healthyDeps({ spawn: () => child }),
    )
    const status = await supervisor.stopWrapper({ sleep: immediateSleep, graceMs: 0 })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(status.state).toBe('stopped')
    expect(status.port).toBeNull()
  })
})
