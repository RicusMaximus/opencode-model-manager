# SDD Design Spec — Gated Multi-Agent Review Queue

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-25 |
| **Target component** | OpenCode Agent Manager (Electron + React) + a gate tool consumed by the opencode runtime |
| **Primary surfaces** | `electron/main.js`, `electron/preload.js`, `src/App.jsx`, new `src/components/ReviewQueuePanel.jsx`, new gate tool (MCP server / script) |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope for this document — this is a design hand-off for an agent orchestrator |

---

## 1. Summary

The agent team defined in `AGENTS.md` follows a **Gated Multi-Agent Orchestration Pattern**: a human review gate sits between the *design* stage (`architect`, `ui_generator`, `design_system_integrator`) and the *build* stage (`builder`, `validator`, `scribe`). Today that gate exists only as **prose instruction** in the orchestrator's prompt — there is no mechanism that actually pauses the pipeline or surfaces the design artifacts for a decision. Nothing stops the orchestrator from marching into the build stage on a flawed design.

This spec defines the gate as a real, two-part system:

1. A **filesystem-backed review queue** (a message bus between two processes that share no memory: the opencode runtime and this Electron app).
2. A **gate tool** the orchestrator calls that submits a review request and **blocks** until a human decision is returned, and a **Review Queue UI** in the agent manager where the human approves, rejects-with-notes, or annotates.

The central design constraint is **trust**: both processes run as the same OS user, so a decision must be **unforgeable by the agent**. The spec's security model (HMAC-signed decisions + path confinement + no code execution) is what turns "two processes sharing a folder" into an actual gate.

---

## 2. Problem statement & motivation

The architect and design agents produce a large volume of output. If the orchestrator proceeds straight to the build stage, errors compound — a bad design decision at the top becomes many bad implementation microflows at the bottom, discovered only after tokens and time are spent on work that must be ripped out.

The leverage point: AI is fast and consistent at *generating*; the human is better at *judging* whether the generated thing is the right thing. The gate makes that division explicit in the workflow instead of implicit in the operator's stress level.

Two concrete gaps today:

- **No pause.** The orchestrator prompt says "STOP AT THE GATE," but an LLM agent only acts by calling tools — there is no tool that blocks, so the instruction is unenforceable.
- **No review surface.** There is nowhere to see the architecture/microflow design and the Figma UI spec side by side, evaluate them against a checklist, and record an approve/reject decision that flows back to the runtime.

---

## 3. Goals / Non-goals

### Goals
1. The orchestrator can **block** at the design→build boundary via a single synchronous gate tool call that returns a verdict (`approved` / `rejected` + notes).
2. A human can **see queued reviews** in the agent manager, open one, view its design artifacts **side by side**, and **approve / reject-with-notes / annotate**.
3. A rejected decision carries notes back to the orchestrator, which re-spawns only the flagged design agent — modeling the three-state machine (`Pending review` / `Approved` / `Rejected with notes`) from `AGENTS.md`.
4. A decision is **unforgeable by the agent**: the runtime cannot self-approve. Approval authority rests on a cryptographic signature, not on filesystem presence.
5. All untrusted inputs (request files, artifact paths, rendered content) are validated and confined; the app never executes artifact content.
6. The gate **fails closed**: on timeout, missing/invalid signature, or app-not-running, the orchestrator treats the result as *not approved* and halts.
7. The mechanism works cross-platform (Windows-first, matching the current target) and degrades gracefully when the app is closed.

### Non-goals
- Building the feature (this is design only).
- Auto-evaluating design *quality* with AI (the checklist in §7.6 is rule-based, not a model call).
- Replacing the orchestrator's prompt-level gate language (this spec makes it *enforceable*, it does not remove it).
- A networked/multi-user review server. The gate is single-user, local, same-machine. Remote review is a future follow-up (§11).
- Authentication of *which human* approves (single local operator assumed; audit log records timestamps, not identities).

---

## 4. Background — current implementation

Grounding references (names stable even if line numbers drift):

