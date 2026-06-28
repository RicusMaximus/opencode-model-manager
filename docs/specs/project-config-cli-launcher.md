# SDD Design Spec — `opencode-agent-manager` CLI Launcher

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-28 |
| **Target component** | OpenCode Agent Manager (Electron + React) + a new CLI entry on `PATH` |
| **Primary surfaces** | new `bin/` CLI, `package.json` (`bin` field + build), `electron/main.js` (argv handling, single-instance lock), `electron/cli-args.js` (new) |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope — design hand-off for an agent orchestrator |
| **Depends on** | `project-config-file-picker.md` (the "active project workspace" model + create-if-absent) |

---

## 1. Summary

Add a `opencode-agent-manager` command to the user's `PATH` so that, from inside any project directory, running:

```
opencode-agent-manager run
```

launches the **packaged production app** pointed at the **current working directory**, reading or creating that project's `opencode.{json,jsonc}`. This is the terminal-native counterpart to the title-bar Browse flow: instead of opening the app and hunting for the project folder, the user is already *in* the project and wants the manager scoped to it in one command.

Per the product decision, the CLI is a **GUI launcher on PATH** (not a headless tool): `run` opens the existing desktop GUI with the cwd as the active workspace. The workspace semantics are exactly those defined in the file-picker spec — **full project tree** (project root used as `configDir`) and **project-only** (global config ignored while the project is active).

---

## 2. Problem statement & motivation

- **Context-switching friction.** A consultant in `~/clients/acme/repo` who wants to tweak that client's model assignments must currently open the app, click Browse, and navigate back to the same folder they're already standing in. `run` collapses that to one command in the directory they already have open.
- **Scriptability & muscle memory.** Developers live in the terminal; a `PATH` command fits existing workflows (akin to `code .`, `opencode`, etc.) and can be invoked from project scripts, task runners, or shell aliases.
- **Correct project, every time.** Seeding the workspace from `cwd` removes the chance of opening the app against the wrong client's folder — the directory you ran the command in *is* the target.
- **Bootstrapping new projects.** Running `run` in a repo that has no config yet should be able to scaffold one, so a fresh client repo goes from nothing to a managed config without manual file creation.

---

## 3. Goals / Non-goals

