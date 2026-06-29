import { describe, it, expect } from 'vitest'
import { resolveReasoningCapability } from './reasoningCapabilities.js'

describe('resolveReasoningCapability', () => {
  // ── Anthropic models ──────────────────────────────────────────────────────

  it('Opus 4.8: variant mechanism with xhigh and max', () => {
    const cap = resolveReasoningCapability('anthropic/claude-opus-4-8')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('xhigh')
    expect(cap.levels).toContain('max')
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-id')
  })

  it('Opus 4.7: variant mechanism with xhigh and max', () => {
    const cap = resolveReasoningCapability('anthropic/claude-opus-4-7')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('xhigh')
    expect(cap.levels).toContain('max')
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-id')
  })

  it('Sonnet 4.6: variant mechanism with max but NOT xhigh', () => {
    const cap = resolveReasoningCapability('anthropic/claude-sonnet-4-6')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('max')
    expect(cap.levels).not.toContain('xhigh')
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-id')
  })

  it('Haiku 4.5: variant mechanism with only high and max', () => {
    const cap = resolveReasoningCapability('anthropic/claude-haiku-4-5')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toEqual(['high', 'max'])
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-id')
  })

  it('Non-reasoning Anthropic model (claude-3-5-sonnet): returns none', () => {
    const cap = resolveReasoningCapability('anthropic/claude-3-5-sonnet-20241022')
    expect(cap.mechanism).toBe('none')
    expect(cap.supported).toBe(false)
    expect(cap.levels).toEqual([])
  })

  // ── OpenAI models ─────────────────────────────────────────────────────────

  it('OpenAI o3: reasoningEffort mechanism with low/medium/high', () => {
    const cap = resolveReasoningCapability('openai/o3')
    expect(cap.mechanism).toBe('reasoningEffort')
    expect(cap.levels).toEqual(expect.arrayContaining(['low', 'medium', 'high']))
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-id')
  })

  it('OpenAI o3-mini: reasoningEffort mechanism', () => {
    const cap = resolveReasoningCapability('openai/o3-mini')
    expect(cap.mechanism).toBe('reasoningEffort')
    expect(cap.supported).toBe(true)
  })

  it('OpenAI GPT-4o: non-reasoning, returns none', () => {
    const cap = resolveReasoningCapability('openai/gpt-4o')
    expect(cap.mechanism).toBe('none')
    expect(cap.supported).toBe(false)
  })

  // ── Ollama models ─────────────────────────────────────────────────────────

  it('Ollama with thinking capability: returns thinking mechanism', () => {
    const cap = resolveReasoningCapability('ollama/some-model', ['thinking', 'completion'])
    expect(cap.mechanism).toBe('thinking')
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('ollama-capabilities')
  })

  it('Ollama without thinking capability: returns none', () => {
    const cap = resolveReasoningCapability('ollama/some-model', ['completion'])
    expect(cap.mechanism).toBe('none')
    expect(cap.supported).toBe(false)
    expect(cap.source).toBe('ollama-capabilities')
  })

  it('Ollama with null capabilities (not yet fetched): returns provider default', () => {
    const cap = resolveReasoningCapability('ollama/some-model', null)
    expect(cap.source).toBe('ollama-capabilities')
    expect(cap.supported).toBe(false)
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('Unknown custom model: returns fallback with none', () => {
    const cap = resolveReasoningCapability('somecompany/some-custom-model')
    expect(cap.mechanism).toBe('none')
    expect(cap.source).toBe('fallback')
    expect(cap.supported).toBe(false)
  })

  it('null model id: returns fallback', () => {
    const cap = resolveReasoningCapability(null)
    expect(cap.mechanism).toBe('none')
    expect(cap.source).toBe('fallback')
    expect(cap.supported).toBe(false)
  })

  it('empty string model id: returns fallback', () => {
    const cap = resolveReasoningCapability('')
    expect(cap.mechanism).toBe('none')
    expect(cap.source).toBe('fallback')
  })

  // ── Family prefix fallbacks (future models) ───────────────────────────────

  it('Future Opus 4.9 (not in registry): resolved via opus-4 family prefix', () => {
    const cap = resolveReasoningCapability('anthropic/claude-opus-4-9')
    expect(cap.mechanism).toBe('variant')
    // Falls to the claude-opus-4 family (xhigh not in that tier — only in 4-7/4-8)
    expect(cap.levels).toContain('max')
    expect(cap.source).toBe('registry-family')
  })

  it('Future Sonnet 4.7 (not in registry): resolved via family prefix with max', () => {
    const cap = resolveReasoningCapability('anthropic/claude-sonnet-4-7')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('max')
    expect(cap.levels).not.toContain('xhigh')
    expect(cap.source).toBe('registry-family')
  })

  it('Future OpenAI o5-mini (not in registry): falls to provider default (none)', () => {
    // openai/o5 is not in the byFamily registry (only o1/o3/o4 are)
    // Falls through to byProvider.openai which defaults to none
    const cap = resolveReasoningCapability('openai/o5-mini')
    expect(cap.source).not.toBe('registry-id') // confirmed not exact match
    expect(cap.mechanism).toBe('none') // safe fallback
  })

  // ── Semantic correctness checks ───────────────────────────────────────────

  it('Opus 4.8 has more levels than Sonnet 4.6 (xhigh is Opus-only)', () => {
    const opus = resolveReasoningCapability('anthropic/claude-opus-4-8')
    const sonnet = resolveReasoningCapability('anthropic/claude-sonnet-4-6')
    expect(opus.levels.length).toBeGreaterThan(sonnet.levels.length)
    expect(opus.levels).toContain('xhigh')
    expect(sonnet.levels).not.toContain('xhigh')
  })

  it('Anthropic models always use variant mechanism, never reasoningEffort', () => {
    for (const modelId of ['anthropic/claude-opus-4-8', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-haiku-4-5']) {
      const cap = resolveReasoningCapability(modelId)
      expect(cap.mechanism).not.toBe('reasoningEffort')
    }
  })

  it('OpenAI o-series models always use reasoningEffort, never variant', () => {
    for (const modelId of ['openai/o1', 'openai/o3', 'openai/o3-mini', 'openai/o4-mini']) {
      const cap = resolveReasoningCapability(modelId)
      expect(cap.mechanism).toBe('reasoningEffort')
      expect(cap.mechanism).not.toBe('variant')
    }
  })

  // ── Claude (subscription) wrapper provider ─────────────────────────────────
  // The claude-sub/* models must resolve to the SAME variant rules as their
  // Anthropic family (claude-code-subscription-provider.md §6).

  it('claude-sub Opus 4.6: variant with max but NO xhigh (subscription tops out below 4.7/4.8)', () => {
    const cap = resolveReasoningCapability('claude-sub/claude-opus-4-6')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('max')
    expect(cap.levels).not.toContain('xhigh') // xhigh is 4.7/4.8 only — API-only, never on the subscription
    expect(cap.supported).toBe(true)
    expect(cap.source).toBe('registry-family')
  })

  it('claude-sub Sonnet 4.6: variant with max but not xhigh', () => {
    const cap = resolveReasoningCapability('claude-sub/claude-sonnet-4-6')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toContain('max')
    expect(cap.levels).not.toContain('xhigh')
  })

  it('claude-sub Haiku 4.5 (dated id): variant with only high and max', () => {
    const cap = resolveReasoningCapability('claude-sub/claude-haiku-4-5-20251001')
    expect(cap.mechanism).toBe('variant')
    expect(cap.levels).toEqual(['high', 'max'])
  })

  it('Unknown claude-sub model: returns none, not fallback', () => {
    const cap = resolveReasoningCapability('claude-sub/some-future-model')
    expect(cap.mechanism).toBe('none')
    expect(cap.supported).toBe(false)
    expect(cap.source).toBe('registry-family')
  })
})