- **`electron/main.js`**
  - IPC pattern: every capability is an `ipcMain.handle('<namespace>:<verb>', …)` returning a plain object. Config path is resolved via `getConfigDir()` (reads `prefs.json` in `app.getPath('userData')`, defaults to `~/.config/opencode`).
  - **`atomicWrite(filePath, content)`** — temp file → `rename`, so a crash never leaves a half-written file. Reuse this for decisions.
  - Hardened window: `contextIsolation: true`, `nodeIntegration: false`, custom `preload.js`. No remote content in production (`loadFile` of local `dist`).
  - File reads are already confined to `configDir` subfolders (`agents/`, `skill(s)/`); no path-confinement *helper* exists yet — paths are currently built by the app itself, never taken from untrusted input. **This feature introduces the first untrusted path input**, so a confinement helper is new work.
  - No push channel exists yet — all IPC is renderer-initiated `invoke`. A `webContents.send` push (for live queue updates) is new.
- **`electron/preload.js`**
  - Exposes a flat `electronAPI` object via `contextBridge`. Extend it with gate methods + one event subscription (`onReviewUpdate`).
- **`src/App.jsx` / `src/components/`**
  - Panel components (`AgentPanel`, `OllamaPanel`, etc.) selected by a left `Sidebar`. A new `ReviewQueuePanel` is a sibling panel with a nav entry.
- **`package.json`**
  - The config repo already depends on `@opencode-ai/plugin` — relevant because the gate tool *could* be an opencode plugin (§5.2). The app itself has no test of blocking IPC today.
- **`AGENTS.md` (config repo) + `agent-orchestrator.agent.md`**
  - Define the gated pipeline, the three gate states, and the `ui_generator → design_system_integrator` HANDOFF block. This spec implements the enforcement those documents assume.

**Net:** the app already has a clean IPC + atomic-write foundation and a panel architecture. What's missing is (a) a blocking tool on the runtime side, (b) the queue read/decide/watch IPC + UI, and (c) the trust/security layer for untrusted cross-process input.

---

## 5. Feasibility research — *can the gate actually block and be trusted?*

### 5.1 Can an opencode agent block on a human decision?
Yes — but only by calling a tool that itself blocks. An LLM agent has no native "await file change." The pattern is a **submit-then-poll tool**: a single call writes the request, polls for the signed decision, and returns the verdict into the agent's context. From the orchestrator's perspective it is one synchronous tool call. This is the only mechanism that makes "STOP AT THE GATE" enforceable rather than advisory.

### 5.2 Where should the gate tool live?
Three viable hosts, in recommended order:

1. **Local MCP server** (recommended). opencode consumes MCP tools natively; the verdict returns cleanly as a tool result into the agent's context; cross-platform Node process. Cost: a small server to maintain.
2. **Bash/Node script invoked via the agent's shell tool.** Simplest to write; returns verdict on stdout. Cost: depends on shell availability and the agent having a permissive `bash` permission (the orchestrator currently has `bash: "ask"`/restricted), and parsing stdout is less structured than an MCP result.
3. **opencode plugin** (`@opencode-ai/plugin`, already a dependency). Can hook the lifecycle, but synchronous human-in-the-loop blocking is awkward to express as a hook. Better suited to *enforcing* that the gate tool was called than to *being* the gate.

**Verdict:** implement the gate as a **local MCP server** exposing one blocking tool, with the bash-script form documented as a fallback for environments without MCP.

### 5.3 Can a decision be made unforgeable?
Not by filesystem permissions alone — both processes run as the same OS user, so the runtime can write any file the app can. The enforceable mechanism is **cryptographic**: the app signs each decision with an **HMAC secret stored in `app.getPath('userData')`** (outside `configDir`, which the agent reads). The gate tool verifies the signature before trusting `approved`. A forged or unsigned decision is treated as *not approved*. This shifts authority from "a file exists" to "a file is signed by the app," which the agent cannot produce.

### 5.4 Feasibility verdict
Feasible. Blocking is solved by a submit-then-poll MCP tool; trust is solved by HMAC-signed decisions; the app side is a straightforward extension of the existing IPC + atomic-write + panel patterns. The only genuinely new infrastructure is (a) the MCP server and (b) the path-confinement + signature layer.

---

## 6. Proposed design — overview

```
  opencode runtime                          filesystem (.gate bus)                 Electron app
 ┌──────────────────┐   submit_for_review  ┌──────────────────────────┐          ┌────────────────────┐
 │ orchestrator     │ ───────────────────▶ │ requests/<id>.json        │ ─watch─▶ │ ReviewQueuePanel   │
 │  → gate tool     │                      │   (agent-written)         │          │  list + side-by-   │
 │     │ blocks     │                      ├──────────────────────────┤          │  side artifacts +  │
 │     ▼ polls      │ ◀─────────────────── │ decisions/<id>.json        │ ◀write─ │  checklist +       │
 │  verifies HMAC   │   { status, notes }  │   (app-written, SIGNED)   │          │  approve/reject    │
 │     │            │                      ├──────────────────────────┤          └────────────────────┘
 │     ▼ proceed/   │                      │ archive/<id>.json (history)│
 │       reject     │                      └──────────────────────────┘
 └──────────────────┘
          HMAC secret lives in app userData — never under configDir, never readable by the agent
```

