# OpenCode Agent Manager

A desktop GUI for configuring [OpenCode](https://opencode.ai) — assign LLM models to agents, tune per-agent reasoning effort, manage tools/skills/permissions, browse locally installed Ollama models, monitor system resources, and run a cryptographically-enforced **design→build approval gate** — all without hand-editing JSON.

<!-- Badges -->
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)
![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-MIT-blue)

![Last commit](https://img.shields.io/github/last-commit/RicusMaximus/opencode-agent-manager)
![Open issues](https://img.shields.io/github/issues/RicusMaximus/opencode-agent-manager)
![Stars](https://img.shields.io/github/stars/RicusMaximus/opencode-agent-manager?style=social)

> Built with **Electron 33 + React 18 + Vite 5**, styled with a SCSS 7-1 architecture, and tested with **Vitest**.

---

## Table of contents

- [What it does](#what-it-does)
- [Features at a glance](#features-at-a-glance)
- [Screens](#screens)
  - [Agents](#agents)
  - [Models](#models)
  - [Review Queue](#review-queue)
  - [System](#system)
- [Agent configuration](#agent-configuration)
  - [Tools, permissions & skills](#tools-permissions--skills)
  - [Model-aware reasoning effort](#model-aware-reasoning-effort)
  - [Agent config defaults](#agent-config-defaults)
- [Gated approval workflow](#gated-approval-workflow)
- [Obsidian project memory](#obsidian-project-memory)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Configuration & data locations](#configuration--data-locations)
- [Available scripts](#available-scripts)
- [Building for distribution](#building-for-distribution)
- [Project structure](#project-structure)
- [IPC API](#ipc-api-renderer--main)
- [Tech stack](#tech-stack)
- [Testing](#testing)
- [License](#license)

---

## What it does

OpenCode Agent Manager reads and writes your OpenCode configuration directly:

- `<configDir>/opencode.jsonc` — the global config and per-agent settings
- `<configDir>/agents/*.agent.md` — agent definition files (YAML frontmatter + Markdown)
- `<configDir>/skill/` or `<configDir>/skills/` — skill definitions
- `<configDir>/.gate/` — the approval-gate filesystem bus (additive, created on demand)

All config writes are **atomic** (temp file → rename) and **non-destructive** — unknown fields are round-tripped verbatim, so the app never clobbers settings it doesn't understand.

---

## Features at a glance

| Area | What you get |
|---|---|
| **Agents** | A bento grid of every agent in your pipeline; per-agent model assignment, description/prompt editing, token & step limits, tool toggles, a permission matrix, skill grants, and accent colors |
| **Models** | Browse locally installed Ollama models with search and live connection status; per-model context length, size, and capability tags |
| **Review Queue** | Human-in-the-loop approval gate with side-by-side artifact diffing, a rule-based checklist, and approve / reject-with-notes |
| **System** | Real-time CPU, RAM, and VRAM usage via `systeminformation` |
| **Reasoning effort** | Model-aware control that shows only valid levels and writes to the correct config field per provider |
| **Gated workflow** | HMAC-signed, fail-closed design→build gate enforced at the OpenCode runtime via a blocking MCP tool |
| **Project memory** | An Obsidian vault wired up over MCP so AI agents can persist and recall project knowledge |

**Quality-of-life details**

- Reads/writes `opencode.jsonc` directly — no intermediate format, comments preserved
- Preserves unknown config fields (e.g. custom `permission` blocks) on every save
- Atomic writes so a crash never corrupts your config
- Live Ollama polling every 10 s; system stats every 5 s; live review-queue updates pushed from the main process
- Frameless custom title bar with minimize / maximize / close and a workspace folder picker
- Unsaved-changes indicator with a single **Save Changes** button and dirty-state tracking

---

## Screens

The app has four primary views, selectable from the left sidebar (**Agents · Models · Review Queue · System**). The Review Queue tab shows a live pending-count badge.

### Agents

Each agent is rendered as a card showing its name, description, assigned model, and a "Task Tool" badge when the orchestrator permission is granted. Opening an agent reveals a full-page editor (`AgentSettingsPanel`) for:

- **Model** — via a provider-grouped dropdown (Anthropic presets, local Ollama models, or a free-text custom string)
- **Description & prompt**
- **`maxTokens` / `maxSteps`**
- **Reasoning effort** (model-aware — see below)
- **Tool toggles** and a **permission matrix**
- **Skills** the agent may invoke
- **Accent color** for the overview grid
- Direct editing of the raw `*.agent.md` file

Agent display names and descriptions are read from each agent's `.agent.md` frontmatter when present, falling back to values in `opencode.jsonc`, then to hardcoded defaults in `App.jsx → AGENT_META`.

**Built-in agents:**

| ID | Name | Color | Role |
|---|---|---|---|
| `agent-orchestrator` | agent-orchestrator | 🔵 `#59a6ff` | Primary entry point that decomposes complex, multi-discipline work and delegates each piece to the right specialist. Coordinates the pipeline and synthesizes a final summary — it never researches, codes, edits, or runs commands itself. |
| `architect` | architect | 🟠 `#d19921` | Research, requirements analysis, and architecture planning. Explores the codebase, weighs trade-offs, and produces a concrete, file-level implementation plan before any code is written. Returns a design document, not code. |
| `builder` | builder | 🟢 `#26a540` | Core implementation. Writes, modifies, and refactors real code from an existing plan with targeted, idiomatic edits that match the codebase. Changes one logical thing at a time and stays in scope. |
| `validator` | validator | 🔴 `#940009` | Testing, debugging, and QA. Runs real tests across happy path, edge cases, and failure modes; catches regressions and reports each bug precisely. Returns a ready-to-ship / needs-fixes recommendation. |
| `scribe` | scribe | 🔵 `#0a439e` | Documentation and behavior-preserving code refinement. Writes READMEs, guides, and inline comments that explain the *why*, plus small clarity improvements. Must not alter behavior. |
| `ui-generator` | UI Generator (Stitch) | 🟦 `#1abc9c` | Idea-to-screen specialist. Turns specs and notes into UI screens via the Google Stitch MCP server, then produces a clean HANDOFF block for the integrator. Requires the `stitch` MCP server. |
| `design-system-integrator` | Design System Integrator (Figma) | 🟦 `#1abc9c` | Figma systematization specialist. Moves Stitch-generated designs into Figma and rebuilds them with the project's design system — real components, variables, and tokens. Requires the `figma` MCP server and `FIGMA_ACCESS_TOKEN`. |
| `repository` | Git | ⬛ `#404752` | Lightweight commit assistant. Inspects `git status`/`git diff`, works out what functionally changed, and writes a Conventional Commits message. Never pushes unless explicitly asked. |

### Models

Browse Ollama models installed locally. The panel polls `GET /api/tags` every 10 s and shows live connection status (`127.0.0.1:11434`). Selecting a model fetches its detail (`POST /api/show`) including context length and capability tags (e.g. `completion`, `thinking`), which feed the reasoning-effort control.

### Review Queue

The human side of the [gated approval workflow](#gated-approval-workflow). Pending review requests appear here (with a sidebar badge); each opens a side-by-side view of the submitted artifacts, an optional rule-based **MTF checklist**, and **Approve** / **Reject-with-notes** actions. Decided reviews move to a **History** tab. Updates are pushed live from the main process.

### System

Real-time hardware monitoring — CPU, RAM, and VRAM — sampled every 5 s via `systeminformation`. Degrades gracefully on machines without a discrete GPU.

---

## Agent configuration

### Tools, permissions & skills

`AgentSettingsPanel` exposes two layers of permission control:

- **Simple permissions** — `*`, `read`, `write`, `edit`, `grep`, `glob`, `todowrite`, `question`, `webfetch`, `bash`, `websearch`, each with a 3-way `allow / ask / deny` selector.
- **Pattern permissions** — `bash`, `skill`, `external_directory` are object-valued, where each key is a glob pattern (e.g. `bash` → `"git *": "allow"`) with its own `allow / ask / deny` value.

The special `permission.task` key (`allow` | absent) gates the **Task Tool** badge on agent cards.

**Skills.** The **Skills** card lists skills discovered by scanning `<configDir>/skill/` and `<configDir>/skills/` for `*.md` files (or `<dir>/SKILL.md`). Toggling a skill on is a friendly front-end over `permission.skill`: it sets `permission.skill[<id>] = "allow"` and enables the `skill` tool. The raw `skill` pattern block edits the same underlying map.

### Model-aware reasoning effort

The **Reasoning Effort** control is model-aware: it shows only the levels valid for the selected model, writes to the correct config field, and auto-clears invalid values when the model changes.

| Mechanism | Config field written | Used for |
|---|---|---|
| `variant` | `agent.<id>.variant` | Anthropic Claude 4.x (adaptive thinking) |
| `reasoningEffort` | `agent.<id>.options.reasoningEffort` | OpenAI o-series |
| `thinking` | (toggle, no tiers) | Ollama models with a thinking capability |
| `none` | (nothing written) | Non-reasoning models |

Confirmed level tables:

| Model | Mechanism | Levels |
|---|---|---|
| `anthropic/claude-opus-4-8` | `variant` | low · medium · high · xhigh · max |
| `anthropic/claude-opus-4-7` | `variant` | low · medium · high · xhigh · max |
| `anthropic/claude-opus-4-6` | `variant` | low · medium · high · max |
| `anthropic/claude-sonnet-4-6` | `variant` | low · medium · high · max |
| `anthropic/claude-haiku-4-5` | `variant` | high · max |
| `openai/o1`, `o3`, `o3-mini`, `o4-mini` | `reasoningEffort` | low · medium · high |

> **Single maintenance point:** `src/data/reasoningCapabilities.js` is the only file to edit when adding or adjusting model capabilities (`byModel` → `byFamily` → `byProvider` → `fallback` resolution order). No UI changes required.

When the model changes, the panel re-resolves capabilities, clears now-invalid values, and warns if the loaded config carried a legacy `options.reasoningEffort` on an Anthropic model (which OpenCode silently ignores — the correct field is `variant`).

### Agent config defaults

Every editable per-agent field has a sensible default defined in **`src/data/agentDefaults.js`** — the single maintenance point. `applyAgentDefaults(agent)` returns a deep clone with all manageable fields back-filled.

- **On load:** every agent is run through `applyAgentDefaults`. It is non-destructive (existing values always win), and newly-filled defaults surface as **unsaved changes** for you to review and Save — nothing is written to disk automatically.
- **On create:** new agents start from these defaults, so the create form opens pre-populated.

Defaults: `mode: subagent`, `maxTokens: 8000`, `maxSteps: 45`, `options.temperature: 0.7`, `options.topP: 1`, tools `read/grep/glob/todowrite/webfetch` on, permission `{ "*": "allow", "bash": "ask" }`. Reasoning effort is resolved model-aware. `model` is intentionally left untouched (a null model inherits the global default).

---

## Gated approval workflow

The design→build gate is **enforced**, not just prose. A design agent cannot proceed until a human approves its output in the app. The gate is cryptographically signed and **fails closed** — a timeout, missing/invalid signature, or a closed app all resolve to `rejected`.

```
┌──────────────┐   submit_for_review    ┌──────────────────┐    decision (HMAC-signed)   ┌──────────────┐
│  OpenCode    │ ─────────────────────▶ │   .gate/ bus      │ ◀────────────────────────── │ Agent Manager│
│  (architect) │   writes request,      │ requests/         │    app signs + writes,      │ Review Queue │
│              │   BLOCKS on 2s poll     │ decisions/        │    archives + audits        │ (human)      │
└──────────────┘ ◀───────────────────── │ archive/ audit    │ ──────────────────────────▶ └──────────────┘
       returns { status, notes }        └──────────────────┘
```

**How it works**

1. The orchestrator/design agent calls the blocking `submit_for_review` MCP tool (hosted by `gate-tool/gate-mcp-server.js`, spawned by the **OpenCode runtime**, not Electron). It writes a request to `<configDir>/.gate/requests/<id>.json` and **blocks** (polling every 2 s) until a signed decision appears.
2. The human reviews in the Agent Manager's **Review Queue** panel and clicks Approve or Reject-with-notes.
3. The app **HMAC-SHA256-signs** the decision using a secret at `<userData>/gate-secret.key` — deliberately stored **outside** `configDir` so the agent can't read it — then writes it atomically and archives + audits it.
4. The tool **verifies** the signature and returns `{ status, notes }`. The agent proceeds only on a valid `approved`.

**Trust & safety properties**

- **The app owns the secret.** It creates `gate-secret.key`; the tool only ever reads it. The tool never signs.
- **Fail-closed everywhere.** Unsigned, forged, missing-secret, timeout, or app-closed → `rejected`.
- **No lost approvals.** A decision is resolved from `decisions/<id>.json` or, once archived, from `archive/<id>.json`'s `.decision` (`readDecisionOrArchive`). `archiveReview` writes the archive atomically before unlinking the live decision.
- **Dev/packaged path coupling handled.** The **Setup Gate** button embeds the real `app.getPath('userData')` into the MCP entry as `--userDataDir`; absent that, the tool probes both the package-name and productName userData dirs (first one with `gate-secret.key` wins). Only the path — never the secret bytes — is written to config.
- **Additive & isolated.** `.gate/` (`requests/`, `decisions/`, `archive/`, `audit.jsonl`) is a new sibling dir under `configDir`; existing read/write/agent/skill flows are untouched.

**`submit_for_review` tool input**

| Field | Type | Notes |
|---|---|---|
| `stage` | enum `['design']` | Only the design stage is supported today |
| `agent` | string | ID of the design agent under review |
| `title` | string | Label shown in the queue |
| `artifacts` | `{ kind, path }[]` | `kind` ∈ `architecture \| figma-spec \| handoff \| other`; `path` relative to `configDir` |
| `checklist` | `'mtf'` \| `null` | Rule-based checklist to auto-run |
| `expiresInSeconds` | number | Block timeout before failing closed (default `86400` = 24 h) |

A standalone **Bash fallback** (`gate-tool/gate-submit.js`) implements the same submit+poll+verify logic for environments without MCP. Register the MCP server with one click via the app's **Setup Gate** button.

> Full details: [`docs/specs/gated-review-queue.md`](docs/specs/gated-review-queue.md) and [`gate-tool/README.md`](gate-tool/README.md).

---

## Obsidian project memory

The repo ships an Obsidian vault at **`obsidian-project-memory/`** that serves as a persistent, queryable **project memory** for AI agents working on this codebase. It runs the **Claude Code MCP** community plugin (by [iansinnott](https://github.com/iansinnott)), exposing the vault's notes to Claude Code (and other MCP clients) over an SSE endpoint.

**Set it up:**

1. Open `obsidian-project-memory/` as a vault in Obsidian and enable the **Claude Code MCP** plugin (the vault already lists it in `community-plugins.json`).
2. The plugin exposes an MCP server, by default at `http://localhost:22360/sse`.
3. Register it with Claude Code using the **SSE** transport:

   ```bash
   claude mcp add Obsidian http://localhost:22360/sse --transport sse
   ```

   > Use `--transport sse` — an `/sse` endpoint speaks the SSE protocol, not streamable HTTP. Registering it as `http` produces a 406 / failed connection.

4. Restart Claude Code (or run `/mcp`) and the `mcp__Obsidian__*` tools (`view`, `create`, `str_replace`, `insert`, `get_workspace_files`, …) become available for reading and writing project memory.

Agents can then record decisions, design rationale, and ongoing context as notes — and recall them in future sessions — keeping institutional knowledge in version-friendly Markdown rather than scattered across chat history.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 + |
| npm | 9 + |
| [Ollama](https://ollama.com) | Any (optional — for local model management) |
| [Obsidian](https://obsidian.md) | Any (optional — for project memory) |

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. (optional) Configure the Figma MCP server
cp .env.example .env   # then set FIGMA_API_KEY

# 3. Start in development mode (Vite dev server + Electron, hot reload)
npm run electron:dev
```

The app opens pointing at your existing OpenCode config directory (`~/.config/opencode` by default). Use the folder picker in the title bar to point it at a different directory.

> The Vite dev server runs on **port 2149** (`vite.config.js`, `strictPort: true`). The Electron dev flow waits on `http://localhost:2149` before launching.

---

## Configuration & data locations

| What | Where |
|---|---|
| OpenCode config (read/write) | `<configDir>/opencode.jsonc` |
| Agent definitions | `<configDir>/agents/*.agent.md` |
| Skills | `<configDir>/skill/` or `<configDir>/skills/` |
| Approval-gate bus | `<configDir>/.gate/` |
| Chosen config dir (persisted) | `<userData>/prefs.json` |
| Gate signing secret | `<userData>/gate-secret.key` (outside `configDir` by design) |

The default `configDir`:

```
~/.config/opencode               # Linux / macOS
%USERPROFILE%\.config\opencode    # Windows
```

`<userData>` is Electron's per-user app data dir — `%APPDATA%\opencode-agent-gui` (dev) / `%APPDATA%\OpenCode Agent Manager` (packaged) on Windows, with platform equivalents on macOS/Linux. You can change the config directory any time via the **Browse** button in the title bar; the choice persists across restarts.

### `opencode.jsonc` shape

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-6",        // global default
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
      "variant": "high",                          // reasoning effort (Anthropic)
      "options": { "temperature": 0.3 },
      "tools": { "bash": "allow" },
      "permission": { "task": "allow", "bash": { "git *": "allow" } },
      "color": "#26a540"                          // UI-only accent (ignored by OpenCode)
    }
  }
}
```

Any per-agent key not explicitly handled is preserved verbatim in an `_extra` bag and round-tripped on save.

---

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server only (browser, no Electron APIs) — port 2149 |
| `npm run electron:dev` | Full Electron + Vite dev mode with hot reload |
| `npm run build` | Production Vite build to `dist/` |
| `npm run electron:build` | Production build + package with electron-builder → `dist-electron/` |
| `npm run preview` | Preview the Vite production build in a browser |
| `npm run test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

---

## Building for distribution

```bash
npm run electron:build
```

Packaged installers are written to `dist-electron/`. The build config lives in the `"build"` key of `package.json` — edit `appId`, `productName`, and platform targets there. The packaged `files` glob includes `dist/`, `electron/`, and `gate-tool/` so the gate's runtime scripts ship with the app.

---

## Project structure

```
opencode-agent-manager/
├── electron/
│   ├── main.js                 # Main process — IPC handlers, config I/O, Ollama client, gate
│   ├── preload.js              # Context bridge (exposes electronAPI to the renderer)
│   └── gate/                   # Enforced design→build gate (app side)
│       ├── utils.js            # atomicWrite (temp → rename)
│       ├── security.js         # HMAC sign/verify + confinePath path-confinement
│       ├── schema.js           # request/decision validators
│       └── bus.js              # .gate/ filesystem ops (requests/decisions/archive/audit)
├── gate-tool/                  # Runtime-side gate (spawned by OpenCode, not Electron)
│   ├── gate-mcp-server.js      # Blocking submit_for_review MCP server (preferred host)
│   ├── gate-submit.js          # Bash fallback CLI (same submit+poll+verify logic)
│   └── README.md
├── src/
│   ├── App.jsx                 # Root: state, polling loops, save/browse handlers
│   ├── main.jsx                # React entry point
│   ├── components/
│   │   ├── AgentCard.jsx       # Single agent card (model dropdown + settings)
│   │   ├── AgentPanel.jsx      # Bento grid of agent cards
│   │   ├── AgentSettingsPanel.jsx  # Full-page agent editor
│   │   ├── ModelCard.jsx       # Ollama model card
│   │   ├── ModelDropdown.jsx   # Provider-grouped model selector
│   │   ├── OllamaPanel.jsx     # Local model browser
│   │   ├── ReviewQueuePanel.jsx# Approval gate UI (artifacts + checklist + decide)
│   │   ├── RightSidebar.jsx    # Contextual detail panel
│   │   ├── Sidebar.jsx         # Left navigation (Agents/Models/Review Queue/System)
│   │   ├── StatusBar.jsx       # Ollama status + Save button
│   │   └── TitleBar.jsx        # Frameless custom title bar + folder picker
│   ├── data/
│   │   ├── agentDefaults.js        # Single source of editable-field defaults
│   │   └── reasoningCapabilities.js# Model→reasoning capability registry
│   ├── gate/
│   │   └── checklist.js        # Renderer-only runMtfChecklist() (no IPC)
│   └── styles/                 # SCSS 7-1 architecture; entry: main.scss
├── obsidian-project-memory/    # Obsidian vault for AI project memory (MCP over SSE)
├── docs/
│   └── specs/                  # Feature specs (gated-review-queue, reasoning-effort)
├── index.html
├── vite.config.js
└── package.json
```

---

## IPC API (renderer ↔ main)

The renderer talks to the main process exclusively through `window.electronAPI` (exposed via the preload context bridge). No Node APIs are used directly in the renderer.

| Method | Main handler | Description |
|---|---|---|
| `getConfigPath()` | `config:get-path` | Active config directory path |
| `setConfigPath(dir)` | `config:set-path` | Persist a new config dir to `prefs.json` |
| `selectFolder()` | `config:select-folder` | Native folder-picker dialog |
| `readConfig()` | `config:read` | Parse `opencode.jsonc` + all `agents/*.agent.md` |
| `writeConfig({ agents, defaultModel, ollamaProviderModels })` | `config:write` | Atomic write; preserves `$schema` + unknown fields |
| `createAgentFile(agentId, agentData)` | `agent:create-file` | Write `agents/<id>.agent.md` with YAML frontmatter |
| `readAgentFile(agentId)` | `agent:read-file` | Read raw `agents/<id>.agent.md` |
| `writeAgentFile(agentId, content)` | `agent:write-file` | Atomic write of the raw `.agent.md` |
| `listSkills()` | `skills:list` | Scan `skill/` and `skills/` for skills |
| `listReviews()` | `gate:list` | Pending reviews (queue items) |
| `listArchivedReviews()` | `gate:list-archive` | Decided reviews (History tab) |
| `readReview(id)` | `gate:read` | One review's request + confined, size-capped artifacts |
| `decideReview({ id, status, notes })` | `gate:decide` | HMAC-sign, write, archive + audit a decision |
| `setupGateMcpEntry()` | `gate:setup-mcp-entry` | Register the gate MCP server in `opencode.jsonc` |
| `onReviewUpdate(cb)` | push `gate:updated` | Subscribe to live queue changes |
| `listOllamaModels()` | `ollama:list-models` | `GET /api/tags` |
| `getOllamaModelDetail(name)` | `ollama:get-model-detail` | `POST /api/show` (context length, capabilities) |
| `getSystemInfo()` | `system:get-info` | CPU, RAM, VRAM snapshot |
| `minimizeWindow()` / `maximizeWindow()` / `closeWindow()` | `window:*` | Window controls |

---

## Tech stack

- [Electron](https://www.electronjs.org/) 33 — desktop shell
- [React](https://react.dev/) 18 — UI
- [Vite](https://vitejs.dev/) 5 + `@vitejs/plugin-react` — dev server & bundler
- [Sass](https://sass-lang.com/) — SCSS 7-1 architecture (entry `src/styles/main.scss`)
- [electron-builder](https://www.electron.build/) 25 — packaging
- [systeminformation](https://systeminformation.io/) — hardware stats
- [strip-json-comments](https://github.com/sindresorhus/strip-json-comments) — JSONC parsing
- [Vitest](https://vitest.dev/) — unit tests
- [prismjs](https://prismjs.com/) + [react-simple-code-editor](https://github.com/react-simple-code-editor/react-simple-code-editor) — in-app code/markdown editing

---

## Testing

```bash
npm run test        # run once
npm run test:watch  # watch mode
```

The suite (Vitest) covers the security-critical and pure-logic pieces of the gate and config layers:

- `electron/gate/__tests__/` — `bus`, `schema`, and `security` (HMAC sign/verify, path confinement)
- `gate-tool/__tests__/` — the blocking `submit_for_review` MCP server
- `src/gate/__tests__/` — the renderer MTF checklist
- `src/data/*.test.js` — agent defaults and the reasoning-capability registry

---

## License

MIT
