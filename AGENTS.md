# AGENTS.md — OpenCode Model Manager

A desktop GUI (Electron 33 + React 18 + Vite 5) for configuring [OpenCode](https://opencode.ai) agents without hand-editing JSON. Agents working on this codebase should read this file before making changes.

---

## What this app does

- Reads `<configDir>/opencode.jsonc` and all `<configDir>/agents/*.agent.md` files.
- Displays each agent as a card; lets the user assign a model, edit descriptions, toggle tools, set permissions, and configure advanced options.
- Writes changes back to `opencode.jsonc` atomically (temp-file → rename) while preserving unknown fields.
- Polls Ollama every 10 s for locally installed models; polls system info every 5 s.
- The config directory defaults to `~/.config/opencode` (Linux/macOS) / `%USERPROFILE%\.config\opencode` (Windows) and is persisted in Electron's `userData/prefs.json`.

---

## Project structure

```
electron/
  main.js       — Electron main process: all IPC handlers, config I/O, Ollama HTTP client
  preload.js    — Context bridge; exposes window.electronAPI to the renderer

src/
  App.jsx                          — Root: state, polling loops, save/browse handlers
  main.jsx                         — React entry point
  components/
    AgentCard.jsx                  — Single agent card (model dropdown + settings button)
    AgentPanel.jsx                 — Bento grid of AgentCard components
    AgentSettingsPanel.jsx         — Full-page editor: model, description, prompt, tokens,
                                     steps, options, tool toggles, permission matrix, files
    ModelCard.jsx                  — Ollama model card (size, context length, params)
    ModelDropdown.jsx              — Provider-grouped model selector (Anthropic + Ollama)
    OllamaPanel.jsx                — Local model browser
    RightSidebar.jsx               — Contextual detail panel (system info / Ollama status)
    Sidebar.jsx                    — Left navigation (Agents / Models / System)
    StatusBar.jsx                  — Ollama status indicator + Save button
    TitleBar.jsx                   — Frameless custom title bar with folder picker
  styles/                          — SCSS 7-1 architecture (abstracts, base, components,
                                     layout, pages, themes, utilities, vendors)
    main.scss                      — Single entry point that forwards all partials

index.html
vite.config.js
package.json
```

---

## IPC contract (`window.electronAPI`)

All renderer→main communication goes through the preload context bridge. Never call Node APIs directly from renderer code.

| Method | Main handler | Notes |
|---|---|---|
| `getConfigPath()` | `config:get-path` | Returns active config dir path |
| `setConfigPath(dir)` | `config:set-path` | Writes `userData/prefs.json` |
| `selectFolder()` | `config:select-folder` | Native dialog; returns path or `null` |
| `readConfig()` | `config:read` | Returns `{ configDir, defaultModel, ollamaProviderModels, agents[] }` |
| `writeConfig({ agents, defaultModel, ollamaProviderModels })` | `config:write` | Atomic write; preserves `$schema` and unknown fields |
| `createAgentFile(agentId, agentData)` | `agent:create-file` | Writes `agents/<id>.agent.md` with YAML frontmatter |
| `readAgentFile(agentId)` | `agent:read-file` | Reads raw `agents/<id>.agent.md`; returns `{ exists, content, path }` |
| `writeAgentFile(agentId, content)` | `agent:write-file` | Atomic write of the raw `.agent.md` file |
| `listSkills()` | `skills:list` | Scans `skill/` and `skills/` for `*.md` (or `<dir>/SKILL.md`); returns `{ skills: [{ id, name, description, path }] }` |
| `listOllamaModels()` | `ollama:list-models` | `GET /api/tags`; returns `{ connected, models[] }` |
| `getOllamaModelDetail(name)` | `ollama:get-model-detail` | `POST /api/show`; returns `{ contextLength, capabilities: string[] }` — `capabilities` lists Ollama capability tags (e.g. `["completion", "thinking"]`). Used by the Reasoning Effort control. |
| `getSystemInfo()` | `system:get-info` | CPU, RAM, VRAM via `systeminformation` |
| `minimizeWindow()` | `window:minimize` | — |
| `maximizeWindow()` | `window:maximize` | Toggles maximize/restore |
| `closeWindow()` | `window:close` | — |

---

## Agent file format (`*.agent.md`)

The app parses these files in `electron/main.js → parseAgentFile()`. The format is YAML frontmatter followed by Markdown body:

```markdown
---
name: Builder
description: Implements features and writes production-quality code.
version: 1.0.0
mode: subagent
required_mcp_servers:
  - figma
  - n8n
required_env_vars:
  - FIGMA_API_KEY
---

## Responsibilities
- Write production-ready code based on the architect's design
- Follow project conventions and avoid introducing abstractions

## Rules
- Always prefer editing existing files to creating new ones
- Never add error handling for scenarios that can't happen
```

**Parsed fields:**
- Frontmatter: `name`, `description`, `version`, `mode`, `required_mcp_servers[]`, `required_env_vars[]`
- Body: `## Responsibilities` bullet points (up to 5), `## Workflow` numbered steps (fallback), `## Rules` bullets (up to 3)

Fields missing from the `.agent.md` fall back to values in `opencode.jsonc`, then to hardcoded defaults in `App.jsx → AGENT_META`.

---

## `opencode.jsonc` structure

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-6",   // global default
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "llama3.2": { "name": "llama3.2" } }
    }
  },
  "agent": {
    "builder": {
      "model": "anthropic/claude-opus-4-8",
      "description": "...",
      "prompt": "...",
      "mode": "subagent",
      "maxTokens": 8192,
      "maxSteps": 20,
      "variant": "high",               // reasoning effort for Anthropic models (variant system)
      "options": { "temperature": 0.3, "reasoningEffort": "high" }, // for OpenAI o-series only
      "tools": { "bash": "allow" },
      "permission": { "task": "allow", "bash": { "git *": "allow" } }
    }
  }
}
```

The write handler (`config:write`) explicitly handles: `model`, `description`, `prompt`, `mode`, `maxTokens`, `maxSteps`, `variant`, `color`, `options`, `tools`, `permission`, `disable`. Any other per-agent key lands in `_extra` and is round-tripped verbatim.

**`color`** is UI-only metadata (the accent color of the agent's square in the overview grid). It is editable from the agent edit screen, persisted into the agent's `opencode.jsonc` entry, and read back on load (a persisted value wins over the hardcoded `AGENT_META` palette in `App.jsx`). OpenCode itself ignores the field.

**Reasoning effort note:** For Anthropic Claude 4.x models the correct config field is `agent.<id>.variant` (e.g. `"high"`), which the OpenCode provider layer maps to `{ thinking: { type: "adaptive" }, effort: "high" }`. For OpenAI o-series, `agent.<id>.options.reasoningEffort` is used. The UI handles this automatically — see §Model-aware Reasoning Effort below.

---

## Known agents (hardcoded defaults in `App.jsx`)

| ID | Fallback name | Color |
|---|---|---|
| `agent-orchestrator` | Orchestrator | `#59a6ff` |
| `builder` | Builder | `#26a540` |
| `architect` | Architect | `#d19921` |
| `validator` | Validator | `#940009` |
| `scribe` | Scribe | `#404752` |
| `ux_ui_designer` | UX/UI Designer | `#59a6ff` |