Two independent writers, one file each → no lock contention. The gate **state** is derived: no decision file = `Pending`; signed `approved` = `Approved`; signed `rejected` = `Rejected with notes`.

---

## 7. Detailed design

### 7.1 Directory layout & ownership

Under the resolved `configDir` (so both processes find it the same way the app already resolves agents/skills):

```
<configDir>/.gate/
  requests/<reviewId>.json     # WRITER: gate tool (agent). READER: app.
  decisions/<reviewId>.json    # WRITER: app. READER: gate tool. SIGNED.
  archive/<reviewId>.json      # WRITER: app. Append-only history (request+decision merged).
```

The **HMAC secret** lives at `app.getPath('userData')/gate-secret.key` (0600 where supported), generated on first run. It is deliberately **outside `configDir`** so the agent — which only knows how to read the config tree — cannot reach it.

### 7.2 Contracts

**Review request** (agent → app; every field from the agent is untrusted):
```ts
type ReviewRequest = {
  id: string                 // ULID/uuid; also the idempotency key
  schemaVersion: 1
  createdAt: string          // ISO-8601
  expiresAt: string          // ISO-8601; gate fails closed past this
  stage: 'design'            // reserved for future gates; only 'design' for now
  agent: string              // e.g. 'design_system_integrator'
  title: string              // human-readable queue label
  artifacts: Array<{
    kind: 'architecture' | 'figma-spec' | 'handoff' | 'other'
    path: string             // UNTRUSTED — confined to configDir/project (§7.4)
  }>
  checklist?: 'mtf' | null   // which rule-based checklist to auto-run (§7.6)
}
```

**Decision** (app → agent; signed):
```ts
type ReviewDecision = {
  id: string
  schemaVersion: 1
  status: 'approved' | 'rejected'
  notes: string              // required, non-empty, on 'rejected'
  decidedAt: string
  sig: string                // HMAC-SHA256 over canonical(id|status|notes|decidedAt|schemaVersion)
}
```

`canonical()` is a fixed, documented field ordering serialized deterministically (no key-order ambiguity), so signer and verifier agree byte-for-byte.

### 7.3 Gate tool (runtime side)

A single blocking MCP tool:

```
submit_for_review({ stage, agent, title, artifacts, checklist }) -> { status, notes }
```

Behavior:
1. Generate `id`, write `requests/<id>.json` atomically (temp→rename).
2. Poll `decisions/<id>.json` on a fixed interval (≈2 s) until present or `expiresAt`.
3. On decision: **verify `sig`** with the shared secret. Invalid signature ⇒ return `{ status: 'rejected', notes: 'signature verification failed' }` (fail closed).
4. On expiry / app unreachable ⇒ return `{ status: 'rejected', notes: 'gate timeout — no decision' }`.
5. Move request+decision into `archive/` (or let the app own archival — see §7.7; single archiver to avoid races).

The orchestrator prompt already says to call the gate after the design stage and halt; this tool is what that instruction binds to. On `approved` it runs `builder → validator → scribe`; on `rejected` it re-spawns only the flagged design agent with `notes` injected and submits a **new** review (new `id`).

> The gate tool needs the **same secret** the app uses to *verify* (HMAC is symmetric). To keep the agent from reading it directly, the verification can run inside the MCP server process, which loads the key from `userData` at startup via an OS path the *server* knows but does not expose as a tool/resource. Trade-off discussed in §11 — if symmetric key exposure is unacceptable, switch to an asymmetric scheme (app signs with a private key; tool verifies with a public key it may freely hold).

### 7.4 Path confinement (untrusted artifact paths)

`artifacts[].path` is attacker-controlled input. A new main-process helper `confinePath(base, candidate)`:
- Resolves `candidate` against an allowlisted `base` (the project/config dir).
- Rejects absolute paths that escape `base`, any `..` traversal, and **symlinks** that resolve outside `base` (`fs.realpath` then re-check containment).
- Enforces a max file size on read and a max artifact count per request.
- Returns a safe absolute path or throws; the app surfaces "artifact unavailable / rejected," never reads outside the sandbox.

