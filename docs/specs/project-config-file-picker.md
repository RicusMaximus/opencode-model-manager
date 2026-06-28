# SDD Design Spec — Project Config: opencode.jsonc File Picker (GUI)

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-28 |
| **Target component** | OpenCode Agent Manager (Electron + React) |
| **Primary surfaces** | `electron/main.js` (config path + select handlers), `electron/preload.js`, `src/App.jsx`, `src/components/TitleBar.jsx` |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope — design hand-off for an agent orchestrator |
| **Related specs** | `project-config-cli-launcher.md`, `mendix-studio-pro-extension.md` (both consume the "active project workspace" model defined here) |

---

## 1. Summary

Today the title-bar **Browse** button opens a **directory** picker (`config:select-folder`, `properties: ['openDirectory']`) and persists the chosen folder as `prefs.json.configDir`. That folder defaults to the **global** OpenCode config (`~/.config/opencode`). For a consultant working across multiple clients, a single global config is the wrong unit: each client repo wants its own model assignments, its own MCP servers, and its own authentication — none of which should leak between clients.

This spec makes the GUI able to target a **per-project** `opencode.jsonc` (or `opencode.json`) living in a client project's root folder, selected directly through **Browse**. Per the product decisions driving this work:

- **Scope = full project tree.** When a project is active, the app treats the project root exactly like a `configDir`: it manages the project's `opencode.{json,jsonc}` **plus** project-local `agents/`, `skills/`, and the `.gate/` bus. This reuses the existing `configDir` architecture wholesale.
- **Project-only (no global merge).** While a project is active the app **ignores** the global `~/.config/opencode` entirely. Reads and writes target only the project. There is no inheritance/overlay view — switching to a project fully re-points the app, exactly as `config:set-path` already does.

The net change is therefore small and surgical: let **Browse** pick the **file** (or a folder), normalize that to a project root, create the file if it's missing, generalize read/write to accept both `.json` and `.jsonc`, and (for usability) remember recent project workspaces.

---

## 2. Problem statement & motivation

- **One global config can't isolate clients.** Different clients need different MCP servers (and different secrets/auth for them). A shared `~/.config/opencode` mixes them, risking the wrong MCP server — or the wrong credentials — being active for the wrong client.
- **The current Browse picks a directory, not the config file.** Users think in terms of "open my project's `opencode.jsonc`," and a project repo's config file is the concrete artifact they want to point at. A directory picker is an indirection that also can't disambiguate a repo that doesn't yet have a config.
- **`opencode.json` is unsupported.** `config:read` only ever reads `opencode.jsonc` (`electron/main.js`). A project that uses the plain-JSON `opencode.json` form is invisible to the app.
- **No way to create a project config from the app.** If a repo has no config file yet, there's no in-app affordance to scaffold one; the user is dropped into an empty/global state with no guidance.

---

## 3. Goals / Non-goals

### Goals
1. **Browse** lets the user select a project's `opencode.jsonc` **or** `opencode.json` file directly (file picker), and the app re-points at that project's root.
2. Browse also still accepts a **folder** (a project root), for users who think in directories — selecting a folder resolves to the config file inside it.
3. If the selected project root has **no** config file, the app offers to **create** one (`opencode.jsonc` by default) from a minimal, schema-tagged template, then opens it.
4. Both `opencode.jsonc` and `opencode.json` are read and written (comments preserved for `.jsonc`); the existing atomic-write + unknown-field round-trip invariants are preserved.
5. The active project is **project-only**: global config is not merged, read, or written while a project is active. Switching projects fully re-points the app (config + agents + skills + gate), reusing `config:set-path`.
6. The app remembers a **recent workspaces** list (global config + recently opened projects) for one-click switching, improving the multi-client workflow.
7. The title bar clearly shows **which project** is active (project name + path), so a user can never act on the wrong client by mistake.