To add a new built-in agent, add an entry to `AGENT_META` in `App.jsx` and optionally create the corresponding `.agent.md` in the user's config directory.

---

## Agent config defaults (migration)

Every per-agent config item the app can edit has a sensible default defined in
**`src/data/agentDefaults.js`** — the single maintenance point. `applyAgentDefaults(agent)`
returns a deep clone with all manageable fields back-filled.

- **On load** (`App.jsx`): every agent read from `opencode.jsonc` is run through
  `applyAgentDefaults`. It is non-destructive (existing values always win) and the
  pre-migration list is kept as the dirty-check baseline, so any newly-filled defaults
  surface as **unsaved changes** for the user to review and Save — nothing is written
  to disk automatically.
- **On create** (`App.jsx` `handleNewAgentSave` + `AgentSettingsPanel` create form): new
  agents start from these same defaults, so the create form opens pre-populated.

Default values: `mode: subagent`, `maxTokens: 8000`, `maxSteps: 45`,
`options.temperature: 0.7`, `options.topP: 1`, tools `read/grep/glob/todowrite/webfetch`
on, permission `{ "*": "allow", "bash": "ask" }`. Reasoning effort is **model-aware** —
resolved from `reasoningCapabilities.js` so each model gets a valid default level
(`variant` for Anthropic, `options.reasoningEffort` for OpenAI, none for Ollama/unknown).
`model` is intentionally left untouched (a null model inherits the global default).

---

## Permission model

`AgentSettingsPanel` exposes two layers of permission editing:

- **Simple permissions** (`SIMPLE_PERM_KEYS`): `*`, `read`, `write`, `edit`, `grep`, `glob`, `todowrite`, `question`, `webfetch`, `bash`, `websearch` — each gets a 3-way `allow / ask / deny` selector.
- **Pattern permissions** (`COMPLEX_PERM_KEYS`): `bash`, `skill`, `external_directory` — object-valued; each key is a glob pattern with an `allow / ask / deny` value.

The special key `permission.task` (`allow` | absent) gates the "Task Tool" badge on agent cards.

### Skills

The **Skills** card in `AgentSettingsPanel` lists skills discovered by `listSkills()` (markdown files under `<configDir>/skill/` or `<configDir>/skills/`). Toggling a skill on is a friendly front-end over `permission.skill`: it sets `permission.skill[<id>] = "allow"` and enables the `skill` tool. The raw `skill` pattern block under Permissions edits the same underlying map.

