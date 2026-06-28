# gate-tool (runtime side)

The runtime half of the Gated Multi-Agent Review Queue. These standalone Node
processes are spawned by the **opencode runtime** (not Electron). They submit a
design-stage review request into the shared `.gate/` filesystem bus and **block**
until the Electron app writes a cryptographically **signed** decision — then
return the verdict. The gate **fails closed**: timeout, a missing/invalid
signature, or the app being closed all resolve to `rejected`.

## Contents

| File | Purpose |
|---|---|
| `gate-mcp-server.js` | JSON-RPC 2.0 stdio MCP server exposing the blocking `submit_for_review` tool. **Preferred host.** |
| `gate-submit.js` | Bash-fallback CLI with the same submit+poll+verify logic, for environments without MCP. |

## submit_for_review tool

The MCP server exposes a single blocking tool. Its `inputSchema`:

| Field | Type | Notes |
|---|---|---|
| `stage` | enum `['design']` | Only the design stage is supported today. |
| `agent` | string | ID of the design agent whose output is under review. |
| `title` | string | Human-readable label shown in the review queue. |
| `artifacts` | array of `{ kind, path }` | `kind` ∈ `'architecture' \| 'figma-spec' \| 'handoff' \| 'other'`; `path` is a string. |
| `checklist` | `'mtf'` \| `null` | Rule-based checklist to auto-run, or `null` for none. |
| `expiresInSeconds` | number | How long to block before failing closed. Default `86400` (24h). |

Required: `stage`, `agent`, `title`, `artifacts`.

Result shape: `{ status: 'approved' | 'rejected', notes: string }`.

Submit-then-poll: one synchronous call writes the request and polls `decisions/`
every 2s, blocking until a signed decision appears or `expiresAt` passes. The
poll reads `decisions/<id>.json` and, if that file was already consumed by the
app's archival step, falls back to `archive/<id>.json`'s `.decision` (via
`readDecisionOrArchive` in `electron/gate/bus.js`) — still signature-verified —
so a valid approval is **never lost** to immediate archival.

Artifact `path`s must be relative to the opencode `configDir`.

## productName → userData path coupling (handled)

The HMAC secret is read from `<userData>/gate-secret.key`, and Electron derives
`userData` differently depending on how the app runs: from the package `name`
(`"opencode-agent-gui"`) in **dev**, but from `build.productName`
(`"OpenCode Agent Manager"`) once **packaged**. The tool resolves this coupling
automatically — you no longer need to hand-edit `PRODUCT_NAME` to switch modes:

1. **Explicit path wins.** The app's **"Setup Gate"** button embeds the real
   `app.getPath('userData')` into the `mcp.gate` args as `--userDataDir <path>`;
   both scripts use that path verbatim when present.
2. **Multi-candidate fallback.** Absent the flag, `deriveUserDataDir()` probes
   candidates in order — the **package-name** dir first, the **productName** dir
   second (win32/darwin), a single XDG candidate on linux — and the first dir
   containing `gate-secret.key` wins.

Only the resolved userData **path** is ever written to config — never the secret
bytes — so the trust model is preserved. (If you rename **both** the package
`name` and `productName`, update `PACKAGE_NAME`/`PRODUCT_NAME` in both scripts.)

`gate-secret.key` candidate locations per platform:

| Platform | Path(s) probed |
|---|---|
| Windows | `%APPDATA%\opencode-agent-gui\gate-secret.key`, then `%APPDATA%\OpenCode Agent Manager\gate-secret.key` |
| macOS | `~/Library/Application Support/opencode-agent-gui/gate-secret.key`, then `.../OpenCode Agent Manager/gate-secret.key` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/opencode-agent-manager/gate-secret.key` |

The app **owns** creation of this key. The tool only ever **reads** it; if it is
absent the tool fails closed (it never creates the key).

## canonical() format note

Signatures are HMAC-SHA256 over the **shared** `electron/gate/security.js`
`canonical()` serialization — a positional JSON array with a fixed field order:

```js
JSON.stringify([schemaVersion, id, status, notes, decidedAt])  // sig excluded
```

Both scripts `require('../electron/gate/security')` so the bytes match the app's
signer exactly. Do **not** re-implement signing here.

## configDir resolution

The opencode `configDir` is read from `<userData>/prefs.json` → `configDir`,
falling back to `~/.config/opencode` (matching `electron/main.js`). All artifact
paths in a request are **relative to this configDir**.

## MCP registration

Register the server with opencode via the app's **"Setup Gate"** button (IPC
handler `gate:setup-mcp-entry`), which writes the MCP server entry pointing at
`gate-tool/gate-mcp-server.js` and embeds the app's real `userData` path as
`--userDataDir` (so the tool reads the right `gate-secret.key` in both dev and
packaged builds — see the coupling note above). Conceptually:

```jsonc
{
  "mcp": {
    "gate": {
      "type": "local",
      "command": ["node", "<abs-path>/gate-tool/gate-mcp-server.js", "--userDataDir", "<abs-path>/userData"],
      "enabled": true
    }
  }
}
```

## Bash fallback usage

```bash
node gate-tool/gate-submit.js \
  --configDir /path/to/opencode/config \
  --stage design \
  --agent architect \
  --title "Review: payments microflow" \
  --artifact-path docs/design/payments.md   --artifact-kind architecture \
  --artifact-path docs/design/figma-spec.md --artifact-kind figma-spec \
  --expires-in 3600
```

Output: line 1 is `approved` or `rejected`; subsequent lines are the decision
notes. Exit code `0` = approved, `1` = rejected/timeout/error.
