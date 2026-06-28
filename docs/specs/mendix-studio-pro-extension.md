# SDD Design Spec — Mendix Studio Pro Extension

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-28 |
| **Target component** | A new Mendix Studio Pro extension + the OpenCode Agent Manager desktop app |
| **Primary surfaces** | new `mendix-extension/` (Studio Pro extension project), `electron/main.js` (argv handling + single-instance, shared with the CLI spec) |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope — design hand-off for an agent orchestrator |
| **Depends on** | `project-config-cli-launcher.md` (shared `--project` argv + single-instance contract), `project-config-file-picker.md` (active-workspace model) |

---

## 1. Summary

Add a **Mendix Studio Pro extension** that, from inside an open Mendix app, **launches the OpenCode Agent Manager desktop app pointed at the Mendix project's root folder**, so a developer can manage that project's `opencode.jsonc` without leaving Studio Pro. Mendix developers frequently work across multiple client apps; wiring the manager directly into Studio Pro means the right project's model config, MCP servers, and authentication are one click away and always scoped to the app currently open.

Per the product decision, the integration is **"launch the desktop app"** (loose coupling): the extension reads the current Mendix project root via the Studio Pro extensibility API and starts the installed/packaged Electron app as a child process, passing the project path through the **same `--project` argv contract** the CLI spec defines. The workspace semantics are identical to the other two specs — **full project tree** (project root as `configDir`) and **project-only** (global config ignored while the project is active).

---

## 2. Problem statement & motivation

- **Mendix projects are a natural per-client boundary.** Each Mendix app is its own repo/folder; dropping an `opencode.jsonc` at its root gives that client its own model assignments, MCP servers, and auth — exactly the isolation the global config can't provide.
- **Studio Pro is where the Mendix developer already is.** Asking them to leave the IDE, find the app, and Browse to the project folder is friction. A toolbar/menu action that opens the manager already scoped to the current app removes it.
- **The current app open in Studio Pro is the unambiguous target.** The extensibility API exposes the active app's root directory, so the extension can hand the manager the correct project without the user typing or navigating a path — eliminating wrong-client mistakes.
- **Reuse, not rebuild.** Launching the existing desktop app (vs. re-implementing the UI inside Studio Pro) reuses the entire manager — agents, models, gate, reasoning effort — with minimal new surface.

---

## 3. Goals / Non-goals

