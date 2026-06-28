# SDD Design Spec — Project Scaffolding Tool (GUI)

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-28 |
| **Target component** | OpenCode Agent Manager (Electron + React) — one-click project scaffolding for the agentic OpenCode workflow |
| **Primary surfaces** | `src/components/TitleBar.jsx` (Scaffold button), new `src/components/ScaffoldModal.jsx` (capability form), `electron/main.js` (`scaffold:*` IPC + sync engine), `electron/preload.js`, new bundled `catalog/` (MCP + skills registry), bundled `obsidian-project-memory/` template |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope — design hand-off for an agent orchestrator |
| **Depends on** | `project-config-file-picker.md` (active-workspace model + create-if-absent) |
| **Supersedes** | the prior "MCP Secret Scaffolding" draft — its auth-aware secret engine is folded in here as §7 |

---

## 1. Summary

Add a **Scaffold project** button to the title bar that, for the **currently active workspace** (the project root already selected via Browse), opens a **capability form** and then **deterministically scaffolds the files an agentic OpenCode project needs** — based only on what the user selects. The form asks which capabilities the project requires:

- **MCP servers** (from a bundled catalog: figma, stitch, mendix, obsidian, …), each with an auth profile;
- **Skills** (from a bundled catalog);
- an **Obsidian vault for project memory** (copied from the bundled template);
- a **`specs/` folder** (SDD design specs, matching `docs/specs/` convention);
- the **`.opencode-secrets/` folder** (per-project secret files for the chosen MCP auth methods).

On submit, the app writes/updates the project's **`opencode.jsonc`** plus the selected folders, wiring MCP secret references, config inputs, gitignore, and a generated README — exactly the layout we built by hand for North Sea Portal, generated from the form.

Per the product decisions driving this work:

- **Entry point = title-bar button, targets the active workspace.** No separate folder picker; the scaffolder operates on the project root the app is already pointed at (`getConfigDir()`), reusing the existing workspace model wholesale.
- **The MCP secret engine is part of this feature.** Selecting an MCP server drives an **auth-aware Input Descriptor** model (§7) that generates *only* the secret/config files that server's active auth profile needs — Stitch OAuth needs none, Stitch API-key needs one; Figma local needs none, Figma remote does.
- **Catalog-driven.** MCP servers and skills are chosen from a bundled, curated catalog so output is deterministic and reviewable.
- **Idempotent additive sync.** Re-runnable on an existing project: never clobber an existing `opencode.jsonc` or a real secret file; merge new selections in, create only what's missing.

---

## 2. Problem statement & motivation

Setting up a new client project for this workflow today is manual and error-prone. A correct project needs a coherent set of artifacts that currently get assembled by hand:

- **`opencode.jsonc`** with the right MCP servers, agents, and model wiring.
- **Per-project secrets** that OpenCode can actually load. OpenCode does **not** auto-load `.env`; secrets must be surfaced via `{file:...}` substitution and live per-client in a git-ignored `.opencode-secrets/`.
- **Secrets only where they're actually needed.** Whether a server needs a secret depends on its auth profile, not the server itself. "One secret file per server" is wrong; the tool must encode each server's auth-aware inputs, not guess.
- **Skills, a project-memory vault, and a specs folder** that the agents in this workflow expect to find.
- **gitignore + safety wiring** so a real secret is never committed.

A consultant spinning up the Nth client repo wants to click one button, check the capabilities that client needs, and get exactly that — repeatably, with no chance of leaking another client's credentials or committing a secret.

---

## 3. Goals / Non-goals

### Goals
1. A **Scaffold project** button in the title bar opens a capability form scoped to the **active workspace**.
2. The form lets the user select, from a **bundled catalog**: MCP servers (each with an auth profile), skills, an Obsidian project-memory vault, a `specs/` folder, and the `.opencode-secrets/` folder.
3. On submit, the app **writes/updates `opencode.jsonc`** and creates the selected folders/files deterministically.
4. For each selected MCP server, generate **only** the secret/config files its **active auth profile** requires (the auth-aware engine, §7), wire `{file:...}` refs, and register `doctor` checks for external dependencies.
5. **Idempotent additive sync:** re-running never clobbers an existing config or a real secret; it merges new selections and creates only missing artifacts.
6. **Never commit a secret:** maintain an authoritative `.gitignore` block and verify with `git add -n` after writing.
7. Generate a committed `.opencode-secrets/README.md` "active matrix" so the team can see which files belong to which server/profile.
8. Surface a post-scaffold summary (what was created vs. skipped, and which secrets still need filling).