### Non-goals
- Merging/overlaying global and project config (explicitly decided against — project-only).
- Editing OpenCode config schema, model logic, the gate, or reasoning-effort behavior — those are unchanged and simply operate against the new active root.
- Multi-project simultaneous editing (one active workspace at a time; switching is the model).
- Validating that a project is a "real" OpenCode project beyond the presence/absence of a config file.
- Syncing or migrating settings between global and project configs.

---

## 4. Background — current implementation

Grounding references (names stable even if line numbers drift), all in `electron/main.js` unless noted:

- **`getConfigDir()`** — reads `prefs.json` in `app.getPath('userData')`, returns `prefs.configDir` or `DEFAULT_CONFIG_DIR` (`~/.config/opencode`). Every handler resolves its working dir through this one function.
- **`config:set-path`** — writes `{ configDir }` to `prefs.json`, then **re-inits the gate bus + watcher** for the new dir (`ensureGateDirs`, `startGateWatcher`). This is already the single, correct "re-point the whole app" entry point.
- **`config:select-folder`** — `dialog.showOpenDialog(..., { properties: ['openDirectory'] })`. Returns a folder path or `null`.
- **`config:read`** — reads `path.join(configDir, 'opencode.jsonc')` only; JSONC-strips and parses; tolerates a missing file (`/* config may not exist yet */`). Also parses `agents/*.agent.md`.
- **`config:write`** — atomic write preserving `$schema` and unknown fields (the README's round-trip invariant).
- **`src/components/TitleBar.jsx`** — renders the active path and a **Browse** button wired to an `onBrowse` prop. `App.jsx` implements `onBrowse` as `selectFolder()` → `setConfigPath(dir)` → reload.

**Net:** the app already supports an arbitrary `configDir` and already has a clean "re-point everything" path (`config:set-path`). What's missing is (a) a **file**-mode picker that resolves to a project root, (b) `.json` support, (c) **create-if-absent**, and (d) a recent-workspaces switcher.

---

## 5. Proposed design

### 5.1 The "active project workspace" model

A **workspace** is just a resolved project root used as `configDir`. The global config is workspace `~/.config/opencode`; a client project is workspace `<repo>/`. Switching workspaces = calling `config:set-path` with the new root. No new persistence model is needed beyond extending `prefs.json` (§5.5).

> **This is the unit the CLI and Mendix specs both target.** They each resolve a directory externally and ask the app to make it the active workspace via the same mechanism (see those specs' "external entry" contract).

### 5.2 Config-file resolution (`.json` vs `.jsonc`)

Introduce one helper, `resolveConfigFile(rootDir)`, used by read/write/create:

- If `<root>/opencode.jsonc` exists → use it.
- Else if `<root>/opencode.json` exists → use it.
- Else → **none** (caller decides: offer to create).
- If **both** exist → prefer `opencode.jsonc` and surface a non-blocking warning in the UI ("two config files found; editing `opencode.jsonc`"). Document this precedence; do not auto-delete the other.

`config:read` and `config:write` switch from a hard-coded `opencode.jsonc` join to `resolveConfigFile`. Writes to a `.json` file emit valid JSON (no comments injected); writes to `.jsonc` preserve comments/unknown fields exactly as today. The chosen filename is returned to the renderer so the title bar can show it.

### 5.3 Browse: file-or-folder picker

Replace the folder-only `config:select-folder` with `config:select-project` that accepts **either**:

```js
dialog.showOpenDialog(mainWindow, {
  title: 'Open OpenCode project config',
  properties: ['openFile'],            // primary mode: pick the config file
  filters: [
    { name: 'OpenCode config', extensions: ['jsonc', 'json'] },
    { name: 'All files', extensions: ['*'] },
  ],
})
```

Resolution of the dialog result → project root:

- Picked a **file** named `opencode.json(c)` → root = `path.dirname(file)`.
- Picked a **file** with another name → reject with a clear message ("Select an opencode.json or opencode.jsonc file, or a project folder").
- To also support **folder** selection, the title bar exposes the choice (see §5.4): a folder result resolves via `resolveConfigFile(folder)`.

Keep the old `openDirectory` capability available so power users can target a folder; the simplest implementation is **two affordances** behind Browse (§5.4) rather than relying on OS pickers that mix files and folders (macOS supports `['openFile','openDirectory']` together; Windows does not — so do not depend on a combined picker).

### 5.4 Title bar UX (`TitleBar.jsx`)

- **Browse** becomes a small split control / menu with two items: **"Open config file…"** (file picker) and **"Open project folder…"** (folder picker). Both funnel into the same `setActiveWorkspace(root)` flow.
- A **recent workspaces** dropdown (chevron next to Browse) lists: **Global config** (always pinned) + the last N opened projects (name + truncated path), each one-click to switch. An explicit **"Global config"** entry makes returning to the global default obvious.
- The active workspace is shown as **project name** (the root folder's basename, or `Global` for the default) plus the resolved config filename and full path on hover/title. This is the primary guard against acting on the wrong client.
- A subtle badge distinguishes **Global** vs **Project** so the two are never visually confused.

### 5.5 Persistence (`prefs.json`)

Extend `prefs.json` (back-compat: a bare `{ configDir }` still loads):

```jsonc
{
  "configDir": "C:/clients/acme/repo",   // active workspace root (unchanged key)
  "recentWorkspaces": [                    // new: MRU list, capped at e.g. 10
    { "root": "C:/clients/acme/repo", "label": "acme", "lastOpened": "2026-06-28T10:00:00Z" }
  ]
}
```

`getConfigDir()` is unchanged. A new `getRecentWorkspaces()` / `addRecentWorkspace(root)` pair maintains the MRU list; `config:set-path` calls `addRecentWorkspace` on success.

### 5.6 Create-if-absent

When `setActiveWorkspace(root)` finds **no** config file, the renderer prompts: *"No opencode config in `<root>`. Create one?"* On confirm, `config:create` writes `<root>/opencode.jsonc` atomically from a minimal template:

```jsonc
{
  // Created by OpenCode Agent Manager
  "$schema": "https://opencode.ai/config.json"
}
```

Then the app re-points to `root` and loads it. If the user declines, the workspace is not switched (no empty/ambiguous state). Creation is **opt-in** in the GUI; the CLI/Mendix specs may make it implicit (their choice, documented there).

### 5.7 IPC surface changes

| Method (preload) | Main handler | Change |
|---|---|---|
| `selectProject()` | `config:select-project` | **New** — file picker (jsonc/json), returns chosen file path or `null`. |
| `selectProjectFolder()` | `config:select-folder` | Kept; folder picker (existing). |
| `setConfigPath(root)` | `config:set-path` | Unchanged behavior; now also updates `recentWorkspaces`. |
| `getRecentWorkspaces()` | `config:recent` | **New** — returns the MRU list (+ pinned Global). |
| `createConfig(root)` | `config:create` | **New** — scaffold `opencode.jsonc` from the §5.6 template; returns the new path. |
| `readConfig()` / `writeConfig(...)` | `config:read` / `config:write` | Use `resolveConfigFile`; support `.json`; return active filename. |

`App.jsx`'s `onBrowse` is rewritten to drive the file/folder/recent flows and the create prompt.

---

## 6. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | User picks a non-config file | Rejected with a clear message; workspace unchanged. |
| 2 | Folder has neither `.json` nor `.jsonc` | Offer to create `opencode.jsonc`; if declined, do not switch. |
| 3 | Folder has **both** `.json` and `.jsonc` | Edit `.jsonc`; show non-blocking "two configs found" warning. |
| 4 | Selected root no longer exists on next launch | `getConfigDir` returns a dead path; app detects missing root, falls back to Global, surfaces a toast, prunes it from MRU. |
| 5 | Project `.gate/` doesn't exist | `config:set-path` already calls `ensureGateDirs` for the new root — created on demand (additive). |
| 6 | Switching projects with unsaved changes | Existing dirty-state guard applies; prompt to save/discard before re-pointing. |
| 7 | `.json` (no comments) round-trip | Written back as valid JSON; unknown fields still preserved via the existing `_extra` mechanism. |
| 8 | Recent list grows unbounded | Capped (e.g. 10), MRU-ordered, de-duplicated by normalized absolute path. |
| 9 | Network/UNC or path with spaces | Normalize + quote internally; selection stores the absolute path verbatim. |

---

## 7. Security & isolation notes

- **No cross-client leakage.** Project-only means while a client workspace is active, the app never reads or writes the global config or any other project. Switching is the only way to change targets, and it's explicit and visible.
- **Secrets stay where OpenCode expects them.** The app does not relocate or copy MCP credentials; per-project MCP/auth lives in the project's own config (and OpenCode's own secret handling), so different clients' secrets are never co-mingled by this app.
- **The gate secret is unaffected.** `gate-secret.key` remains in `userData` (machine-local, outside any project), so pointing at a client repo never exposes the signing secret to that repo.
- **Paths are user-chosen, not untrusted input.** Browse selections come from the OS dialog; still normalize and verify existence before persisting.

---

## 8. Testing strategy

- **Unit — `resolveConfigFile`:** `.jsonc`-only, `.json`-only, both-present (jsonc wins + warns), neither (returns none). Case-sensitivity per platform.
- **Unit — workspace resolution:** file→dirname, non-config-file rejected, folder→resolve, dead-path fallback to Global + MRU prune.
- **Unit — create template:** scaffolds valid JSONC with `$schema`; atomic write; idempotent (won't clobber an existing file).
- **Integration — re-point:** `config:set-path` to a temp project root re-inits gate dirs/watcher and subsequent `config:read/write` hit the project's config file, not the global.
- **Integration — `.json` round-trip:** read `opencode.json`, edit, write back as valid JSON with unknown fields preserved.
- **Integration — MRU:** open several roots; list is capped, ordered, de-duped; Global pinned.
- **Manual / `/run`:** Browse → pick a repo's `opencode.jsonc`, confirm the title bar shows the project + path, edit an agent model, save, and verify the project file (not global) changed.

---

## 9. Rollout & task breakdown (for the orchestrator)

1. **builder — config resolution core:** `resolveConfigFile`, `.json` support in `config:read`/`config:write`, return active filename. Unit-tested without UI.
2. **builder — workspace + MRU:** extend `prefs.json`, `config:recent`, `addRecentWorkspace`, dead-path fallback. (`config:set-path` already re-points the gate.)
3. **builder — pickers + create:** `config:select-project` file picker, `config:create` template, create-if-absent flow.
4. **builder — title bar UX:** split Browse (file/folder), recent dropdown with pinned Global, project/global badge + path display.
5. **validator:** §8 matrix, emphasizing no-global-leakage and dead-path recovery.
6. **scribe:** update README ("Configuration & data locations", Browse description, IPC table) to reflect file selection, `.json` support, and recent workspaces.

Recommended sequencing: **1 → 2 → 3 → 4 → 5 → 6.**

---

## 10. Open questions

1. **Recent-list cap & labels.** Confirm N (proposed 10) and the label rule (folder basename vs a user-editable nickname per client).
2. **Combined picker on macOS.** Worth using a single `['openFile','openDirectory']` dialog on macOS, or keep the two-affordance UX uniform across platforms? (Spec assumes uniform.)
3. **Create default form.** Always `.jsonc`, or honor a per-user "prefer .json" setting? (Spec assumes always `.jsonc`.)
4. **Global as removable.** Should "Global config" ever be hideable, or always pinned in the recent list? (Spec assumes always pinned.)
