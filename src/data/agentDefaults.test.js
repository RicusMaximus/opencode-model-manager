import { describe, it, expect } from 'vitest'
import { applyAgentDefaults, AGENT_CONFIG_DEFAULTS } from './agentDefaults.js'

describe('applyAgentDefaults', () => {
  // ── Filling missing fields ──────────────────────────────────────────────────

  it('fills every manageable field on a bare agent', () => {
    const out = applyAgentDefaults({ id: 'x' })
    expect(out.mode).toBe('subagent')
    expect(out.maxTokens).toBe(AGENT_CONFIG_DEFAULTS.maxTokens)
    expect(out.maxSteps).toBe(AGENT_CONFIG_DEFAULTS.maxSteps)
    expect(out.options.temperature).toBe(0.7)
    expect(out.options.topP).toBe(1)
    expect(out.tools.read).toBe(true)
    expect(out.tools.grep).toBe(true)
    expect(out.permission['*']).toBe('allow')
    expect(out.permission.bash).toBe('ask')
  })

  // ── Non-destructive ─────────────────────────────────────────────────────────

  it('never overrides values the agent already has', () => {
    const out = applyAgentDefaults({
      id: 'x',
      mode: 'primary',
      maxTokens: 32000,
      options: { temperature: 0.1 },
      tools: { read: false },
      permission: { bash: 'allow' },
    })
    expect(out.mode).toBe('primary')
    expect(out.maxTokens).toBe(32000)
    expect(out.options.temperature).toBe(0.1)
    expect(out.tools.read).toBe(false)
    expect(out.permission.bash).toBe('allow')
  })

  it('merges defaults under existing object fields without dropping keys', () => {
    const out = applyAgentDefaults({
      id: 'x',
      permission: { skill: { pipeline_manager: 'allow' } },
      tools: { skill: true },
    })
    // existing complex permission preserved
    expect(out.permission.skill).toEqual({ pipeline_manager: 'allow' })
    // defaults added alongside
    expect(out.permission['*']).toBe('allow')
    expect(out.tools.skill).toBe(true)
    expect(out.tools.read).toBe(true)
  })

  // ── Model-aware reasoning effort ─────────────────────────────────────────────

  it('sets a variant default for an Anthropic model', () => {
    const out = applyAgentDefaults({ id: 'x', model: 'anthropic/claude-sonnet-4-6' })
    expect(out.variant).toBe('medium')
  })

  it('does not set a variant for an Ollama model', () => {
    const out = applyAgentDefaults({ id: 'x', model: 'ollama/llama3.2:1b' })
    expect(out.variant == null).toBe(true)
    expect(out.options.reasoningEffort).toBeUndefined()
  })

  it('sets options.reasoningEffort for an OpenAI o-series model', () => {
    const out = applyAgentDefaults({ id: 'x', model: 'openai/o3' })
    expect(out.options.reasoningEffort).toBe('medium')
    expect(out.variant == null).toBe(true)
  })

  it('leaves a null model untouched (inherits global)', () => {
    const out = applyAgentDefaults({ id: 'x', model: null })
    expect(out.model).toBe(null)
  })

  // ── Purity ──────────────────────────────────────────────────────────────────

  it('does not mutate the input object', () => {
    const input = { id: 'x' }
    applyAgentDefaults(input)
    expect(input.mode).toBeUndefined()
    expect(input.options).toBeUndefined()
  })
})
