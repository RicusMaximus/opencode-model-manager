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
| `getOllamaModelDetail(name)` | `ollama:get-model-detail` | `POST /api/show`; returns `{ contextLength }` |
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
      "options": { "temperature": 0.3, "reasoningEffort": "high" },
      "tools": { "bash": "allow" },
      "permission": { "task": "allow", "bash": { "git *": "allow" } }
    }
  }
}
```

The write handler (`config:write`) explicitly handles: `model`, `description`, `prompt`, `mode`, `maxTokens`, `maxSteps`, `options`, `tools`, `permission`, `disable`. Any other per-agent key lands in `_extra` and is round-tripped verbatim.

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

## Key invariants

- **Atomic writes only.** All config writes go through `fs.writeFile(tmpPath) → fs.rename(tmpPath, configPath)`. Never write directly to `opencode.jsonc`.
- **Preserve unknown fields.** The `_extra` bag on each agent carries any JSON fields not explicitly handled. Always pass it through on write.
- **No Node in renderer.** The renderer communicates exclusively through `window.electronAPI`. Adding `nodeIntegration: true` or `contextIsolation: false` is not acceptable.
- **Dirty-state tracking.** `App.jsx` maintains `originalRef` (JSON snapshot after last load/save) and compares against current state. Update `originalRef.current` whenever you call `writeConfig` successfully.
- **Ollama model IDs.** Strip `:latest` suffix when building `ollamaProviderModels` keys (`m.name.replace(/:latest$/, '')`).