### Goals
1. A `opencode-agent-manager` command is installable onto `PATH` cross-platform (Windows-first, since Mendix targets Windows).
2. `opencode-agent-manager run` launches the **packaged** app with the **cwd** as the active workspace (project root → `configDir`).
3. If the cwd has no `opencode.{json,jsonc}`, `run` creates `opencode.jsonc` from the standard template (the file-picker spec's §5.6 template), then opens it. (CLI may create implicitly; see §5.4 / open questions.)
4. An explicit target is supported: `opencode-agent-manager run [path]` opens `[path]` instead of cwd.
5. **Single instance:** invoking `run` again (same or different project) re-points the already-running window and focuses it, rather than spawning a second app.
6. The command surfaces clear terminal output (what root it opened, whether it created a file) and sensible exit codes for scripting.
7. `--help` / `--version` work without launching the GUI.

### Non-goals
- A headless config editor (no `get`/`set`/`init` subcommands in this spec — `run` only launches the GUI). A headless mode is a documented future follow-up (§10).
- Global/project merging (project-only, per the file-picker spec).
- Installing or managing OpenCode itself, Node, or Ollama.
- Auto-updating the packaged app from the CLI.

---

## 4. Background — current implementation

- **No CLI today.** `package.json` has no `bin` field; the app is launched only via `npm run electron:dev` (dev) or the electron-builder package (`electron:build` → `dist-electron/`).
- **`createWindow()` (`electron/main.js`)** loads `dist/index.html` in production and does **not** read `process.argv` — there is no way to tell the app which project to open at launch.
- **No single-instance lock.** The app never calls `app.requestSingleInstanceLock()`, so a second launch would spawn a second window/process. The CLI requires single-instance behavior to "re-point and focus."
- **Workspace re-pointing already exists.** `config:set-path` (see file-picker spec §4) re-points config + gate at a new root. The CLI's job is only to *deliver a target root* to the app at startup (or to a running instance).
- **Packaging (`package.json` `build`)** — `appId: com.opencode.agent-manager`, `productName: "OpenCode Agent Manager"`, output `dist-electron/`. The CLI must locate this installed binary at runtime (§5.3).

---

## 5. Proposed design

### 5.1 Command shape

```
opencode-agent-manager run [path] [--new] [--no-create]
opencode-agent-manager --help
opencode-agent-manager --version
```

- `run` — launch the GUI with the active workspace = `path` if given, else `process.cwd()`.
- `[path]` — optional explicit project root (relative paths resolved against cwd).
- `--no-create` — do not scaffold a config if absent; just open the workspace (matches GUI's opt-in create).
- `--new` — force-create `opencode.jsonc` even if the folder looks non-empty (still never clobbers an existing config).
- Unknown subcommand → print help, exit non-zero.

> `run` is the only subcommand in scope. The verb is kept explicit (rather than a bare `opencode-agent-manager`) to leave room for future headless subcommands without a breaking change.

### 5.2 Two-process design: thin CLI → packaged app

The `bin` script is a **thin Node launcher**, distinct from the Electron app. It:

1. Parses argv (`run`, optional path, flags). Handles `--help`/`--version` locally (reads version from its own `package.json`).
2. Resolves the **target root**: `path.resolve(cwd, pathArg || '.')`. Verifies it exists and is a directory.
3. Locates the **installed packaged app** binary (§5.3).
4. Spawns it **detached** with the target passed via a documented argv contract (§5.4), then exits 0 — the GUI keeps running independently of the terminal.
5. On failure (app not found, bad path) → prints a clear error and exits non-zero.

The CLI never reads/writes `opencode.jsonc` itself — that keeps a single source of truth (the app's config core) and avoids divergent JSONC handling.

### 5.3 Locating the installed app

The launcher resolves the GUI binary in this order (first hit wins), all overridable by env `OMM_APP_PATH`:

1. `OMM_APP_PATH` (explicit absolute path to the executable).
2. Platform default install locations for `productName` "OpenCode Agent Manager":
   - **Windows:** `%LOCALAPPDATA%\Programs\OpenCode Agent Manager\OpenCode Agent Manager.exe` (electron-builder NSIS per-user default), then `%ProgramFiles%\...`.
   - **macOS:** `/Applications/OpenCode Agent Manager.app` (`open -a`), then `~/Applications`.
   - **Linux:** the installed AppImage/`.desktop` exec, or `opencode-agent-manager-gui` on PATH.
3. If unresolved → error with guidance ("install the desktop app, or set OMM_APP_PATH").

> Decouples the CLI from a hard-coded path and tolerates per-user vs system installs. The exact electron-builder target locations are confirmed during task 1.

### 5.4 Argv contract (CLI → app) & single-instance forwarding

The app gains a tiny `electron/cli-args.js` parser and single-instance handling in `main.js`:

- **Argv contract:** `--project <absPath>` plus optional `--create` / `--no-create`. (Positional argv is unreliable across electron-builder launch shims, so use an explicit named flag.)
- **First launch:** `app.requestSingleInstanceLock()`. If acquired, `createWindow()` reads `--project` from `process.argv`, sets it as the active workspace (calls the same internal path behind `config:set-path`), runs create-if-absent per the flag, and loads the UI already pointed at the project.
- **Second launch (lock not acquired):** the new process exits immediately; Electron fires `second-instance` in the **running** app with the new argv. The handler parses `--project`, re-points the active workspace, runs create-if-absent, and **focuses/raises** the existing window. This is what makes `run` from a different project "switch" rather than "duplicate."
- The target is also pushed onto the **recent workspaces** MRU (file-picker spec §5.5), so CLI-opened projects appear in the title-bar switcher.

```
 terminal: opencode-agent-manager run            spawn (detached)        Electron app
 ┌──────────────────────────┐  --project <cwd>  ┌───────────────────────────────────┐
 │ bin/opencode-agent-mgr   │ ────────────────▶ │ singleInstanceLock?               │
 │  resolve cwd + find app  │                   │   yes → createWindow(--project)   │
 └──────────────────────────┘                   │   no  → second-instance:          │
                                                │         re-point + focus existing │
                                                └───────────────────────────────────┘
```

### 5.5 Distribution / getting onto PATH

Primary mechanism: ship the CLI as an **npm package with a `bin` field**, installable via `npm i -g` (npm creates the PATH shim — `opencode-agent-manager.cmd`/`.ps1` on Windows, a symlink on POSIX). Two viable packaging routes (decide in task 1):

1. **Same repo, `bin` field** — add `"bin": { "opencode-agent-manager": "bin/cli.js" }` to `package.json`. `npm i -g .` (or a published package) puts it on PATH. Simplest; the CLI ships alongside the source.
2. **Bundled with the installer** — the electron-builder NSIS installer adds an install-dir shim to PATH and registers `OMM_APP_PATH`. Best "one installer does everything" UX, but more build work.

The spec recommends **(1)** for the first iteration (fast, cross-platform, no installer surgery), with **(2)** as a follow-up so the desktop installer alone provisions the command. Either way the CLI auto-discovers the GUI per §5.3.

### 5.6 Terminal output & exit codes

- Success: `Opening OpenCode Agent Manager → <root> (created opencode.jsonc)` and exit `0`.
- App not found: error + install hint, exit `3`.
- Bad/non-existent path: error, exit `2`.
- `--help`/`--version`: print, exit `0`, no GUI.

---

## 6. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | `run` in a folder with no config | Create `opencode.jsonc` (unless `--no-create`), then open. |
| 2 | `run` while the app is already open on another project | `second-instance` re-points to cwd and focuses; no duplicate window. |
| 3 | `run` with a relative `[path]` | Resolved against cwd; verified to exist before launch. |
| 4 | App not installed / `OMM_APP_PATH` wrong | Exit non-zero with install guidance; no orphaned process. |
| 5 | cwd path contains spaces / is UNC | Passed as a single quoted `--project` arg; resolved verbatim. |
| 6 | Terminal closed after launch | GUI continues (spawned detached). |
| 7 | `run` against the global config dir | Works — it's just another root; title bar shows it (badge may read "Global" if it equals the default). |
| 8 | Two rapid `run` invocations (race on the lock) | Lock serializes; the later argv wins via `second-instance`; window ends on the last requested project. |
| 9 | `--version` before app exists | Works (CLI reads its own version), never spawns the GUI. |

---

## 7. Security & isolation notes

- **No elevation, no secrets handled by the CLI.** The launcher only resolves a path and spawns the GUI; it never touches config contents or MCP credentials.
- **Project-only isolation carries over.** Once the GUI opens on the cwd, the file-picker spec's project-only guarantees apply — no global/other-client config is read or written.
- **Argv is treated as input.** The app validates `--project` (exists, is a directory) before re-pointing; a malformed value falls back to the current/Global workspace with a visible message rather than crashing.
- **Detached spawn** must not inherit the terminal's stdio in a way that blocks the shell; the CLI returns promptly.

---

## 8. Testing strategy

- **Unit — argv parsing (CLI):** `run`, `run <path>`, flags, unknown subcommand, `--help`/`--version`; relative-path resolution.
- **Unit — app locator:** `OMM_APP_PATH` override; per-platform default candidates; not-found error path.
- **Unit — argv parsing (app, `cli-args.js`):** `--project`/`--create`/`--no-create` extraction; missing/garbage values fall back safely.
- **Integration — single instance:** first launch opens project A; second `run` in project B fires `second-instance`, re-points to B, focuses, no second window; MRU contains both.
- **Integration — create-if-absent:** `run` in an empty temp dir scaffolds `opencode.jsonc`; `--no-create` does not; existing config never clobbered.
- **Manual / `/run`:** from a real client repo, `opencode-agent-manager run`, confirm the app opens scoped to that repo, edit a model, save, and verify the repo's config changed; then `run` from a second repo and confirm the same window switches.

---

## 9. Rollout & task breakdown (for the orchestrator)

1. **architect / research (blocking):** confirm electron-builder per-platform install paths for app discovery (§5.3); choose distribution route (§5.5, npm `bin` vs installer); confirm detached-spawn behavior + launch shim argv reliability on Windows. Output: confirmed locator table + packaging decision.
2. **builder — app side:** `electron/cli-args.js`, single-instance lock + `second-instance` handler, `--project` startup wiring into the existing workspace re-point + create-if-absent. (Depends on the file-picker spec's create/recent helpers.)
3. **builder — CLI:** `bin/cli.js` (argv parse, path resolve, app locate, detached spawn, exit codes, help/version) + `package.json` `bin` field.
4. **builder — distribution:** `npm i -g` path (and/or installer PATH shim per the task-1 decision).
5. **validator:** §8 matrix, emphasizing single-instance forwarding and app-not-found.
6. **scribe:** README "Getting started" + a new "CLI" section documenting install, `run`, flags, and `OMM_APP_PATH`.

Recommended sequencing: **1 → 2 → 3 → (4 ∥ 5) → 6.** Task 2 depends on the file-picker spec's workspace helpers landing first.

---

## 10. Open questions

1. **Distribution route.** npm global `bin` (recommended first) vs installer-managed PATH shim — or both? Affects who provisions the command.
2. **Implicit vs prompted create.** Should CLI `run` create `opencode.jsonc` silently (terminal-friendly) or open the GUI and prompt (consistent with Browse)? Spec assumes silent-create unless `--no-create`.
3. **Headless future.** Reserve `get`/`set`/`init` subcommands now (documented as future) so the verb-based shape stays stable? (Spec keeps `run` explicit to allow this.)
4. **Command name length.** `opencode-agent-manager` is long; ship a short alias (`omm`)? Spec leaves the canonical name and notes an alias is trivial to add via `bin`.
5. **App-not-installed UX.** If only the CLI is installed (e.g. via npm) but the desktop app isn't, should the CLI offer to download/point to a release, or just error? Spec assumes error-with-guidance.
