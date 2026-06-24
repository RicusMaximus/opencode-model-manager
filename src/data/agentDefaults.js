/**
 * agentDefaults.js
 *
 * SINGLE SOURCE OF TRUTH for the default value of every per-agent configuration
 * item the OpenCode Model Manager can edit.
 *
 * Two consumers:
 *   1. App.jsx load path — runs `applyAgentDefaults` over every agent read from
 *      opencode.jsonc so existing agents are back-filled (a non-destructive
 *      in-memory migration; the changes show as "unsaved" until the user saves).
 *   2. New-agent creation (App.jsx + AgentSettingsPanel) — every newly added
 *      agent starts from these same defaults.
 *
 * Design rules:
 *   • Non-destructive — a value already present on the agent always wins. We only
 *     fill fields that are missing / null / empty.
 *   • Scalar fields are filled only when absent.
 *   • Object fields (options / tools / permission) are MERGED: default keys are
 *     added underneath whatever the agent already has, so existing overrides and
 *     complex permission maps (e.g. permission.skill) are preserved.
 *   • Reasoning effort is model-aware — resolved from the reasoning-capability
 *     registry so each model gets a valid default level (or none).
 */

import { resolveReasoningCapability } from './reasoningCapabilities.js'

/**
 * Baseline defaults for the fields that are not model-dependent.
 * Reasoning effort (variant / options.reasoningEffort) is handled separately in
 * `applyAgentDefaults` because its valid values depend on the selected model.
 */
export const AGENT_CONFIG_DEFAULTS = {
  // Core behaviour
  mode: 'subagent',
  maxTokens: 8000,
  maxSteps: 45,

  // Model sampling options
  options: {
    temperature: 0.7,
    topP: 1,
  },

  // Tool overrides — a conservative read/search baseline. Mutating tools
  // (write / edit / bash / skill) are intentionally left to be enabled per-agent.
  tools: {
    read: true,
    grep: true,
    glob: true,
    todowrite: true,
    webfetch: true,
  },

  // Permission baseline — allow everything by default, but require confirmation
  // before running shell commands.
  permission: {
    '*': 'allow',
    bash: 'ask',
  },
}

/** Shallow helper: true when a value should be treated as "not set". */
function isUnset(v) {
  return v === null || v === undefined || v === ''
}

/**
 * Return a new agent object with every manageable config item populated.
 * Never mutates the input. Existing values always take precedence over defaults.
 *
 * @param {object} agent - An agent entry (may be sparse).
 * @returns {object} A deep clone with defaults filled in.
 */
export function applyAgentDefaults(agent) {
  const a = agent ? JSON.parse(JSON.stringify(agent)) : {}

  // ── Scalar fields ─────────────────────────────────────────────────────────
  if (isUnset(a.mode)) a.mode = AGENT_CONFIG_DEFAULTS.mode
  if (a.maxTokens == null) a.maxTokens = AGENT_CONFIG_DEFAULTS.maxTokens
  if (a.maxSteps == null) a.maxSteps = AGENT_CONFIG_DEFAULTS.maxSteps
  // model intentionally left as-is: a null model means "inherit the global model".

  // ── Object fields — merge defaults UNDER existing values ─────────────────────
  const existingOptions = a.options && typeof a.options === 'object' ? a.options : {}
  a.options = { ...AGENT_CONFIG_DEFAULTS.options, ...existingOptions }

  const existingTools = a.tools && typeof a.tools === 'object' ? a.tools : {}
  a.tools = { ...AGENT_CONFIG_DEFAULTS.tools, ...existingTools }

  const existingPermission = a.permission && typeof a.permission === 'object' ? a.permission : {}
  a.permission = { ...AGENT_CONFIG_DEFAULTS.permission, ...existingPermission }

  // ── Reasoning effort — model-aware, only when no value set yet ───────────────
  const cap = resolveReasoningCapability(a.model)
  if (cap.mechanism === 'variant') {
    if (isUnset(a.variant) && cap.default) a.variant = cap.default
  } else if (cap.mechanism === 'reasoningEffort') {
    if (isUnset(a.options.reasoningEffort) && cap.default) {
      a.options.reasoningEffort = cap.default
    }
  }
  // 'thinking' / 'none' mechanisms: no effort default is written.

  return a
}
