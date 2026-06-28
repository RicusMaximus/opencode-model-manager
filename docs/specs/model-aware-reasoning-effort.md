# SDD Design Spec — Model-Aware Reasoning Effort

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-24 |
| **Target component** | OpenCode Agent Manager (Electron + React) |
| **Primary surfaces** | `src/components/AgentSettingsPanel.jsx`, `src/components/ModelDropdown.jsx`, `electron/main.js` |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope for this document — this is a design hand-off for an agent orchestrator |

---

## 1. Summary

Today the **Reasoning Effort** control in the agent editor is a static segmented control offering `off / low / medium / high` for **every** agent regardless of which model is selected. This is wrong in two directions:

- It offers effort levels for models that do not support reasoning effort at all (e.g. a plain chat model, most local models).
- It omits levels that some models *do* support — notably **`max`** on Claude Opus 4.8, which is absent for Claude Sonnet 4.6.

This spec defines a feature where the set of selectable reasoning-effort values is **derived from the currently selected model**, rendered dynamically, and persisted to `opencode.jsonc` in a way that is **semantically valid for OpenCode**. It also answers the prerequisite research question: *can we know, ahead of time, which reasoning efforts a given model supports — for both cloud and local models?*

---

## 2. Problem statement & motivation

`opencode.jsonc` stores reasoning effort as `agent.<id>.options.reasoningEffort`. The value is provider/model-specific:

- Different model families accept different enums (e.g. OpenAI reasoning models historically `minimal | low | medium | high`; Anthropic effort tiers including `max` on top-tier models).
- Some models do not accept the field at all; writing it produces a config that is at best ignored and at worst rejected by the provider at runtime.

The manager's job is to produce **correct** OpenCode config without the user hand-editing JSON (per `AGENTS.md`). A model-blind effort picker undermines that promise. Making the picker model-aware keeps the written config valid and teaches the user what each model can actually do.

---

## 3. Goals / Non-goals

### Goals
1. The Reasoning Effort control renders **only the values valid for the selected model**, including `max` where applicable.
2. When a model does **not** support reasoning effort, the control communicates that clearly (disabled + explanation) and **no `reasoningEffort` key is written** for that agent.
3. Changing the selected model **re-resolves** the available efforts and reconciles the current value (clamp/clear if now-invalid).
4. The persisted `opencode.jsonc` is **semantically correct**: valid enum value or field omitted; never an unsupported value.
5. Capability resolution works for both **cloud** models (Anthropic/OpenAI/Google/etc.) and **local** Ollama models, with a graceful fallback for unknown/custom model strings.
6. Capability data is maintainable without code changes to the UI (a single registry/source of truth).

### Non-goals
- Building the feature (this is design only).
- Redesigning the Extended Thinking (`options.thinking`) control beyond defining how it coexists with reasoning effort.
- Validating runtime provider behavior (we validate config *shape*, not live API acceptance).
- Auto-discovering brand-new models the instant a provider ships them (handled by the registry + fallback, not by magic).

---

## 4. Background — current implementation

Grounding references (names stable even if line numbers drift):

- **`src/components/AgentSettingsPanel.jsx`**
  - Reasoning effort: a segmented control hardcoded to `[null, 'low', 'medium', 'high']` that calls `setOption('reasoningEffort', v)`. `null` ⇒ "off".
  - Extended Thinking: a toggle (`setThinking`) writing `options.thinking = { type: 'enabled', budgetTokens }`, plus a budget slider. Independent of, and always shown alongside, reasoning effort.
  - Copy strings live in `PARAM_INFO.reasoningEffort` and `PARAM_INFO.extendedThinking`.
  - The selected model is `draft.model`; helper `getModelKind(modelId)` already classifies `CLOUD` vs `LOCAL` by the `provider/` prefix.
- **`src/components/ModelDropdown.jsx`**
  - `CLOUD_MODELS` is a hardcoded list of `{ id, name, provider }`. Local models arrive via the `ollamaModels` prop. Model IDs follow `provider/model-id` (`AGENTS.md`).