### Non-goals
- A standalone CLI (`oam …`). The CLI surface is deferred; this spec is GUI-first. (The engine should be factored so a CLI can wrap it later — see §13.)
- Picking the target folder inside the form (the active workspace is the target; switch via Browse first).
- A full `doctor` UI panel. Doctor **checks** are defined here (§9) and run for the post-scaffold summary; a dedicated diagnostics view is a future extension.
- Editing OpenCode's schema, model logic, the gate, or reasoning-effort behavior — unchanged; they simply operate against the scaffolded project.
- External secret managers (1Password/Vault/SOPS) and `direnv` mode — future extensions (§13).
- Merging/overlaying global and project config — the project-only model from the file-picker spec is unchanged.

---

## 4. Background — current implementation

Grounding references (names stable even if line numbers drift), `electron/main.js` unless noted:

- **`getConfigDir()`** — resolves the active workspace root from `prefs.json`. Every handler works against it. **This is the scaffold target.**
- **`config:set-path`** — the single "re-point the whole app" entry (re-inits gate dirs/watcher). After scaffolding into the active root, no re-point is needed; after creating config in a fresh root, reuse this.
- **`config:read` / `config:write`** — atomic write preserving `$schema` and unknown fields (the round-trip invariant). The scaffolder's `opencode.jsonc` merge must preserve this.
- **`skills:list`** — already discovers `<configDir>/skill(s)/<name>.md` and `<name>/SKILL.md`. The scaffolder writes into the same layout it reads.
- **`agent:create-file`** — precedent for templated file creation into the workspace.
- **`gate:setup-mcp-entry`** — precedent for the app injecting an MCP server entry into config.
- **`obsidian-project-memory/`** — a bundled vault template (`.obsidian/` config present); the "project memory" capability copies it into the project.
- **`src/components/TitleBar.jsx`** — renders the active path + Browse; the **Scaffold** button is added here.

**Net:** the app already targets an arbitrary workspace root and already templates files into it. What's missing is (a) the capability form, (b) the bundled catalog, (c) the auth-aware secret engine, and (d) the idempotent multi-artifact `sync`.

---

## 5. Proposed design — overview

```
TitleBar [Scaffold project] ──▶ ScaffoldModal (capability form)
                                      │ user selects capabilities + per-server auth profiles
                                      ▼
                       scaffold:sync(projectRoot, selections)  ── electron/main.js
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        ▼                             ▼                              ▼
  opencode.jsonc            .opencode-secrets/                 capabilities
  (merge MCP entries,       (secret + .example files,          (skills/, specs/,
   config inline,            README active-matrix)              obsidian vault)
   secret {file:} refs)                                         + .gitignore block
                                      │
                                      ▼
                         post-scaffold summary (created / skipped / needs-fill)
```

---

## 6. The capability form (`ScaffoldModal.jsx`)

A modal opened from the title bar, scoped to the active workspace (shown read-only at the top: *"Scaffolding into `<project name>` — `<root path>`"*). Sections:

1. **MCP servers** — checkbox list from the bundled catalog (§7.5). Each checked server reveals an **auth-profile** selector (radio) populated from that server's profiles, defaulting to `defaultAuthProfile`. Inline help shows what each profile requires (e.g. "API key → one secret file"; "OAuth → gcloud login, no secret").
2. **Skills** — checkbox list from the bundled skills catalog; each adds a skill file/folder under `skill(s)/`.
3. **Project memory (Obsidian vault)** — single toggle: copy the bundled `obsidian-project-memory/` template into the project (default folder name configurable, e.g. `project-memory/`).
4. **Specs folder** — toggle: create `specs/` with a `README.md` and the SDD spec template (mirrors `docs/specs/` house style).
5. **Secrets folder** — `.opencode-secrets/` is **implied/auto-checked** whenever any selected MCP server's active profile has a `secret` input; shown as a (disabled, explanatory) row rather than a free choice, so the user understands why it appears.

