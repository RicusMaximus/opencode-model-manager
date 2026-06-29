import React, { useState, useEffect, useCallback, useRef } from "react";
import Card, { CardHeader } from "./Card.jsx";
import Badge from "./Badge.jsx";

const api = window.electronAPI;

// Status → badge tone + dot.
const PILL = {
  stopped: { label: "Stopped", tone: "neutral", dot: "gray" },
  starting: { label: "Starting…", tone: "yellow", dot: "loading" },
  running: { label: "Running", tone: "green", dot: "green" },
  "auth-needed": { label: "Auth needed", tone: "yellow", dot: "yellow" },
  crashed: { label: "Crashed", tone: "red", dot: "red" }
};

// Compact Claude (subscription) wrapper summary for the left sidebar — status +
// a single Start/Stop/Install control. Full details live in the Models flow.
export default function SubscriptionSummary() {
  const [descriptor, setDescriptor] = useState(null);
  const [status, setStatus] = useState({ state: "stopped", port: null });
  const [installed, setInstalled] = useState(null); // null = unknown
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const refresh = useCallback(() => {
    api
      ?.getWrapperStatus?.()
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    api
      .getWrapperDescriptor?.()
      .then(setDescriptor)
      .catch(() => {});
    api
      .getWrapperInstallStatus?.()
      .then((s) => setInstalled(!!s?.installed))
      .catch(() => {});
    refresh();
    pollRef.current = setInterval(refresh, 4000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus((s) => ({ ...s, state: "starting" }));
    try {
      const next = await api.startWrapper({
        profile: descriptor?.defaultAuthProfile
      });
      if (next?.error === "not-installed") setInstalled(false);
      else setStatus(next);
    } finally {
      setBusy(false);
    }
  }, [busy, descriptor]);

  const stop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await api.stopWrapper());
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const install = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.installWrapper();
      const s = await api.getWrapperInstallStatus();
      setInstalled(!!s?.installed);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const pill = PILL[status.state] || PILL.stopped;
  const isRunning = status.state === "running";
  const notInstalled = installed === false;

  let action;
  if (notInstalled) {
    action = (
      <button
        className="btn btn--xs btn--primary"
        type="button"
        onClick={install}
        disabled={busy}
      >
        {busy ? "Installing…" : "Install"}
      </button>
    );
  } else if (isRunning) {
    action = (
      <button
        className="btn btn--xs btn--secondary"
        type="button"
        onClick={stop}
        disabled={busy}
      >
        Stop
      </button>
    );
  } else {
    action = (
      <button
        className="btn btn--xs btn--primary"
        type="button"
        onClick={start}
        disabled={busy}
      >
        Start
      </button>
    );
  }

  return (
    <Card elevation={1} size="sm" className="subscription-summary">
      <CardHeader title="Claude (subscription)" />

      <div className="flex items-center justify-between gap-x-2">
        {notInstalled ? (
          <Badge size="sm" tone="neutral" dot="gray">
            Not installed
          </Badge>
        ) : (
          <Badge size="sm" tone={pill.tone} dot={pill.dot}>
            {pill.label}
            {isRunning && status.port ? ` :${status.port}` : ""}
          </Badge>
        )}
        {action}
      </div>
    </Card>
  );
}