This is the first untrusted path input in the codebase, so confinement is implemented once, here, and unit-tested adversarially (§9).

### 7.5 App IPC surface (`electron/main.js` + `electron/preload.js`)

New handlers, mirroring the existing `ipcMain.handle` style:

- `gate:list` → enumerate `requests/` without a matching `decisions/` file; return lightweight queue items (id, title, agent, createdAt, expiresAt, artifact kinds). Skip/flag malformed or expired entries.
- `gate:read` → for one id, return the validated request plus the **confined, size-capped** contents of each artifact (as text for rendering).
- `gate:decide` → validate input from the renderer (status enum, notes-required-on-reject), build the canonical payload, **sign with the userData secret**, `atomicWrite` to `decisions/<id>.json`, then archive. Append to an audit log.
- A `fs.watch` on `requests/` (and `decisions/`) that pushes change events to the renderer via `webContents.send('gate:updated', …)`. Debounced; on watch failure, the renderer falls back to polling `gate:list`.

`preload.js` gains: `listReviews()`, `readReview(id)`, `decideReview({ id, status, notes })`, and `onReviewUpdate(cb)` (subscribes to `gate:updated`, returns an unsubscribe).

**Trust rule:** every handler treats both the request files *and* the renderer arguments as untrusted — schema-validate, confine paths, cap sizes. Never trust the renderer (standard Electron discipline).

### 7.6 Review UI (`src/components/ReviewQueuePanel.jsx`)

A new sibling panel with a `Sidebar` nav entry and a pending-count badge.

- **Left:** the queue — pending reviews with title, agent, stage, age, and expiry countdown. Live-updates via `onReviewUpdate`.
- **Right (on select):** the two design artifacts **side by side** — the architecture/microflow design and the Figma UI spec — rendered as **sanitized markdown/plain text** (no `dangerouslySetInnerHTML` of untrusted content; no remote resource loads).
- **Checklist:** a **rule-based** auto-evaluation against the design (the "MTF checklist"): e.g. microflow missing a prerequisite check, wrong commit pattern, implausible layer placement. Pure string/structure rules — **no model call**. Each item shows pass/warn/fail with the line it matched, to orient the reviewer; it informs, it does not decide.
- **Actions:** **Approve**, **Reject** (notes required — enforced before `gate:decide`), **Annotate** (free-text notes that accompany either decision). After a decision the item moves to history.
- **History view:** archived reviews with their decision + notes + timestamp (from `archive/` + audit log).

### 7.7 Lifecycle, concurrency, idempotency

- **Single writer per file** (agent writes requests, app writes decisions) eliminates lock contention by construction.
- **Single archiver:** the **app** owns moving resolved reviews to `archive/` (it is the last writer); the gate tool only reads the decision. Avoids both processes renaming the same file.
- **Idempotency:** `id` is the key. A decision already present ⇒ the tool returns it without re-prompting. Re-submitting the same `id` is a no-op on the app side.
- **TTL / expiry:** `expiresAt` bounds how long the tool blocks and how long the app shows an item as actionable. Expired-without-decision ⇒ fail closed.
- **App closed:** the tool keeps polling until `expiresAt`, then fails closed. (Optional later enhancement: a tray/notification to prompt opening the app — out of scope.)

### 7.8 Security model (summary table)

| Threat | Mitigation |
|---|---|
| Agent self-approves (same OS user) | Decisions HMAC-signed with a secret in `userData`, outside `configDir`; tool verifies before trusting `approved`. Unsigned/forged ⇒ not approved. |
| Path traversal / symlink escape in `artifacts[].path` | `confinePath` (§7.4): resolve + `realpath` + containment check; reject `..`, absolute escapes, out-of-base symlinks. |
| Malicious markdown / XSS in artifacts | Sanitized render, no `dangerouslySetInnerHTML` of untrusted input, no remote loads; keep `contextIsolation`/`nodeIntegration:false`; add strict CSP. |
| Arbitrary code execution via artifacts | App is viewer + decider only; never eval/run/shell-out artifact content. |
| Untrusted renderer IPC args | Validate every handler input in main; confine paths; cap sizes. |
| Secret leakage into the bus | Reject/strip requests containing token-shaped fields; never write secrets into `.gate/`. |
| Resource abuse (huge/many files) | Per-request size + artifact-count caps; queue-length cap; expiry. |
| No traceability | Append-only audit log of decisions (id, status, timestamp) alongside `archive/`. |

