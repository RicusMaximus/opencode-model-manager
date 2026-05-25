# OpenCode Model Manager

A desktop GUI for configuring [OpenCode](https://opencode.ai) — assign LLM models to agents, browse locally installed Ollama models, and monitor system resources, all without touching JSON by hand.

Built with **Electron 33 + React 18 + Vite 5**.

---

## Features

| Panel | What it does |
|---|---|
| **Agents** | View every agent in your OpenCode pipeline and assign a specific model (Anthropic, Ollama, or any provider) to each one |
| **Models** | Browse locally installed Ollama models with search; live connection status |
| **System** | Real-time CPU, RAM, and VRAM usage pulled via `systeminformation` |

**Other highlights**

- Reads and writes `opencode.jsonc` directly — no intermediate format
- Parses `agents/*.agent.md` frontmatter to display agent names, descriptions, responsibilities, required MCP servers, and env vars
- Preserves unknown config fields (e.g. `permission`) on every save
- Atomic writes (temp file → rename) so a crash never corrupts your config
- Live Ollama polling every 10 s; system stats every 5 s
- Frameless custom title bar with minimize / maximize / close controls
- Unsaved-changes indicator with a single **Save Changes** button

---

## Agents

The following OpenCode agents are supported out of the box:

| Agent | Default colour |
|---|---|
| `agent-orchestrator` | Blue |
| `builder` | Green |
| `architect` | Amber |
| `validator` | Red |
| `scribe` | Dark grey |
| `ux_ui_designer` | Blue |

Display names and descriptions are read from each agent's `.agent.md` frontmatter when available, with hardcoded fallbacks if the file is missing.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 + |
| npm | 9 + |
| [Ollama](https://ollama.com) | Any (optional — for local model management) |

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start in development mode (Vite dev server + Electron)
npm run electron:dev
```

The app will open pointing at your existing OpenCode config directory (`~/.config/opencode` by default). Use the folder picker in the title bar to point it at a different directory.

---

## Config location

The app reads and writes `<configDir>/opencode.jsonc`.

The default config directory is:

```
~/.config/opencode          # Linux / macOS
%USERPROFILE%\.config\opencode   # Windows
```

Your chosen directory is saved to Electron's `userData` folder as `prefs.json` and persists across restarts. You can change it at any time using the **Browse** button in the title bar.

---

## Project structure

```
opencode-model-gui/
├── electron/
│   ├── main.js          # Electron main process — IPC handlers, config I/O, Ollama client
│   └── preload.js       # Context bridge (exposes electronAPI to the renderer)
├── src/
│   ├── App.jsx           # Root component — state, polling, save logic
│   ├── components/
│   │   ├── AgentCard.jsx      # Individual agent card with model dropdown
│   │   ├── AgentPanel.jsx     # Agent bento grid
│   │   ├── ModelCard.jsx      # Ollama model card
│   │   ├── ModelDropdown.jsx  # Model selector (Anthropic presets + Ollama models)
│   │   ├── OllamaPanel.jsx    # Local model browser
│   │   ├── RightSidebar.jsx   # Contextual detail sidebar
│   │   ├── Sidebar.jsx        # Left navigation
│   │   ├── StatusBar.jsx      # Ollama status + Save button
│   │   └── TitleBar.jsx       # Custom frameless title bar
│   ├── styles/
│   │   ├── app.css
│   │   ├── global.css
│   │   └── variables.css
│   └── main.jsx          # React entry point
├── index.html
├── vite.config.js
└── package.json
```

---

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server only (browser, no Electron) |
| `npm run electron:dev` | Full Electron + Vite dev mode with hot reload |
| `npm run build` | Production Vite build to `dist/` |
| `npm run electron:build` | Production build + package with electron-builder → `dist-electron/` |
| `npm run preview` | Preview the Vite production build in a browser |

---

## Building for distribution

```bash
npm run electron:build
```

Packaged installers are written to `dist-electron/`. The build config lives in the `"build"` key of `package.json` — edit `appId`, `productName`, and platform targets there.

---

## IPC API (renderer ↔ main)

The renderer communicates with the main process through `window.electronAPI` (exposed via the preload context bridge):

| Method | Description |
|---|---|
| `getConfigPath()` | Returns the active config directory path |
| `setConfigPath(dir)` | Persists a new config directory to `prefs.json` |
| `selectFolder()` | Opens a native folder-picker dialog |
| `readConfig()` | Parses `opencode.jsonc` + all `agents/*.agent.md` files |
| `writeConfig({ agents, defaultModel, ollamaProviderModels })` | Atomically writes `opencode.jsonc` |
| `listOllamaModels()` | `GET /api/tags` from the local Ollama daemon |
| `getOllamaModelDetail(name)` | `POST /api/show` — returns context length etc. |
| `getSystemInfo()` | CPU, RAM, VRAM snapshot via `systeminformation` |
| `minimizeWindow()` | Minimize the app window |
| `maximizeWindow()` | Toggle maximize / restore |
| `closeWindow()` | Close the app window |

---

## Tech stack

- [Electron](https://www.electronjs.org/) 33
- [React](https://react.dev/) 18
- [Vite](https://vitejs.dev/) 5 + `@vitejs/plugin-react`
- [electron-builder](https://www.electron.build/) 25
- [systeminformation](https://systeminformation.io/) — hardware stats
- [strip-json-comments](https://github.com/sindresorhus/strip-json-comments) — JSONC parsing

---

## License

MIT
