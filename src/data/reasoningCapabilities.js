/**
 * reasoningCapabilities.js
 *
 * SINGLE SOURCE OF TRUTH for model reasoning-effort capabilities.
 *
 * How it works:
 *   resolveReasoningCapability(modelId, ollamaCapabilities?) walks three
 *   tiers of specificity — exact model ID → family prefix → provider default
 *   — and returns a ReasoningCapability descriptor that tells the UI:
 *     • whether the model supports reasoning effort at all
 *     • which effort levels are available
 *     • which write mechanism to use (variant / reasoningEffort / thinking)
 *     • where the match came from (for debugging)
 *
 * Mechanism semantics:
 *   'variant'          → write agent.<id>.variant = level
 *                        (Anthropic adaptive-thinking models claude-sonnet-4-6+)
 *   'reasoningEffort'  → write agent.<id>.options.reasoningEffort = level
 *                        (OpenAI o-series)
 *   'thinking'         → no tiers; uses Extended Thinking toggle
 *                        (local Ollama models that advertise the "thinking" capability)
 *   'none'             → model does not support reasoning effort
 */

/**
 * @typedef {Object} ReasoningCapability
 * @property {boolean} supported - Model accepts a reasoning field at all
 * @property {string[]} levels - Ordered effort labels; empty when unsupported
 * @property {string|null} default - Suggested label when first enabled, or null
 * @property {'variant'|'reasoningEffort'|'thinking'|'none'} mechanism
 *   - 'variant': write agent.variant = level (Anthropic adaptive-thinking models)
 *   - 'reasoningEffort': write agent.options.reasoningEffort = level (OpenAI o-series)
 *   - 'thinking': no tiers; uses Extended Thinking toggle (local models with thinking cap)
 *   - 'none': neither; nothing written
 * @property {'registry-id'|'registry-family'|'registry-provider'|'ollama-capabilities'|'fallback'} source
 */

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * The capability registry.  Three lookup tiers, checked in priority order:
 *   1. byModel   — exact model-id string match (highest priority)
 *   2. byFamily  — prefix match, first entry wins
 *   3. byProvider — provider-key match
 *   4. fallback  — catch-all for completely unknown model strings
 */
