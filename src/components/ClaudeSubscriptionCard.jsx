import React, { useState, useEffect, useCallback, useRef } from "react";

const api = window.electronAPI;

// Maps the supervisor state machine to a pill label + colour class.
// (claude-code-subscription-provider.md §9 status pill)
const PILL = {
  stopped: { label: "Stopped", cls: "gray" },
  starting: { label: "Starting…", cls: "amber" },
  running: { label: "Running", cls: "green" },
  "auth-needed": { label: "Auth needed", cls: "amber" },
  crashed: { label: "Crashed", cls: "red" },
};

export default function ClaudeSubscriptionCard() {
  const [descriptor, setDescriptor] = useState(null);
  const [status, setStatus] = useState({ state: "stopped", port: null, models: null });
  const [install, setInstall] = useState({ installed: null, meta: null }); // null = unknown
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  const logRef = useRef(null);

  const refresh = useCallback(() => {
    if (!api?.getWrapperStatus) return;
    api.getWrapperStatus().then(setStatus).catch(() => {});
  }, []);

  const refreshInstall = useCallback(() => {
    if (!api?.getWrapperInstallStatus) return;
    api.getWrapperInstallStatus().then(setInstall).catch(() => {});
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    api.getWrapperDescriptor?.().then(setDescriptor).catch(() => {});
    refreshInstall();
    refresh();
    pollRef.current = setInterval(refresh, 4000);
    return () => clearInterval(pollRef.current);
  }, [refresh, refreshInstall]);

  // Stream install output; auto-scroll the log.
  useEffect(() => {
    if (!api?.onWrapperInstallProgress) return undefined;
    const off = api.onWrapperInstallProgress((line) => {
      setInstallLog((prev) => (prev + line).slice(-8000));
    });
    return off;
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [installLog]);

  const handleInstall = useCallback(async () => {
    if (!api?.installWrapper || installing) return;
    setInstalling(true);
    setInstallLog("");
    try {
      await api.installWrapper();
    } finally {
      setInstalling(false);
      refreshInstall();
    }
  }, [installing, refreshInstall]);

  const handleStart = useCallback(async () => {
    if (!api?.startWrapper || busy) return;
    setBusy(true);
    setStatus((s) => ({ ...s, state: "starting" }));
    try {
      const next = await api.startWrapper({ profile: descriptor?.defaultAuthProfile });
      if (next?.error === "not-installed") {
        refreshInstall();
        setStatus({ state: "stopped" });
      } else {
        setStatus(next);
      }
    } catch {
      /* surfaced on next poll */
    } finally {
      setBusy(false);
    }
  }, [busy, descriptor, refreshInstall]);

  const handleStop = useCallback(async () => {
    if (!api?.stopWrapper || busy) return;
    setBusy(true);
    try {
      setStatus(await api.stopWrapper());
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const pill = PILL[status.state] || PILL.stopped;
  const isRunning = status.state === "running";
  const portLabel = status.port ? `:${status.port}` : "";
  const notInstalled = install.installed === false;
  const models = status.models || descriptor?.models || [];

  return (
    <div className="subscription-card">
      <div className="subscription-card-head">
        <div className="subscription-card-title">
          <span className="subscription-card-name">
            {descriptor?.name || "Claude (subscription)"}
          </span>
          {install.installed !== false && (
            <span className={`status-pill ${pill.cls}`}>
              <span className="status-pill-dot" />
              {pill.label}
              {isRunning && portLabel}
            </span>
          )}
          {notInstalled && (
            <span className="status-pill gray">
              <span className="status-pill-dot" />
              Not installed
            </span>
          )}
        </div>
        <div className="subscription-card-actions">
          {notInstalled ? (
            <button className="btn btn--primary" type="button" onClick={handleInstall} disabled={installing}>
              {installing ? "Installing…" : "Install"}
            </button>
          ) : isRunning ? (
            <button className="btn btn--secondary" type="button" onClick={handleStop} disabled={busy}>
              Stop
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={handleStart} disabled={busy || installing}>
              Start
            </button>
          )}
        </div>
      </div>

      <p className="subscription-card-desc">
        Runs Claude models billed against your Claude Pro/Max subscription via a
        managed local OpenAI-compatible wrapper (loopback only). Assign a
        <span className="mono"> claude-sub/…</span> model to any agent once running.
      </p>

      {notInstalled && (
        <div className="subscription-card-hint warn">
          First use needs a one-time install: clones the pinned upstream wrapper and
          builds a Python virtualenv. Requires <span className="mono">git</span>,
          <span className="mono"> python</span>, and the <span className="mono">claude</span> CLI.
        </div>
      )}

      {(installing || installLog) && notInstalled && (
        <pre className="subscription-card-logs" ref={logRef}>{installLog || "Starting install…"}</pre>
      )}

      {status.state === "auth-needed" && (
        <div className="subscription-card-hint warn">
          Claude CLI isn’t logged in to a subscription. Run
          <span className="mono"> claude auth login </span>
          (type <span className="mono">! claude auth login</span> in your terminal), then Start again.
        </div>
      )}

      {status.state === "crashed" && status.error && (
        <div className="subscription-card-hint err">
          {status.error}
          {status.logsTail?.length > 0 && (
            <pre className="subscription-card-logs">{status.logsTail.join("\n")}</pre>
          )}
        </div>
      )}

      {install.meta?.sha && !notInstalled && (
        <div className="subscription-card-meta">
          Pinned wrapper <span className="mono">{install.meta.sha.slice(0, 10)}</span>
        </div>
      )}

      {models.length > 0 && !notInstalled && (
        <div className="subscription-card-models">
          {models.map((m) => (
            <span key={m.id} className="subscription-model-chip" title={`claude-sub/${m.id}`}>
              {m.name || m.id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
