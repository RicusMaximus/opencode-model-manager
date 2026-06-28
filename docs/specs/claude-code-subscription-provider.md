# SDD Design Spec — Claude Code Subscription Provider (OpenAI-Wrapper)

| | |
|---|---|
| **Status** | Draft — ready for orchestrator |
| **Date** | 2026-06-28 |
| **Target component** | OpenCode Agent Manager (Electron + React) — managed local OpenAI-compatible provider backed by a Claude Code subscription |
| **Primary surfaces** | new provider registry entry, wrapper process supervisor (spawn/health/stop), Models screen "Claude (subscription)" source, `opencode.jsonc` provider block writer, `doctor` checks, `oam` CLI surface |
| **Owner** | Rico Robinson |
| **Implementation** | NOT in scope — design hand-off for an agent orchestrator |
| **Depends on** | `project-config-cli-launcher.md` (cwd-scoped project semantics), `model-aware-reasoning-effort.md` (model registry + `provider/model-id` convention), `mcp-secret-scaffolding.md` (auth-aware input descriptors, gitignore/secret discipline) |
| **Upstream** | [`RichardAtCT/claude-code-openai-wrapper`](https://github.com/RichardAtCT/claude-code-openai-wrapper) — FastAPI server exposing OpenAI-compatible endpoints over the Claude Agent SDK / bundled Claude Code CLI |

---

## 1. Goal

Let OpenCode agents run on Claude models **billed against the user's Claude Pro/Max subscription** (via `claude auth login`) instead of metered Anthropic API tokens. We do this by managing a local instance of `claude-code-openai-wrapper` — an OpenAI-compatible shim — and registering it in OpenCode as a custom provider. The manager owns the wrapper's lifecycle, auth state, and config wiring so the user never hand-edits a provider block or babysits a uvicorn process.

---

## 2. Problem

- OpenCode talks to models through **provider endpoints**; the Anthropic provider bills per-token against an API key. There is no first-class "use my Claude subscription" path.
- The wrapper closes that gap: it speaks `POST /v1/chat/completions` (OpenAI shape) on `http://localhost:8000` and translates to the Claude Agent SDK, which authenticates with the **subscription** when started from a `claude auth login` session.
- But the wrapper is a separate Python service with its own runtime (Python 3.10+, Poetry), its own auth state, and its own failure modes. Asking the user to manage that by hand defeats the point of the manager.
- Naively pointing OpenCode at `localhost:8000` is fragile: if the process isn't up, the model silently fails; if auth lapses, every agent call errors opaquely. The manager must own **process + auth + config** as one unit.

---

## 3. Core concept: the wrapper as a *managed local provider*

We model the wrapper as a single OpenCode **custom provider** (`claude-sub`) whose `baseURL` points at a manager-supervised local process. Three concerns, owned by the manager:

| Concern | Owned by | Surfaced in |
|---|---|---|
| **Process** — is the wrapper running, on which port, healthy? | Wrapper supervisor (spawn / health-poll / stop) | Models screen status pill, `doctor` |
| **Auth** — is the Claude CLI logged in to a subscription (not API key)? | Auth probe against `/v1/auth/status` + `claude` CLI | Models screen, `doctor` |
| **Config** — is `opencode.jsonc` wired to the local `baseURL` with the right models? | Provider block writer | `opencode.jsonc` (global) |

The provider is **local-only and loopback-bound** — no secret file is generated for the happy path (subscription auth lives in the Claude CLI's own credential store, an `external` input per `mcp-secret-scaffolding.md` §3). An API-key fallback profile *does* produce a secret.

---

## 4. Provider descriptor (extends the MCP input-descriptor model)

Reuse the auth-aware Input Descriptor pattern from `mcp-secret-scaffolding.md`. The wrapper provider declares its inputs per auth profile:

```ts
interface WrapperProviderDescriptor {
  id: "claude-sub";
  npm: "@ai-sdk/openai-compatible";        // OpenCode loads OpenAI-compatible providers via this
  defaultBaseURL: "http://localhost:8000/v1";
  process: WrapperProcessSpec;             // how the manager launches the shim
  defaultAuthProfile: "subscription";
  authProfiles: Record<string, AuthProfile>;
  models: WrapperModel[];                   // see §6
}

interface WrapperProcessSpec {
  runner: "poetry" | "uvx" | "docker";     // how to start it; poetry is upstream default
  repoPath?: string;                        // clone location when runner=poetry
  command: string[];                        // e.g. ["poetry","run","uvicorn","src.main:app","--port","${PORT}"]
  port: number;                             // default 8000; manager picks a free port if taken
  env: Record<string,string>;              // PORT, MAX_TIMEOUT, CLAUDE_CWD, DEFAULT_MODEL, FAST_MODEL, API_KEY?
  health: { path: "/health"; authStatus: "/v1/auth/status"; timeoutMs: 5000 };
  startupTimeoutMs: 30000;
}

// authProfiles reuse InputSpec from mcp-secret-scaffolding.md §4
{
  "subscription": { "inputs": [
    { "kind": "external", "via": "command",
      "note": "claude auth login (Pro/Max subscription)",
      "check": { "type": "command", "target": "claude auth status" } }
  ]},
  "api-key": { "inputs": [
    { "kind": "secret", "envVar": "ANTHROPIC_API_KEY", "fileName": "anthropic-api-key",
      "required": true, "placeholder": "REPLACE_ME__anthropic_api_key",
      "source": "Anthropic Console", "validate": "^sk-ant-" }
  ]},
  "client-guard": { "inputs": [   // optional: protect the local endpoint itself
    { "kind": "secret", "envVar": "API_KEY", "fileName": "wrapper-client-key",
      "required": false, "placeholder": "REPLACE_ME__local_wrapper_guard",
      "source": "self-generated" }
  ]}
}
```

> **Auth profile semantics.** `subscription` is the whole point — no secret, subscription billing. `api-key` is the escape hatch (metered API, defeats the goal but kept for parity). `client-guard` is orthogonal: it sets the wrapper's own `API_KEY` so only this manager can call the loopback endpoint. The two can compose (`subscription` + `client-guard`).

---

## 5. Environment variables we drive (from upstream)

| Var | Purpose | Manager default |
|---|---|---|
| `PORT` | wrapper listen port | `8000` (auto-bump if busy) |
| `MAX_TIMEOUT` | request timeout (s) | `300` |
| `CLAUDE_CWD` | working dir for Claude Code | the **active project** dir (per `project-config-cli-launcher.md`); else isolated temp |
| `DEFAULT_MODEL` | default model alias | auto-resolves latest Sonnet (leave unset) |
| `FAST_MODEL` | speed alias | `claude-haiku-4-5-20251001` |
| `API_KEY` | optional client guard | only when `client-guard` profile active |
| `ANTHROPIC_API_KEY` | direct API key | only when `api-key` profile active (defeats subscription goal — warn) |

> **Subscription vs API-key conflict (hard rule):** when the goal is subscription billing, `ANTHROPIC_API_KEY` **must be absent** from the wrapper's environment — its presence makes the SDK bill the API. The supervisor scrubs it from the spawned env unless the active profile is `api-key`, and `doctor` flags it if leaked.

---

## 6. Models exposed

OpenCode needs model IDs under the provider, written as `claude-sub/<model>` per the `provider/model-id` convention (`model-aware-reasoning-effort.md` §contract, `AGENTS.md`). Seed from the wrapper's `GET /v1/models`, fall back to a static list when the wrapper is down:

```jsonc
"models": [
  { "id": "claude-opus-4-8",            "name": "Opus 4.8 (subscription)" },
  { "id": "claude-sonnet-4-6",          "name": "Sonnet 4.6 (subscription)" },
  { "id": "claude-haiku-4-5-20251001",  "name": "Haiku 4.5 (subscription)" }
]
```

These feed the Models screen as a distinct source — **"Claude (subscription)"** — alongside `CLOUD_MODELS` and `ollamaModels` (`model-aware-reasoning-effort.md` §6). Reasoning-effort capability resolves through the **existing** registry by family (`anthropic/*` → Extended Thinking mechanism); the provider prefix is `claude-sub` but the capability match keys on model family, so add a registry alias mapping `claude-sub/<id>` → the Anthropic family rule. No new effort UI.

---

## 7. Generated `opencode.jsonc` provider block

Written to the **global** config (deep-merged, atomic, round-tripping unknown fields — `AGENTS.md` invariants). Project configs reference models by ID only; the provider definition lives globally.

```jsonc
{
  "provider": {
    "claude-sub": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Claude (subscription)",
      "options": {
        "baseURL": "http://localhost:8000/v1"
        // when client-guard active:
        // "apiKey": "{file:./.opencode-secrets/wrapper-client-key}"
      },
      "models": {
        "claude-opus-4-8":           { "name": "Opus 4.8 (subscription)" },
        "claude-sonnet-4-6":         { "name": "Sonnet 4.6 (subscription)" },
        "claude-haiku-4-5-20251001": { "name": "Haiku 4.5 (subscription)" }
      }
    }
  }
}
```

> The `baseURL` port is templated from the supervisor's actual bound port. If the supervisor auto-bumps off 8000, the writer **rewrites `baseURL`** so config never drifts from the live process. `apiKey` is only emitted (as a `{file:...}` ref) under `client-guard`, reusing the secret discipline from `mcp-secret-scaffolding.md` §7–8.

---

## 8. Wrapper supervisor — lifecycle (`ensureWrapper()`)

```
ensureWrapper(activeProfile, projectDir):
    if processHandle && healthy(): return processHandle      # idempotent
    profile = activeProfile ?? descriptor.defaultAuthProfile
    assertPrereqs()                                          # python>=3.10, poetry|uvx|docker, claude CLI
    if profile == "subscription":
        requireClaudeLogin()                                # `claude auth status` → subscription, not key
        env = scrub(env, "ANTHROPIC_API_KEY")               # §5 hard rule
    if profile == "api-key":
        env.ANTHROPIC_API_KEY = readSecret("anthropic-api-key")
    if profile includes "client-guard":
        env.API_KEY = ensureSecret("wrapper-client-key")    # generate if missing
    port = firstFreePort(descriptor.process.port)
    env.PORT = port; env.CLAUDE_CWD = projectDir ?? tempIsolated()
    handle = spawn(command, env)                            # detached child, captured stdout/stderr ring buffer
    waitForHealth("/health", startupTimeoutMs)              # else kill + surface logs
    writeProviderBlock(baseURL = `http://localhost:${port}/v1`)
    return handle

stopWrapper(): graceful SIGTERM → SIGKILL after grace; clear handle
```

Process rules:
1. **Single instance** per manager — refuse to spawn a second; reuse the healthy handle.
2. **Detached + supervised:** the manager owns start/stop; the wrapper does **not** outlive the app unless the user pins it (`oam wrapper start --detach`).
3. **Crash handling:** non-zero exit → status pill goes red, last N log lines retained, optional one-shot auto-restart (off by default; no restart storms).
4. **Port discipline:** loopback only (`127.0.0.1`), never `0.0.0.0`; auto-bump on conflict and rewrite `baseURL`.
5. **Shutdown:** stop the wrapper on app quit unless detached.

---

## 9. Models screen integration

- New source group **"Claude (subscription)"** with a live **status pill**: `● Running :PORT` / `○ Stopped` / `⚠ Auth needed` / `✗ Crashed`.
- Start/Stop control bound to `ensureWrapper`/`stopWrapper`.
- "Auth needed" links to the remediation: run `claude auth login` (suggest the `! claude auth login` in-session form per session guidance, or a button that shells it).
- Model rows render like any cloud model; selecting one writes `agent.<id>.model = "claude-sub/<id>"`.
- Effort control derives from the family alias (§6) — no special-casing in the effort component.

---

## 10. `doctor` checks

- **prereqs:** `python --version` ≥ 3.10 · chosen runner present (`poetry`/`uvx`/`docker`) · `claude` CLI on PATH.
- **process:** TCP connect to bound port · `GET /health` 200 within timeout.
- **auth (subscription):** `GET /v1/auth/status` reports authenticated **via subscription/CLI**, not API key · `ANTHROPIC_API_KEY` **absent** from spawned env (else warn: "billing to API, not subscription").
- **auth (api-key):** secret file present · ≠ placeholder · matches `^sk-ant-`.
- **config:** `opencode.jsonc` `provider.claude-sub.options.baseURL` equals the live bound port (drift check) · model IDs in config exist in `/v1/models` (warn on stale).
- **client-guard (if active):** wrapper started with `API_KEY` set · config `apiKey` `{file:...}` resolves · file ≠ placeholder.

---

## 11. CLI surface (`oam`)

```
oam wrapper install                       # clone upstream + poetry install (or pull docker image)
oam wrapper start   [--profile subscription|api-key] [--detach] [--cwd <dir>]
oam wrapper stop
oam wrapper status                        # process + auth + bound port + config-drift
oam provider add claude-sub               # write/repair the opencode.jsonc provider block
oam doctor                                # §10 checks
```

---

## 12. Known limitations (inherited from the wrapper) — surface, don't hide

From upstream's documented constraints, with the manager's stance on each:

| Upstream limitation | Manager stance |
|---|---|
| **Function calling not supported** (tools activate automatically, not via OpenAI `tools`) | Surface in the provider's model capability flags; agents relying on OpenCode-driven tool schemas may misbehave. Document prominently. |
| **`temperature`/`top_p`/`max_tokens` not yet mapped** | These OpenCode options are no-ops through this provider; `doctor` warns if a `claude-sub` agent sets them. |
| **Images → text placeholders** | Multimodal agents degrade; flag on model rows. |
| **`n > 1` unsupported** | N/A for OpenCode's single-completion path; assert `n=1`. |
| **Subscription rate/usage limits** | Subscription has its own quotas; a 429/limit from the wrapper maps to a clear "subscription limit reached" status, not a generic error. |

> **Trust note (hard requirement before adoption):** this provider routes the user's prompts through a **third-party local shim**. It runs on loopback only, but the orchestrator must (a) pin a reviewed upstream commit/tag rather than floating `main`, (b) optionally enable `client-guard` so nothing else on the host can call the endpoint, and (c) never expose the port beyond `127.0.0.1`. Treat the cloned repo as a vendored dependency with a recorded SHA.

---

## 13. Edge cases

- **Port 8000 already in use** → auto-bump, rewrite `baseURL`, log the chosen port.
- **Claude CLI not logged in** → `start` refuses with the exact `claude auth login` remediation; status pill = "Auth needed".
- **`ANTHROPIC_API_KEY` set in the user's global shell** → scrubbed from the spawned env under `subscription`; `doctor` warns it was present so the user knows why API wasn't billed.
- **Wrapper updated upstream / breaking change** → pinned SHA insulates; `oam wrapper install` is explicit, never silent.
- **App quits while a request is in flight** → graceful SIGTERM with grace period; in-flight request may 503, agent retries.
- **Two manager windows** → single-instance lock on the supervisor; second window attaches to the running handle rather than spawning.
- **Non-Python host / Poetry absent** → offer the `docker` or `uvx` runner; `doctor` blocks `start` with the missing-prereq list instead of a cryptic spawn error.

---

## 14. Future extensions

- **Bedrock / Vertex profiles:** the wrapper also supports AWS Bedrock and Google Vertex auth — add as further `authProfiles` (both `external`, validated by their respective credential checks) for enterprise routing.
- **Per-project wrapper instances:** one supervised wrapper per active project with distinct `CLAUDE_CWD`, so Claude Code tool calls scope to the right repo (ties into `project-config-cli-launcher.md`).
- **Usage telemetry:** the wrapper returns SDK cost/token data per response — surface a "subscription usage this session" readout to track against plan limits.
- **Auto-pin updater:** a guarded "update wrapper" flow that bumps the pinned SHA only after a changelog/diff review gate (reuse the design→build approval gate).