### 7.9 No breaking changes to existing config flow

`.gate/` is a new sibling directory under `configDir`; the existing `config:read`/`config:write`/agent/skill handlers are untouched. The Ollama provider block and atomic-write invariants are unaffected.

---

## 8. Edge cases

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | App closed when tool submits | Tool blocks until `expiresAt`, then fails closed (rejected: timeout) |
| 2 | Decision file present but signature invalid | Treated as not approved; tool returns rejected (signature failure) |
| 3 | Artifact path uses `..` or absolute escape | `confinePath` rejects; UI shows "artifact unavailable," review still decidable |
| 4 | Artifact is a symlink pointing outside base | Rejected after `realpath` containment check |
| 5 | Oversized / too many artifacts | Capped; excess flagged, not loaded |
| 6 | Malformed request JSON | Skipped in `gate:list` with a visible "malformed" marker; never crashes the panel |
| 7 | Duplicate `id` resubmitted | Idempotent — existing decision returned; no second queue entry |
| 8 | Reject without notes | Blocked client-side and re-validated in `gate:decide`; notes required |
| 9 | Expired review still in queue | Shown as expired/non-actionable; tool already failed closed |
| 10 | `fs.watch` unsupported/fails | Renderer falls back to interval polling of `gate:list` |
| 11 | Two app windows open | Decisions are atomic + idempotent; last signed write wins, archived once |
| 12 | Markdown artifact contains script/HTML | Rendered inert (sanitized); no execution, no network |

---

## 9. Testing strategy