Form behavior:
- **`config` inputs** (e.g. `GOOGLE_CLOUD_PROJECT`, `OBSIDIAN_API_URL`) with no `defaultValue` are **prompted inline** in the form (text fields), cached across runs.
- The footer shows a **live preview** of what will be created (file/folder list) before the user confirms.
- Submitting calls `scaffold:sync` with the full selection object; on success the modal shows the **post-scaffold summary** (§5 diagram) and a "still needs a real value" list for unfilled required secrets.

---

## 7. Core engine — auth-aware Input Descriptors (folded in from the prior spec)

Every catalog MCP server declares its runtime inputs **per auth profile**. Each input is one of three kinds:

| Kind | Where it goes | Example |
|---|---|---|
| `secret` | git-ignored file in `.opencode-secrets/`, referenced via `{file:...}` | `OBSIDIAN_API_KEY` |
| `config` | inline in project `opencode.jsonc` (prompted or defaulted; not sensitive) | `GOOGLE_CLOUD_PROJECT`, `OBSIDIAN_API_URL` |
| `external` | nothing generated; satisfied outside OpenCode | gcloud ADC, Figma/Mendix desktop app |

The scaffolder generates files **only** for `secret` inputs of the **active** profile. `config` inputs are written inline; `external` inputs register a `doctor` check and create nothing.

### 7.1 Schema (illustrative TS)

```ts
interface McpServerDescriptor {
  id: string;                         // "obsidian"
  transport: "local" | "remote";
  command?: string[];                 // for local
  url?: string;                       // for remote
  defaultAuthProfile: string;
  authProfiles: Record<string, AuthProfile>;
}

interface AuthProfile {
  id: string;                         // "local-rest-api" | "oauth-proxy" | "api-key" | "local-desktop"
  inputs: InputSpec[];
}

type InputSpec =
  | { kind: "secret";   envVar: string; fileName: string; required: boolean;
      placeholder: string; source: string; validate?: string /* regex */ }
  | { kind: "config";   envVar: string; required: boolean;
      defaultValue?: string; prompt?: string; secretLooking?: false }
  | { kind: "external"; envVar?: string; via: "gcloud-adc" | "desktop-app" | "local-port";
      check: ExternalCheck; note: string };

interface ExternalCheck {           // used by doctor checks, not scaffolding
  type: "file" | "port" | "command";
  target: string;                   // ADC path | "127.0.0.1:3845" | "gcloud auth ..."
}
```

### 7.2 `sync(projectRoot, selections)` algorithm

```
for server in selections.mcpServers:
    profile = selections.authProfile[server] ?? catalog[server].defaultAuthProfile
    for input in catalog[server].authProfiles[profile].inputs:
        switch input.kind:
          secret:
            ensureFile(".opencode-secrets/<fileName>",         input.placeholder)   # create only if missing
            ensureFile(".opencode-secrets/<fileName>.example", input.placeholder)   # always
            ensureConfigRef(server, input.envVar, "{file:./.opencode-secrets/<fileName>}")
          config:
            val = input.defaultValue ?? selections.configValues[input.envVar]        # prompted in form, cached
            ensureConfigInline(server, input.envVar, val)
          external:
            registerDoctorCheck(input.check)                                         # no file
    ensureServerBaseFields(server)            # type/command/url from catalog; merge into opencode.jsonc

for skill in selections.skills:   ensureSkill(skill)                                  # copy template into skill(s)/
if selections.projectMemory:      ensureObsidianVault(selections.memoryFolder)        # copy bundled template
if selections.specsFolder:        ensureSpecsFolder()                                 # specs/ + README + template

ensureSecretsReadme(projectRoot, activeMatrix)   # committed .opencode-secrets/README.md
ensureGitignoreBlock(projectRoot)
writeProjectOpencodeJsonc(projectRoot)           # atomic, preserves $schema + unknown fields
return summary(created, skipped, needsFill)
```

### 7.3 Generated layout