- **`electron/main.js`**
  - `config:write` serializes options generically: it copies every non-null `options.*` entry to `entry.options`. So `reasoningEffort` is written verbatim, and a `null` value is dropped (the current "off" omission mechanism).
  - `ollama:get-model-detail` POSTs `/api/show` and currently extracts only `contextLength`. The raw response also carries a `capabilities` array in recent Ollama versions.
- **`AGENTS.md`** documents the `provider/model-id` convention and the `options` block.

**Net:** the data path already supports writing `options.reasoningEffort`; what's missing is (a) knowing the valid set per model and (b) a UI that respects it.

---

## 5. Feasibility research — *can we know the supported efforts beforehand?*

This is the question the spec must answer before design. Short answer: **Yes, but not by runtime discovery alone — it requires a curated capability registry, optionally enriched from `models.dev`.**

### 5.1 Cloud models
- **There is no standard provider endpoint that enumerates the accepted `reasoningEffort` values for a model.** Provider APIs reject invalid values at call time; they do not advertise the valid set.
- **`models.dev`** (the model catalog OpenCode itself uses; machine-readable at `https://models.dev/api.json`) publishes per-model metadata including a **`reasoning: boolean`** flag, modalities, context/output limits, and cost. This reliably answers *"does this model do reasoning at all?"* — but **does not enumerate effort tiers** (`low/medium/high/max`).
- **Conclusion:** the *boolean* "supports reasoning" can be sourced/validated from `models.dev`; the *granular tier list* (and specifically where `max` exists) must be **curated** by us, keyed by model id/family.

### 5.2 Local models (Ollama)
- `/api/show` returns a **`capabilities`** array on recent Ollama builds that may include `"thinking"` (alongside `"completion"`, `"tools"`, `"vision"`, etc.). This lets us detect whether a local model supports a thinking/reasoning mode.
- Ollama does **not** define standardized effort tiers (`low/medium/high`). Local reasoning is typically a boolean "thinking on/off."
- **Conclusion:** for local models, map capability to the **Extended Thinking toggle**, not to an effort-tier selector, unless the registry explicitly declares tiers for a specific local model.

### 5.3 Overall feasibility verdict
Feasible via a **curated capability registry as the source of truth**, with this resolution order:

1. **Exact model id** match in the registry → authoritative effort set.
2. **Family/prefix** match (e.g. `anthropic/claude-opus-4*`) → family default.
3. **Provider** default (e.g. any `openai/*` reasoning model).
4. **`models.dev` `reasoning` flag** → if `false`, force "no effort support"; if `true` but no tier data, fall back to a conservative default tier set.
5. **Unknown/custom string** → safe fallback (see §7.6).

The registry is small, human-maintainable, and can be **cross-checked** against `models.dev` in CI or at runtime, but `models.dev` is an *enrichment/validation* source, not a replacement for the curated tier data.

> **Open research item (must be resolved during implementation, see §11):** Confirm the **exact field name and accepted enum values** OpenCode expects for Anthropic effort tiers — i.e. whether `max` is expressed as `options.reasoningEffort: "max"` or via a different mechanism — by reading the OpenCode config schema/source (`https://opencode.ai/config.json` and the OpenCode repo). The registry's enum values MUST match that authority. This spec assumes `options.reasoningEffort` with string tiers, but that assumption is explicitly flagged for validation.

---

## 6. Proposed design — overview

Introduce a **Model Capability layer** that, given a model id, returns its reasoning-effort capability descriptor. The agent editor consumes this descriptor to render the control and to keep `draft.options.reasoningEffort` valid. Local capability (thinking) is detected through an extended `ollama:get-model-detail`.

```
                ┌──────────────────────────────┐
 draft.model →  │   resolveReasoningCapability  │ → { supported, levels[], default, source }
                │   (registry → family →        │
                │    provider → models.dev →    │
                │    fallback)                  │
                └──────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
  Reasoning Effort control          Reconciliation on model change
  (renders levels, disabled          (clamp/clear invalid value;
   state, "max" tier)                never persist unsupported value)
```