export const REASONING_CAPABILITIES = {
  // 1. Exact model id matches (highest priority)
  byModel: {
    // ── Anthropic: variant mechanism ──────────────────────────────────────────
    // Opus 4.8 — five tiers including xhigh
    'anthropic/claude-opus-4-8': {
      mechanism: 'variant',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
    },
    // Opus 4.7 — five tiers including xhigh
    'anthropic/claude-opus-4-7': {
      mechanism: 'variant',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
    },
    // Opus 4.6 — four tiers (no xhigh)
    'anthropic/claude-opus-4-6': {
      mechanism: 'variant',
      levels: ['low', 'medium', 'high', 'max'],
      default: 'high',
    },
    // Sonnet 4.6 — four tiers
    'anthropic/claude-sonnet-4-6': {
      mechanism: 'variant',
      levels: ['low', 'medium', 'high', 'max'],
      default: 'medium',
    },
    // Haiku 4.5 — budget-tokens based; only high and max
    'anthropic/claude-haiku-4-5': {
      mechanism: 'variant',
      levels: ['high', 'max'],
      default: 'high',
    },

    // ── OpenAI o-series: reasoningEffort mechanism ────────────────────────────
    'openai/o1':      { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
    'openai/o1-mini': { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
    'openai/o3':      { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
    'openai/o3-mini': { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
    'openai/o4-mini': { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
    'openai/o1-pro':  { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' },
  },

  // 2. Family/prefix matches (checked in order, first match wins)
  byFamily: [
    // Anthropic Opus 4.7+ supports xhigh
    { prefix: 'anthropic/claude-opus-4-7', cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' } },
    { prefix: 'anthropic/claude-opus-4-8', cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' } },
    // Anthropic Opus 4.x (without xhigh)
    { prefix: 'anthropic/claude-opus-4',   cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'max'], default: 'high' } },
    // Anthropic Sonnet 4.x
    { prefix: 'anthropic/claude-sonnet-4', cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'max'], default: 'medium' } },
    // Anthropic Haiku 4.x (budget-tokens based, only high and max)
    { prefix: 'anthropic/claude-haiku-4',  cap: { mechanism: 'variant', levels: ['high', 'max'], default: 'high' } },
    // Anthropic: all other Claude models default to no effort support
    { prefix: 'anthropic/',                cap: { mechanism: 'none', levels: [], default: null } },

    // ── Claude (subscription) via the OpenAI-wrapper provider ──────────────────
    // Provider prefix is `claude-sub`, but reasoning capability keys on the model
    // FAMILY, not the provider — so these alias to the same Anthropic variant rules
    // (claude-code-subscription-provider.md §6). Order: most-specific first.
    { prefix: 'claude-sub/claude-opus-4-8',   cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' } },
    { prefix: 'claude-sub/claude-opus-4-7',   cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' } },
    { prefix: 'claude-sub/claude-opus-4',     cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'max'], default: 'high' } },
    { prefix: 'claude-sub/claude-sonnet-4',   cap: { mechanism: 'variant', levels: ['low', 'medium', 'high', 'max'], default: 'medium' } },
    { prefix: 'claude-sub/claude-haiku-4',    cap: { mechanism: 'variant', levels: ['high', 'max'], default: 'high' } },
    { prefix: 'claude-sub/',                  cap: { mechanism: 'none', levels: [], default: null } },

    // OpenAI o-series
    { prefix: 'openai/o1', cap: { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' } },
    { prefix: 'openai/o3', cap: { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' } },
    { prefix: 'openai/o4', cap: { mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], default: 'medium' } },
  ],

  // 3. Provider defaults
  byProvider: {
    anthropic: { mechanism: 'none',     levels: [], default: null },
    openai:    { mechanism: 'none',     levels: [], default: null },
    // Ollama may be overridden at runtime if /api/show reports 'thinking' capability
    ollama:    { mechanism: 'thinking', levels: [], default: null },
  },

  // 4. Fallback for completely unknown model strings
  fallback: { mechanism: 'none', levels: [], default: null },
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolves the reasoning capability for a model.
 *
 * @param {string|null} modelId - Model ID in "provider/model-id" format
 * @param {string[]|null} [ollamaCapabilities] - Capabilities from Ollama /api/show
 *   (e.g. ["completion", "thinking", "tools"])
 * @returns {ReasoningCapability}
 */
export function resolveReasoningCapability(modelId, ollamaCapabilities = null) {
  // Unknown/empty model id
  if (!modelId || typeof modelId !== 'string') {
    return { ...REASONING_CAPABILITIES.fallback, supported: false, source: 'fallback' }
  }

  // 1. Exact model id match
  const exact = REASONING_CAPABILITIES.byModel[modelId]
  if (exact) {
    return {
      ...exact,
      supported: exact.levels.length > 0 || exact.mechanism !== 'none',
      source: 'registry-id',
    }
  }

  // 2. Family/prefix match (first match wins)
  for (const { prefix, cap } of REASONING_CAPABILITIES.byFamily) {
    if (modelId.startsWith(prefix)) {
      return {
        ...cap,
        supported: cap.levels.length > 0 || cap.mechanism !== 'none',
        source: 'registry-family',
      }
    }
  }

  // 3. Provider default
  const provider = modelId.includes('/') ? modelId.split('/')[0] : null
  if (provider && REASONING_CAPABILITIES.byProvider[provider]) {
    const cap = REASONING_CAPABILITIES.byProvider[provider]

    // Special case: Ollama models — override with runtime capability if available
    if (provider === 'ollama') {
      if (ollamaCapabilities && ollamaCapabilities.includes('thinking')) {
        return {
          mechanism: 'thinking',
          levels: [],
          default: null,
          supported: true,
          source: 'ollama-capabilities',
        }
      }
      // Capabilities fetched but 'thinking' not in the list → no reasoning support
      return { mechanism: 'none', levels: [], default: null, supported: false, source: 'ollama-capabilities' }
    }

    return {
      ...cap,
      supported: cap.levels.length > 0 || cap.mechanism !== 'none',
      source: 'registry-provider',
    }
  }

  // 4. Fallback
  return { ...REASONING_CAPABILITIES.fallback, supported: false, source: 'fallback' }
}