### Goals
1. A Studio Pro extension adds a visible action (menu item and/or toolbar/ribbon button), e.g. **"Manage OpenCode config,"** available while an app is open.
2. Activating it resolves the **current Mendix app's root folder** via the extensibility API and **launches the installed desktop app** pointed at that root (full project tree; project-only).
3. If the project root has no `opencode.{json,jsonc}`, the manager creates `opencode.jsonc` from the standard template (reusing the file-picker spec's create flow).
4. If the manager is **already running**, the action **re-points it** to the current Mendix project and focuses it (single-instance, shared with the CLI spec) — no duplicate windows.
5. The extension **locates the installed app** robustly (same discovery logic as the CLI) and gives a clear, actionable error if it isn't installed.
6. The extension is packaged/installable as a normal Studio Pro extension and works on **Windows** (Studio Pro's platform).

### Non-goals
- Embedding the manager's UI inside Studio Pro (decided against — loose coupling via child-process launch).
- Reading/writing `opencode.jsonc` from inside the extension itself (the desktop app owns all config I/O — single source of truth).
- Generating or editing Mendix model artifacts (microflows, pages, domain model). The extension only *launches the manager*; it does not touch the `.mpr`/Mendix model.
- Supporting Studio Pro versions older than the chosen minimum extensibility-API baseline (confirmed in task 1).
- macOS/Linux Studio Pro (Studio Pro is Windows-only).

---

## 4. Background & feasibility — *can a Studio Pro extension launch an external app with the project path?*

Grounding facts to confirm in task 1 (this is the genuinely new, external-to-this-repo surface):

- **Extension model.** Studio Pro supports extensions via the **C#/.NET Extensibility API** (a class library loaded by Studio Pro, the mature path for adding menu/toolbar commands and reaching IDE services) and a newer **Web Extensibility** (TypeScript/React UI in a webview). For **"launch an external process with the project path,"** the **C#/.NET** extension is the natural fit — it can register a menu/dockable command and use `System.Diagnostics.Process.Start`, and it has direct access to the current app's root directory. **Recommended host: C#/.NET extension.** (Confirm the exact API surface and the supported Studio Pro version range.)
- **Project root discovery.** The extensibility API exposes the currently open app and its on-disk directory (the folder containing the `.mpr`). That directory **is** the project root the manager should treat as `configDir`. Confirm the exact API call/property used to obtain it.
- **Launching external processes.** A .NET extension runs in-process with Studio Pro and can start a detached child process. This is the same "spawn the packaged app with `--project <root>`" action the CLI performs — so the app side needs **no Mendix-specific code**; it just receives the standard argv contract.
- **App side already (will be) ready.** The CLI spec adds `electron/cli-args.js`, the single-instance lock, and the `second-instance` re-point+focus handler. The Mendix extension reuses all of it verbatim — its only job is to discover the root and spawn with the right args.

**Feasibility verdict:** Feasible and low-risk. A C#/.NET Studio Pro extension can read the project root and `Process.Start` the installed manager with `--project <root>`. No new app-side mechanism is required beyond what the CLI spec already introduces; the new work is the extension project itself plus app-discovery on Windows.

---

## 5. Proposed design

### 5.1 Architecture

```
 Studio Pro (Windows)                                   OpenCode Agent Manager (Electron)
 ┌───────────────────────────────────────┐             ┌─────────────────────────────────────┐
 │ Mendix extension (C#/.NET)            │  Process    │ singleInstanceLock?                 │
 │  ┌─────────────────────────────────┐  │  .Start     │   yes → createWindow(--project)     │
 │  │ "Manage OpenCode config" cmd    │──┼───────────▶ │   no  → second-instance:            │
 │  │  1. get current app root dir    │  │ --project   │         re-point to <root> + focus  │
 │  │  2. locate installed manager    │  │ <root>      │                                     │
 │  │  3. Process.Start(detached)     │  │             │ workspace = <root> (project-only,   │
 │  └─────────────────────────────────┘  │             │ full tree); create opencode.jsonc   │
 └───────────────────────────────────────┘             │ if absent                           │
                                                        └─────────────────────────────────────┘
```

### 5.2 The extension command

- Registers a command in Studio Pro's menu and/or toolbar/ribbon, labeled **"Manage OpenCode config"** (icon TBD), enabled only when an app is open.
- On activation:
  1. **Resolve project root** from the extensibility API (the open app's on-disk directory). If none is open → show a Studio Pro notification ("Open a Mendix app first") and stop.
  2. **Locate the installed manager** (§5.3).
  3. **Launch** it detached with `--project "<root>"` (and the create flag policy of §5.4). Catch `Process.Start` failures and surface a friendly error with guidance.
  4. Optionally write a one-line status to the Studio Pro log/console for traceability.

The extension keeps **no state** and performs **no config I/O** — it is a launcher only.

### 5.3 Locating the installed manager (Windows)

Same resolution strategy as the CLI spec (§5.3), Windows-focused, first hit wins, overridable by env `OMM_APP_PATH`:

1. `OMM_APP_PATH` (explicit exe path).
2. `%LOCALAPPDATA%\Programs\OpenCode Agent Manager\OpenCode Agent Manager.exe` (electron-builder NSIS per-user default).
3. `%ProgramFiles%\OpenCode Agent Manager\OpenCode Agent Manager.exe` (system install).
4. (Optional) the CLI shim on PATH (`opencode-agent-manager`) as an indirection, if the CLI spec ships first.
5. Unresolved → error dialog: "OpenCode Agent Manager isn't installed (or set OMM_APP_PATH)." with a link/hint.

Centralize this in one helper so the CLI and the extension can't drift (they may literally share a small lookup table documented in both specs).

### 5.4 Create-if-absent policy

Mirrors the CLI's terminal-friendly default: launch the app with `--create` so a Mendix project without a config gets `opencode.jsonc` scaffolded (file-picker spec §5.6 template) and opened in one step. The app still **never clobbers** an existing config. (Confirm whether silent-create or in-app prompt is preferred — open question, consistent with the CLI's.)

### 5.5 Single-instance behavior

No new app code: the extension's `Process.Start` hits the same single-instance path the CLI uses. First launch opens the manager on the Mendix root; if the manager is already open (e.g. on another client), Electron's `second-instance` re-points it to the Mendix project and focuses it. The Mendix root is added to the manager's **recent workspaces** MRU, so it appears in the title-bar switcher.

### 5.6 Packaging & install

- The extension is built as a standard Studio Pro extension package (per the chosen extensibility model) and installed into Studio Pro's extensions location (mechanism confirmed in task 1 — per-app `extensions/` folder vs a user-level install).
- Distribution options (decide in task 1): a downloadable extension artifact in this repo's releases, and/or a documented manual install. Marketplace publication is a possible follow-up, not in scope.
- The extension declares a minimum supported Studio Pro version.

---

## 6. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | No Mendix app open | Command disabled or shows "open an app first"; nothing launched. |
| 2 | Manager not installed | Friendly error with install guidance / `OMM_APP_PATH` hint; no crash of Studio Pro. |
| 3 | Manager already running on another client | `second-instance` re-points to the Mendix root and focuses; no duplicate window. |
| 4 | Mendix root has no opencode config | App scaffolds `opencode.jsonc` (per `--create`) and opens it. |
| 5 | Project path contains spaces | Passed as a single quoted `--project` argument; resolved verbatim. |
| 6 | `Process.Start` fails (permissions/AV) | Caught; error surfaced in Studio Pro; logged. |
| 7 | Studio Pro closed after launch | Manager keeps running (detached child process). |
| 8 | Unsupported Studio Pro version | Extension won't load / declares incompatibility cleanly. |
| 9 | Project on a network/UNC path | Passed verbatim; the app resolves it like any other root. |

---

## 7. Security & isolation notes

- **No secrets handled by the extension.** It resolves a path and starts a process; it never reads config or MCP credentials. The manager (and OpenCode) own secret handling.
- **Project-only isolation carries over.** Once the manager opens on the Mendix root, no global/other-client config is read or written (file-picker spec guarantee).
- **The extension runs in-process with Studio Pro** (C#/.NET): keep it minimal and dependency-light to avoid destabilizing the IDE; wrap all external calls in try/catch and never throw into Studio Pro's host.
- **Launch target is validated app-side.** The manager validates `--project` (exists, is a directory) before re-pointing, so a bad path from the extension degrades gracefully rather than corrupting state.
- **No remote content.** The extension launches a local binary only; it performs no network calls.

---

## 8. Testing strategy

- **Unit (extension):** project-root resolution returns the open app's directory; "no app open" path; app-locator resolution order incl. `OMM_APP_PATH`; argument quoting for paths with spaces.
- **Unit (app):** reuse the CLI spec's `cli-args.js` tests for `--project`/`--create` (shared contract).
- **Integration:** with the manager installed, invoking the command launches it scoped to a test Mendix project; invoking again while it's open on another root re-points + focuses; MRU updated.
- **Integration — create-if-absent:** command on a Mendix project lacking a config scaffolds `opencode.jsonc`; existing config never clobbered.
- **Manual / acceptance:** in a real Studio Pro app, click the command, confirm the manager opens on that app's root, edit a model assignment, save, and verify the Mendix project's `opencode.jsonc` changed; repeat from a second Mendix app and confirm the same window switches.

---

## 9. Rollout & task breakdown (for the orchestrator)

1. **architect / research (blocking):** confirm the Studio Pro extensibility model to use (C#/.NET recommended) and minimum version; the exact API to get the current app's root directory; how extensions are packaged/installed; and the Windows app-discovery paths (shared with the CLI spec). Output: confirmed API calls + packaging method.
2. **builder — app side (likely already done by the CLI spec):** ensure `--project`/`--create`, single-instance lock, and `second-instance` re-point+focus exist. If the CLI spec hasn't landed, this is a dependency.
3. **builder — extension:** the C#/.NET extension project — register the command, resolve the project root, app-locator helper, detached `Process.Start` with `--project`, error handling + Studio Pro notifications.
4. **builder — packaging:** build the extension artifact and document install into Studio Pro.
5. **validator:** §8 matrix, emphasizing "no app open," "manager not installed," and re-point-vs-duplicate.
6. **scribe:** a README section (or `mendix-extension/README.md`) covering install, usage, supported Studio Pro versions, and `OMM_APP_PATH`.

Recommended sequencing: **1 → 2 → 3 → 4 → (5 ∥ 6).** Task 3 depends on the app-side argv/single-instance contract from the CLI spec.

---

## 10. Open questions

1. **Extensibility model.** C#/.NET extension (recommended for launching a process) vs Web Extensibility — confirm against the target Studio Pro version and the API for reading the project root.
2. **Project-root API.** Exact extensibility call/property that yields the open app's on-disk root directory (the `.mpr` folder).
3. **Install/distribution.** Where the extension installs (per-app `extensions/` vs user-level), how it's distributed (repo release vs Marketplace), and the minimum Studio Pro version.
4. **Create policy.** Silent `--create` (recommended, one-click) vs let the app prompt — keep consistent with the CLI spec's resolution.
5. **App discovery vs CLI indirection.** Should the extension launch the GUI binary directly, or call the `opencode-agent-manager` CLI shim if present (single discovery path, but adds a dependency on the CLI spec shipping)?
6. **Command placement.** Menu item, toolbar/ribbon button, or both — and the label/icon.