---

## 7. Detailed design

### 7.1 Capability descriptor (contract)

A single normalized shape returned by the resolver:

```ts
type ReasoningCapability = {
  supported: boolean        // model accepts a reasoning-effort field at all
  levels: string[]          // ordered, e.g. ["low","medium","high","max"]; [] when unsupported
  default: string | null    // suggested level when user first enables, or null
  mechanism: 'reasoningEffort' | 'thinking' | 'none'
                            // how it must be expressed in opencode.jsonc
  source: 'registry-id' | 'registry-family' | 'registry-provider'
        | 'models.dev' | 'ollama-capabilities' | 'fallback'
                            // provenance, for debugging/telemetry/UI hint
}
```

`mechanism` is the bridge to **semantic correctness**:
- `reasoningEffort` → write `options.reasoningEffort: <level>` (cloud tiered models).
- `thinking` → no effort tiers; this model uses the **Extended Thinking** toggle (`options.thinking`). The effort selector is hidden/disabled in favor of the existing thinking control.
- `none` → neither; both controls hidden/disabled and nothing written.

### 7.2 Capability registry (source of truth)

A maintainable data module, e.g. `src/data/reasoningCapabilities.js`, keyed for the resolution order in §5.3. Illustrative only — **values pending §11 validation**:

```js
export const REASONING_CAPABILITIES = {
  // 1. Exact model id (highest priority)
  byModel: {
    'anthropic/claude-opus-4-8':   { mechanism: 'reasoningEffort', levels: ['low','medium','high','max'], default: 'high' },
    'anthropic/claude-sonnet-4-6': { mechanism: 'reasoningEffort', levels: ['low','medium','high'],        default: 'medium' },
    'anthropic/claude-haiku-4-5':  { mechanism: 'reasoningEffort', levels: ['low','medium','high'],        default: 'low' },
  },
  // 2. Family / prefix (glob or startsWith)
  byFamily: [
    { match: 'anthropic/claude-opus-4', cap: { mechanism: 'reasoningEffort', levels: ['low','medium','high','max'], default: 'high' } },
    { match: 'openai/o',                cap: { mechanism: 'reasoningEffort', levels: ['minimal','low','medium','high'], default: 'medium' } },
  ],
  // 3. Provider default
  byProvider: {
    anthropic: { mechanism: 'reasoningEffort', levels: ['low','medium','high'], default: 'medium' },
    ollama:    { mechanism: 'thinking',        levels: [],                       default: null },
  },
  // 4. Final fallback for unknown strings
  fallback: { mechanism: 'none', levels: [], default: null },
}
```

> The registry intentionally separates `levels` (what's offered) from `mechanism` (how it's written). This is what lets Opus expose `max` while Sonnet does not, from the same UI.

### 7.3 `models.dev` enrichment (optional, layered)