---

## Model dropdown

`ModelDropdown.jsx` groups options into:
1. **Anthropic** — hardcoded list of `anthropic/*` model IDs for the current Claude 4.x family (Opus 4.8, Sonnet 4.6, Haiku 4.5, Fable 5, etc.)
2. **Ollama (local)** — dynamically populated from `ollamaStatus.models` passed as a prop
3. **Custom** — free-text input for any provider string

Model IDs follow the pattern `provider/model-id` (e.g. `anthropic/claude-opus-4-8`, `ollama/llama3.2`).

---

## Development

```bash
npm install

# Full Electron + Vite dev mode (hot reload)
npm run electron:dev

# Vite browser-only (no Electron APIs available)
npm run dev

# Production build → dist/
npm run build

# Package → dist-electron/
npm run electron:build
```

- Requires Node 18+, npm 9+.
- Ollama is optional; the app degrades gracefully when it is not running.
- The Figma MCP server is configured via `.env` (`FIGMA_API_KEY`). Copy `.env.example` to `.env`.
- On Windows, the GPU shader disk cache is disabled at startup to avoid access-denied errors under corporate AV policies (`electron/main.js:14`).

---

## Style conventions

- SCSS 7-1 architecture under `src/styles/`. Entry point is `src/styles/main.scss`.
- CSS custom properties for theming are defined in `src/styles/themes/_default.scss` and consumed via `src/styles/base/_root.scss`.
- Component-scoped styles live in `src/styles/components/_<name>.scss`; layout in `src/styles/layout/`.
- Do not add inline styles or CSS-in-JS — use SCSS partials.

---

## Model-aware Reasoning Effort

The Reasoning Effort control in `AgentSettingsPanel` is **model-aware**: it shows only the levels valid for the selected model, writes to the correct config field, and auto-clears invalid values when the model changes.

### Capability registry — the single maintenance point

**`src/data/reasoningCapabilities.js`** is the only file to change when adding or adjusting model capabilities. It contains:

- `REASONING_CAPABILITIES.byModel` — exact model-id entries (highest priority)
- `REASONING_CAPABILITIES.byFamily` — prefix-match entries for whole model families
- `REASONING_CAPABILITIES.byProvider` — provider-wide defaults
- `REASONING_CAPABILITIES.fallback` — catch-all for unknown model strings

To add support for a new model, add an entry to `byModel` (or `byFamily` for a whole family). **No UI code changes are needed.**

### Mechanism types

| Mechanism | Config field written | Used for |
|---|---|---|
| `'variant'` | `agent.<id>.variant` | Anthropic Claude 4.x (adaptive thinking) |
| `'reasoningEffort'` | `agent.<id>.options.reasoningEffort` | OpenAI o-series |
| `'thinking'` | (no tiers — Extended Thinking toggle) | Ollama models with thinking capability |
| `'none'` | (nothing written) | Non-reasoning models |

### Confirmed level tables

| Model | Mechanism | Levels |
|---|---|---|
| `anthropic/claude-opus-4-8` | `variant` | `low · medium · high · xhigh · max` |
| `anthropic/claude-opus-4-7` | `variant` | `low · medium · high · xhigh · max` |
| `anthropic/claude-opus-4-6` | `variant` | `low · medium · high · max` |
| `anthropic/claude-sonnet-4-6` | `variant` | `low · medium · high · max` |
| `anthropic/claude-haiku-4-5` | `variant` | `high · max` (budget-tokens) |
| `openai/o1`, `o3`, `o3-mini`, `o4-mini` | `reasoningEffort` | `low · medium · high` |

### Reconciliation

When the model changes, `AgentSettingsPanel` automatically:
1. Re-resolves the capability for the new model.
2. Clears `draft.variant` if it's no longer a valid level for the new model.
3. Clears `draft.options.reasoningEffort` if the mechanism changed away from `reasoningEffort`.
4. Shows a warning badge if the loaded config had a legacy `options.reasoningEffort` for an Anthropic model (which is silently ignored by OpenCode — the correct field is `variant`).

---

## Key invariants

- **Atomic writes only.** All config writes go through `fs.writeFile(tmpPath) → fs.rename(tmpPath, configPath)`. Never write directly to `opencode.jsonc`.
- **Preserve unknown fields.** The `_extra` bag on each agent carries any JSON fields not explicitly handled. Always pass it through on write.
- **No Node in renderer.** The renderer communicates exclusively through `window.electronAPI`. Adding `nodeIntegration: true` or `contextIsolation: false` is not acceptable.
- **Dirty-state tracking.** `App.jsx` maintains `originalRef` (JSON snapshot after last load/save) and compares against current state. Update `originalRef.current` whenever you call `writeConfig` successfully.
- **Ollama model IDs.** Strip `:latest` suffix when building `ollamaProviderModels` keys (`m.name.replace(/:latest$/, '')`).