```
<project-root>/
├─ opencode.jsonc                       # merged: MCP entries, config inline, secret {file:} refs
├─ .opencode-secrets/
│   ├─ <fileName>            (ignored)   # real value, placeholder until filled
│   ├─ <fileName>.example   (committed)
│   └─ README.md            (committed)  # auto-generated active matrix
├─ skill(s)/<name>/SKILL.md  (committed) # for each selected skill
├─ specs/                                # if selected: README + SDD template
│   └─ README.md
├─ <memoryFolder>/          (vault)      # if selected: bundled Obsidian project-memory vault
└─ .gitignore               (block appended)
```

### 7.4 Idempotency & safety rules (hard requirements)

1. **Never overwrite an existing real secret file** — `ensureFile` is create-if-missing only.
2. **Never clobber an existing `opencode.jsonc`** — deep-merge selections in, preserving `$schema`, comments, and unknown fields (reuse the `config:write` round-trip invariant).
3. **No trailing newline** in any generated secret/`.example` file (`{file:}` is literal).
4. Real secret files written `0600` where the OS supports it; `.example`/`README` world-readable.
5. **Drift detection:** if `opencode.jsonc` references a `{file:...}` whose file is absent, or a secret file still equals its placeholder, surface it in the summary / doctor (don't silently "fix").
6. **Gitignore is authoritative:** ignore `/.opencode-secrets/*`, re-include `*.example` + `README.md`; verify with `git add -n` after writing.
7. **Switching auth profile** later adds new secret refs but only removes an old real secret after explicit confirmation.
8. **Re-run = additive:** already-present skills/folders/vault are detected and skipped, reported as "skipped (exists)" in the summary.

### 7.5 Catalog entries for the four launch servers

```jsonc
{
  "stitch": {
    "defaultAuthProfile": "oauth-proxy",
    "authProfiles": {
      "oauth-proxy": { "inputs": [
        { "kind": "config",   "envVar": "GOOGLE_CLOUD_PROJECT", "required": true,
          "prompt": "GCP project ID for this client" },
        { "kind": "external", "via": "gcloud-adc", "note": "gcloud auth application-default login",
          "check": { "type": "file", "target": "%APPDATA%/gcloud/application_default_credentials.json" } }
      ]},
      "api-key": { "inputs": [
        { "kind": "secret", "envVar": "STITCH_API_KEY", "fileName": "stitch-api-key",
          "required": true, "placeholder": "REPLACE_ME__stitch_api_key", "source": "Stitch console" }
      ]}
    }
  },
  "figma": {
    "defaultAuthProfile": "local-desktop",
    "authProfiles": {
      "local-desktop": { "inputs": [
        { "kind": "external", "via": "local-port", "note": "Figma desktop, Dev Mode MCP enabled",
          "check": { "type": "port", "target": "127.0.0.1:3845" } } ]},
      "remote": { "inputs": [
        { "kind": "secret", "envVar": "FIGMA_ACCESS_TOKEN", "fileName": "figma-access-token",
          "required": true, "placeholder": "REPLACE_ME__figma_PAT", "source": "Figma → Settings" } ]}
    }
  },
  "mendix": {
    "defaultAuthProfile": "local",
    "authProfiles": { "local": { "inputs": [
      { "kind": "external", "via": "local-port", "note": "Studio Pro → Preferences → Maia → MCP",
        "check": { "type": "port", "target": "127.0.0.1:7782" } } ]}}
  },
  "obsidian": {
    "defaultAuthProfile": "local-rest-api",
    "authProfiles": { "local-rest-api": { "inputs": [
      { "kind": "config", "envVar": "OBSIDIAN_API_URL", "required": true, "defaultValue": "https://127.0.0.1:27124" },
      { "kind": "secret", "envVar": "OBSIDIAN_API_KEY", "fileName": "obsidian-api-key", "required": true,
        "placeholder": "REPLACE_ME__obsidian_key__value_only__no_newline", "source": "Obsidian Local REST API plugin" },
      { "kind": "config", "envVar": "OBSIDIAN_VERIFY_SSL", "required": false, "defaultValue": "false" }
    ]}}
  }
}
```

---

## 8. IPC surface

| Method (preload) | Main handler | Description |
|---|---|---|
| `getScaffoldCatalog()` | `scaffold:catalog` | **New** — returns the bundled MCP + skills catalog (for the form). |
| `previewScaffold(selections)` | `scaffold:preview` | **New** — dry-run; returns the list of files/folders that *would* be created vs. skipped (powers the live preview). No writes. |
| `runScaffold(selections)` | `scaffold:sync` | **New** — executes §7.2 against the active workspace; returns `{ created, skipped, needsFill }`. |
| `readConfig()` / `writeConfig(...)` | `config:read` / `config:write` | Reused; the merge into `opencode.jsonc` goes through the existing atomic round-trip-preserving write. |

`scaffold:sync` resolves its target via `getConfigDir()` — there is no folder argument; the active workspace **is** the target.

---

## 9. Doctor checks (per input kind)

Run after scaffolding (for the summary) and re-runnable on demand:

- **secret:** file exists · ≠ placeholder · matches `validate` regex · no trailing newline.
- **config:** present & non-empty · not "secret-looking" (entropy heuristic → warn if a real key got pasted inline).
- **external:** `gcloud-adc` → ADC file present + quota project set; `local-port` → TCP connect to target (Figma 3845 / Mendix 7782 / Obsidian 27124).
- **repo:** gitignore block present; `git add -n` would not stage any real secret.

---

## 10. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | No active workspace (Global config) | Scaffold button disabled (or prompts to Browse to a project first); never scaffold into the global config dir. |
| 2 | `opencode.jsonc` already exists | Deep-merge selections; preserve comments/`$schema`/unknown fields; report merged vs. skipped. |
| 3 | Real secret file already present | Left untouched; `.example` refreshed; reported as "skipped (exists)". |
| 4 | Non-git project | Skip gitignore management, **warn loudly** that secrets aren't protected. |
| 5 | Shared secret across servers | Dedupe by `fileName`; one file, multiple `{file:}` refs. |
| 6 | Monorepo / nested config | Resolve `.opencode-secrets/` relative to the active workspace root (the nearest `opencode.jsonc`), not the git repo root. |
| 7 | Required secret never filled | `doctor`/summary fails clearly ("needs a real value") rather than OpenCode failing opaquely at runtime. |
| 8 | Skill / vault folder already exists | Detected and skipped (additive); never overwrites user edits. |
| 9 | User unchecks a server on re-run | Existing entries/secrets are **not** auto-removed; removal requires explicit confirmation (rule §7.4.7). |
| 10 | Both `opencode.json` and `.jsonc` present | Follow the file-picker spec's precedence (`.jsonc` wins, non-blocking warning); scaffold into the winner. |

---

## 11. Security & isolation notes

- **No cross-client leakage.** Scaffolding targets only the active workspace; one client's secrets are written under that client's `.opencode-secrets/` and nowhere else.
- **Secrets never committed.** Authoritative gitignore + post-write `git add -n` check + (optional, future) pre-commit guard; placeholder files are committed, real values never are.
- **The gate secret is unaffected.** `gate-secret.key` stays in `userData`, outside any project.
- **Catalog is curated.** MCP commands/URLs come from the bundled catalog, not free-form user input, so scaffolding can't be coerced into running an arbitrary command.

---

## 12. Testing strategy

- **Unit — engine:** `ensureFile` create-if-missing; no trailing newline; `0600` where supported; gitignore block idempotence; `git add -n` would stage nothing.
- **Unit — per-profile generation:** Stitch `oauth-proxy` emits **no** secret (config + external only); Stitch `api-key` emits one secret; Figma `local-desktop` none; Figma `remote` one; Obsidian emits 2 config + 1 secret.
- **Unit — merge:** scaffolding into an existing `opencode.jsonc` preserves `$schema`, comments, and unknown fields; existing MCP entries survive; figma/mendix base fields round-trip.
- **Unit — catalog:** every descriptor's `fileName` unique-per-profile; dedupe by `fileName` across servers.
- **Integration — full sync:** temp project root, select all four servers + skills + vault + specs; assert exact §7.3 layout; re-run is a no-op (all "skipped").
- **Integration — preview parity:** `scaffold:preview` output matches what `scaffold:sync` actually creates.
- **Manual / `/run`:** Browse to a temp repo → Scaffold → select obsidian (`local-rest-api`) + stitch (`oauth-proxy`) + figma (`local-desktop`) + mendix (`local`) → confirm **exactly one** secret file (`obsidian-api-key`), inline configs for the rest, vault + specs folders, and a clean `git add -n`.

---

## 13. Worked example — North Sea Portal (what the form emits)

Selection: obsidian + stitch + figma + mendix, default profiles, plus project-memory vault and specs folder.

| Server | Active profile | Inputs → action |
|---|---|---|
| obsidian | `local-rest-api` | `OBSIDIAN_API_URL`→inline · `OBSIDIAN_API_KEY`→`.opencode-secrets/obsidian-api-key` · `OBSIDIAN_VERIFY_SSL`→inline |
| stitch | `oauth-proxy` | `GOOGLE_CLOUD_PROJECT`→inline (prompted: `north-sea-portal-mcp-7…`) · gcloud ADC → doctor check (no file) |
| figma | `local-desktop` | port 3845 → doctor check (no file) |
| mendix | `local` | port 7782 → doctor check (no file) |

→ exactly one secret file, plus `project-memory/` vault and `specs/` — which is what we have by hand. ✅

---

## 14. Rollout & task breakdown (for the orchestrator)

1. **builder — engine core:** `ensureFile`/`ensureConfigRef`/`ensureConfigInline`/`ensureGitignoreBlock`, the `sync` reducer, summary object. Pure functions, unit-tested without UI.
2. **builder — catalog:** bundled MCP descriptor registry (§7.5) + skills catalog + the obsidian vault template wiring.
3. **builder — IPC:** `scaffold:catalog`, `scaffold:preview`, `scaffold:sync`; route writes through the existing `config:write` round-trip.
4. **builder — UI:** `TitleBar` Scaffold button (disabled when Global) + `ScaffoldModal` (capability form, auth-profile selectors, config prompts, live preview, post-scaffold summary).
5. **builder — doctor checks:** §9 evaluators feeding the summary.
6. **validator:** §12 matrix, emphasizing per-profile generation, never-clobber, no-secret-committed.
7. **scribe:** README — "Scaffold project" button, catalog, secret layout, gitignore guarantees.

Recommended sequencing: **1 → 2 → 3 → 4 → 5 → 6 → 7.**

---

## 15. Future extensions

- **CLI wrapper (`oam`):** `oam project init/sync`, `oam secret set`, `oam project auth … --profile …`, `oam doctor` — thin wrappers over the same engine (§14.1–§14.3), for terminal-native use.
- **External secret managers:** a fourth input kind resolving `{file:...}` from a fetched/decrypted temp file (1Password, Vault, SOPS).
- **direnv mode:** alternative emitter writing `.env.local` + `.envrc`, rewriting refs to `{env:...}`.
- **Template packs:** per auth-profile bundles so a one-click "Stitch (API key)" is a single catalog entry.
- **Diagnostics panel:** a dedicated `doctor` view (beyond the post-scaffold summary) showing live status of every input across all configured servers.

---

## 16. Open questions

1. **Skills catalog contents.** Which skills ship in the bundled catalog at launch, and is each a single `.md` or a `SKILL.md` folder? (Spec assumes the existing `skill(s)/<name>/SKILL.md` layout.)
2. **Memory folder name.** Fixed (`project-memory/`) or user-named per project in the form? (Spec assumes user-named, defaulting to `project-memory`.)
3. **Specs folder location.** Project root `specs/` or `docs/specs/` to mirror this repo? (Spec assumes root `specs/`; confirm.)
4. **Config-value caching scope.** Are prompted `config` values (e.g. GCP project) remembered per workspace in `prefs.json`, or re-entered each run? (Spec assumes cached per workspace.)
5. **Removal UX.** When a user unchecks a previously-scaffolded server, where does the explicit "remove its secrets/entry?" confirmation live — in the modal, or only via a future doctor/cleanup action? (Spec assumes a modal confirmation, additive-by-default.)