- **Unit — `confinePath`:** adversarial table (`..`, absolute, UNC/`\\?\` on Windows, symlink-out, mixed separators) all rejected; in-base paths accepted.
- **Unit — signing:** sign→verify round-trips; tampering with any signed field fails verification; canonical serialization is order-stable.
- **Unit — request/decision validation:** schema rejects missing/extra/oversized fields; reject-requires-notes enforced.
- **Integration — gate tool:** submit → app decides (approve / reject) → tool returns correct verdict; timeout path returns fail-closed; forged unsigned decision rejected.
- **Integration — IPC:** `gate:list/read/decide` round-trip against a temp `.gate/` dir; `gate:updated` push fires on new request; archival happens exactly once.
- **Integration — concurrency:** simultaneous decision writes resolve idempotently; single archiver invariant holds.
- **Security — renderer:** confirm untrusted markdown renders inert; CSP blocks remote loads; handlers reject malformed renderer args.
- **Offline / app-down:** tool blocks then fails closed; watch-failure falls back to polling.
- **Manual / `/run`:** run an end-to-end orchestrated task, confirm the pipeline halts at the gate, the artifacts render side by side, approve → build stage runs, reject-with-notes → re-spawn of the flagged design agent.

---

## 10. Rollout & task breakdown (for the orchestrator)

1. **architect / research (blocking):** Resolve §11 open questions — gate tool host (MCP vs script vs plugin), symmetric-vs-asymmetric signing, exact opencode tool-registration shape, and how the orchestrator prompt binds to `submit_for_review`. Output: confirmed interfaces + a filled-in contract.
2. **builder — gate bus + security core:** `.gate/` schema + validators, `confinePath`, secret generation, sign/verify, audit log. Backend-only, fully unit-testable without UI.
3. **builder — gate tool (runtime):** the blocking `submit_for_review` MCP server (+ documented bash fallback); verification and fail-closed behavior.
4. **builder — app IPC:** `gate:list/read/decide` + `fs.watch` push in `main.js`; extend `preload.js`.
5. **builder — Review UI:** `ReviewQueuePanel.jsx` (queue, side-by-side artifacts, rule-based checklist, approve/reject/annotate, history) + `Sidebar` nav entry.
6. **validator:** implement the §9 matrix; emphasize the security/adversarial and fail-closed paths.
7. **scribe:** update `AGENTS.md` (config repo) to reference the enforced gate + this spec; document the `.gate/` contract and the maintenance points.

Recommended sequencing: **1 → 2 → (3 ∥ 4) → 5 → 6 → 7.** Task 2 (security core) is a hard prerequisite for both the tool and the IPC because both depend on signing + confinement.

> Note for the orchestrator: this feature is itself a candidate for its **own** gate review — design artifacts (this spec + the §7.2 contracts) should pass the gate before the build stage begins, once the gate exists. Bootstrapping: the first build runs ungated; thereafter the gate reviews its own evolution.

---

## 11. Open questions (must be answered during task 1)

1. **Gate tool host.** MCP server (recommended) vs bash script vs `@opencode-ai/plugin`. Confirm opencode's MCP tool-registration shape and that a blocking tool result returns cleanly into the orchestrator's context.
2. **Signing scheme.** Symmetric HMAC (simple, but the tool process holds the same secret) vs asymmetric (app signs with a private key in `userData`; tool verifies with a freely-held public key). Asymmetric is stronger if the tool process is less trusted than the app — decide based on threat model.
3. **Secret provisioning.** How the gate-tool process obtains the verification key without exposing it to the agent as a readable tool/resource. Confirm the chosen host can load it from `userData` out-of-band.
4. **Orchestrator binding.** Exact prompt/tooling change so "STOP AT THE GATE" deterministically calls `submit_for_review` and respects the verdict (including the rejection re-spawn loop). Confirm the orchestrator's tool/permission config permits it.
5. **Checklist rules (`mtf`).** Enumerate the concrete rule set (what counts as a missing prerequisite check, a wrong commit pattern, a bad layer placement) and the artifact shape it parses.
6. **`fs.watch` reliability on Windows.** Confirm behavior for the target platform; finalize the polling fallback interval.
7. **Artifact transport.** Referenced file paths (light queue + confinement, current §7.2 stance) vs inline content (simpler to secure, heavier files). Confirm the default.

---

## 12. Acceptance criteria

- [ ] Calling `submit_for_review` **blocks** the orchestrator until a human decides, then returns `{ status, notes }`.
- [ ] The Review Queue panel lists pending reviews live and shows the two design artifacts **side by side** with a rule-based checklist.
- [ ] **Approve** lets the orchestrator proceed to `builder → validator → scribe`; **reject-with-notes** re-spawns only the flagged design agent with the notes injected.
- [ ] A decision **not** signed by the app is **never** treated as approved (verified by a forged-decision test).
- [ ] Artifact paths are confined: `..`, absolute escapes, and out-of-base symlinks are rejected (adversarial tests pass).
- [ ] Untrusted artifact content renders **inert** — no script execution, no remote loads (CSP + sanitization verified).
- [ ] The gate **fails closed** on timeout, app-closed, malformed request, or invalid signature.
- [ ] Decisions are atomic, idempotent per `id`, archived exactly once, and recorded in an append-only audit log.
- [ ] No regression to existing `config:read/write`, agent, or skill flows; `.gate/` is additive.

---

## 13. Post-implementation fixes (2026-06-26)

A real end-to-end gate test — the gate reviewing its own evolution, as §10's
bootstrapping note anticipated (these first fixes themselves ran **ungated**) —
surfaced two defects that defeated otherwise-valid approvals. Both are now fixed
(191 tests pass), each with unit + E2E regression coverage.

**Bug 1 — archive-before-consume race.** The app wrote a signed decision to
`decisions/<id>.json` and then immediately `archiveReview()` unlinked it (§7.7
single-archiver). The gate tool polls every ≈2 s (§7.3), so it could miss the
live decision entirely and hang until expiry — failing closed despite a valid
approval. **Fix:** new `readDecisionOrArchive(configDir, id)` in
`electron/gate/bus.js` — the consumer reads `decisions/<id>.json` and, on
ENOENT, falls back to `archive/<id>.json`'s `.decision` field (still
signature-verified, so trust is unchanged). Both `gate-tool/gate-mcp-server.js`
and `gate-tool/gate-submit.js` now poll through it. Safe because `archiveReview`
writes the archive atomically **before** unlinking the decision, so there is no
window in which both files are absent.

**Bug 2 — productName/userData mismatch in dev.** The tools derived the secret
directory from the `build.productName` (`"OpenCode Agent Manager"`), but Electron
in dev derives `app.getPath('userData')` from the package `name`
(`"opencode-agent-gui"`). The tool therefore looked in the wrong directory,
never found `gate-secret.key`, and failed **every** decision closed. **Fix:**
(a) `gate:setup-mcp-entry` now embeds `--userDataDir <app.getPath('userData')>`
into the `mcp.gate` args, and the tools use that explicit path when present;
(b) `deriveUserDataDir()` in both tools otherwise probes candidates in order —
package-name dir **first**, productName dir **second** (win32/darwin), single XDG
candidate on linux — and the first directory containing `gate-secret.key` wins.
Only the resolved userData **path** (never the secret bytes) is written to
config, preserving the §7.3 trust model.
```