- Add a main-process fetch (cached to `userData`, TTL-refreshed, offline-tolerant) of `https://models.dev/api.json`, exposed via a new IPC method (e.g. `models:get-catalog`).
- Use it **only** to:
  - Override `supported`/`mechanism: 'none'` when `reasoning === false` for a known model (prevents offering effort on a non-reasoning model the registry hasn't seen).
  - Surface model display metadata if convenient (out of scope to expand here).
- Never let `models.dev` *invent* tier lists; it has none. Registry remains authoritative for `levels`.
- Must degrade gracefully: no network ⇒ registry + fallback only. The feature must be fully functional offline.

### 7.4 Local capability detection (Ollama)

- Extend `ollama:get-model-detail` (`electron/main.js`) to also return `capabilities` from the `/api/show` response (e.g. `{ contextLength, capabilities: [...] }`).
- Resolver rule for `ollama/*`: if `capabilities` includes `"thinking"` ⇒ `mechanism: 'thinking'`; else `mechanism: 'none'`. Registry `byModel`/`byFamily` may override for specific local models that genuinely expose tiers.
- This reuses the **existing Extended Thinking toggle** for local reasoning models rather than inventing tier semantics Ollama doesn't have.

### 7.5 UI / UX in `AgentSettingsPanel.jsx`

Resolve capability from `draft.model` (recompute via `useMemo` on model change; for local models, capability may arrive asynchronously from the detail fetch — handle a "loading" state).

Rendering rules for the **Reasoning Effort** row:
- `mechanism === 'reasoningEffort'`: render the segmented control from `capability.levels` (dynamic — `max` appears only when present), plus the existing **off** option (clears the field). Highlight the current value; if the current value isn't in `levels`, show it as invalid (see §7.7).
- `mechanism === 'thinking'`: hide/disable the effort selector; show a short hint pointing to the **Extended Thinking** control ("This model uses extended thinking instead of effort tiers"). Keep the existing thinking toggle authoritative.
- `mechanism === 'none'`: render the control **disabled** with explanatory copy ("The selected model does not support reasoning effort"). No value is writable.
- Always expose the `capability.source`/reason via the existing `InfoTooltip` pattern so the user understands *why* options changed.

Update `PARAM_INFO.reasoningEffort` copy to reflect that the available levels depend on the model.

> **Coexistence decision (Extended Thinking vs Reasoning Effort):** these are two expressions of the same underlying concept for different providers. The control shown is driven by `mechanism`. The spec's default stance: **show at most one** mechanism as active per model. If the orchestrator's research (§11) finds a model that legitimately accepts *both* `reasoningEffort` and `thinking`, revisit this as a follow-up; do not assume it.

### 7.6 Reconciliation on model change

When `draft.model` changes:
1. Re-resolve capability.
2. If the existing `draft.options.reasoningEffort` is **not** in the new `levels` (or new `mechanism !== 'reasoningEffort'`), **clear** it (`setOption('reasoningEffort', null)`), which omits it on save.
3. Optionally surface a non-blocking notice ("Reasoning effort reset — Sonnet 4.6 does not support `max`").
4. Mark the draft dirty (it already tracks dirty state) so the user saves the corrected config.

### 7.7 Persistence & migration (semantic correctness)

- **On save:** unchanged mechanism — `config:write` already drops null options and writes the rest. Because the UI can only set a valid `levels` value, the written `options.reasoningEffort` is always valid for the model.
- **On load (existing configs):** an agent may already carry an invalid pairing (e.g. `claude-sonnet-4-6` + `reasoningEffort: "max"` hand-written previously). Define a **load-time reconciliation**: compute capability; if the stored value is invalid, either (a) clamp to the nearest valid tier and mark dirty, or (b) flag it visibly and let the user fix it. **Recommended: flag, don't silently clamp** — silent edits to a user's config violate the "preserve intent" principle in `AGENTS.md`. Decision left to the orchestrator but recommendation stated.
- **Unknown/custom models** (free-text in `ModelDropdown`): `mechanism: 'none'` fallback by default, BUT do **not** strip an existing `reasoningEffort` the user typed for a custom model — preserve it as `_extra`-style passthrough intent. (Reconcile this with §7.6 step 2: only auto-clear when we *positively know* the model and know the value is invalid; for unknown models, preserve.)

### 7.8 No `opencode.jsonc` schema changes

The field (`options.reasoningEffort`) and write path already exist. This feature changes **which values the UI produces**, not the config shape. The Ollama provider block and atomic-write invariants (`AGENTS.md` §Key invariants) are untouched.

---

## 8. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | Model with `max` (Opus 4.8) | `max` appears in selector |
| 2 | Model without `max` (Sonnet 4.6) | `max` absent; selecting it impossible |
| 3 | Non-reasoning chat model | Selector disabled, nothing written |
| 4 | Local model with `thinking` capability | Effort selector hidden; Extended Thinking toggle used |
| 5 | Local model without thinking | Both controls disabled |
| 6 | Offline (no models.dev) | Registry + fallback only; feature works |
| 7 | Ollama not running | Local capability unknown → treat as `none` (or "unknown" state); never crash |
| 8 | Custom/free-text model id | Fallback `none`; preserve any existing user-set value |
| 9 | Stored value now-invalid after model swap | Cleared (known model) or flagged (load-time); never silently kept-and-saved as invalid |
| 10 | New model not yet in registry | Provider/family fallback or models.dev `reasoning` flag decides; safe default |

---

## 9. Testing strategy

- **Unit — resolver:** table-driven tests over `resolveReasoningCapability(modelId, ctx)` covering each resolution tier and every row in §8. Include Opus-with-`max` vs Sonnet-without-`max` as explicit assertions.
- **Unit — reconciliation:** model-swap clears invalid values for known models; preserves for unknown; load-time flagging behaves per §7.7.
- **Integration — persistence:** round-trip an agent through `config:write` and re-read; assert `options.reasoningEffort` is valid-or-absent for the chosen model.
- **Integration — Ollama:** mock `/api/show` with and without `capabilities: ["thinking"]`; assert mechanism.
- **Offline:** force models.dev fetch failure; assert registry-only behavior.
- **Manual / `/run`:** open agent editor, switch Opus↔Sonnet↔a local model, confirm the control updates and the saved JSON matches.

---

## 10. Rollout & task breakdown (for the orchestrator)

Suggested decomposition into sub-agent tasks:

1. **architect / research (blocking):** Resolve §11 open questions against the OpenCode config schema and `models.dev`. Produce the validated enum tables and confirm the `reasoningEffort` vs `thinking` field semantics. Output: a filled-in version of the §7.2 registry values + a short findings note.
2. **builder — capability layer:** Implement `reasoningCapabilities.js` registry + `resolveReasoningCapability()`; extend `ollama:get-model-detail` to surface `capabilities`; add optional `models:get-catalog` IPC with cache + offline tolerance.
3. **builder — UI:** Make the Reasoning Effort control model-aware in `AgentSettingsPanel.jsx` (dynamic levels, disabled/thinking states, tooltips), plus model-change and load-time reconciliation.
4. **validator:** Implement the §9 test matrix; verify semantic correctness of written configs; verify offline + Ollama-down paths.
5. **scribe:** Update `AGENTS.md` (document model-aware effort + the registry as the maintenance point) and `PARAM_INFO` copy.

Recommended sequencing: **1 → (2 ∥ 3) → 4 → 5.** Task 1 is a hard prerequisite because the registry's correctness depends on its findings.

---

## 11. Open questions (must be answered during task 1)

1. **Exact OpenCode semantics for Anthropic effort tiers.** Is `max` expressed as `options.reasoningEffort: "max"`, or via another field? Confirm against `https://opencode.ai/config.json` and the OpenCode source. *Everything downstream depends on this.*
2. **Full accepted enum per provider/family.** Authoritative lists for Anthropic (does Sonnet 4.6 accept `low/medium/high`? does anything below Opus accept `max`?), OpenAI (`minimal` included?), Google, etc.
3. **Mutual exclusivity of `reasoningEffort` and `thinking`.** Does any model accept both? Drives the §7.5 coexistence rule.
4. **Local effort tiers.** Do any Ollama models accept reasoning-effort tiers via the openai-compatible provider, or is thinking strictly boolean for local?
5. **`models.dev` field stability.** Confirm the `reasoning` flag's presence/meaning and whether any tier hint exists we can consume.

---

## 12. Acceptance criteria

- [ ] Selecting **Claude Opus 4.8** shows `max`; selecting **Claude Sonnet 4.6** does not.
- [ ] A non-reasoning model disables the control and writes **no** `reasoningEffort`.
- [ ] Local models with a `thinking` capability route to Extended Thinking, not effort tiers.
- [ ] Switching models reconciles the stored value so saved `opencode.jsonc` is never invalid for the active model.
- [ ] Feature works fully **offline** and with **Ollama not running**.
- [ ] Effort enums match the authority identified in §11 (semantic correctness verified by tests).
- [ ] Registry is the single maintenance point for adding/adjusting model capabilities; no UI code changes needed to add a model.
```
