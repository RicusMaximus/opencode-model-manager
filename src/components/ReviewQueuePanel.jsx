import React, { useState, useEffect, useCallback, useRef } from "react";
import { runMtfChecklist } from "../gate/checklist.js";

const api = window.electronAPI;

// ── Small inline icons (style-consistent with the rest of the app) ──────────
function RefreshIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M13 8a5 5 0 1 1-1.46-3.54M13 2v3h-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GateIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M2 6 8 3l6 3v1H2V6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 8v4M6 8v4M10 8v4M12.5 8v4M2 13h12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Time helpers ────────────────────────────────────────────────────────────
function formatAge(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatCountdown(iso) {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const secs = Math.floor((target - Date.now()) / 1000);
  if (secs <= 0) return "expired";
  if (secs < 60) return `${secs}s left`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h left`;
  const days = Math.floor(hrs / 24);
  return `${days}d left`;
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Pick the text the checklist runs against: first artifact with non-null content.
function pickChecklistText(artifacts) {
  if (!Array.isArray(artifacts)) return "";
  const first = artifacts.find(
    (a) => typeof a?.content === "string" && a.content.length > 0
  );
  return first ? first.content : "";
}

export default function ReviewQueuePanel() {
  const [view, setView] = useState("queue"); // 'queue' | 'history'
  const [reviews, setReviews] = useState([]);
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedReview, setSelectedReview] = useState(null); // { request, artifacts }
  const [checklistResults, setChecklistResults] = useState([]);

  const [notes, setNotes] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState(null);

  const [setupStatus, setSetupStatus] = useState(null); // { ok, message }

  // Keep the latest selectedId reachable from event callbacks without
  // re-subscribing on every selection change.
  const selectedIdRef = useRef(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedReview(null);
    setChecklistResults([]);
    setNotes("");
    setDecisionError(null);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchQueue = useCallback(() => {
    if (!api) return;
    setLoading(true);
    api
      .listReviews()
      .then((data) => setReviews(data?.reviews || []))
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchArchive = useCallback(() => {
    if (!api) return;
    setLoading(true);
    api
      .listArchivedReviews()
      .then((data) => setArchived(data?.reviews || []))
      .catch(() => setArchived([]))
      .finally(() => setLoading(false));
  }, []);

  // ── Mount: initial load + live subscription ─────────────────────────────────
  useEffect(() => {
    if (!api) return undefined;

    fetchQueue();

    const unsubscribe = api.onReviewUpdate((evt) => {
      // Any queue change → refresh the list.
      fetchQueue();
      // If the currently-open review was just decided, drop the selection.
      if (
        evt?.type === "decision-made" &&
        evt.id &&
        evt.id === selectedIdRef.current
      ) {
        clearSelection();
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [fetchQueue, clearSelection]);

  // Load archive lazily when switching to the history view.
  useEffect(() => {
    if (view === "history") fetchArchive();
  }, [view, fetchArchive]);

  // ── Selecting a review ──────────────────────────────────────────────────────
  const handleSelect = useCallback((item) => {
    if (!api) return;
    setSelectedId(item.id);
    setSelectedReview(null);
    setChecklistResults([]);
    setNotes("");
    setDecisionError(null);

    api
      .readReview(item.id)
      .then((data) => {
        if (!data || data.error) {
          setSelectedReview({ request: null, artifacts: [], error: data?.error });
          setChecklistResults(runMtfChecklist(""));
          return;
        }
        setSelectedReview(data);
        setChecklistResults(runMtfChecklist(pickChecklistText(data.artifacts)));
      })
      .catch(() => {
        setSelectedReview({ request: null, artifacts: [], error: "unavailable" });
        setChecklistResults(runMtfChecklist(""));
      });
  }, []);

  // ── Decisions ───────────────────────────────────────────────────────────────
  const submitDecision = useCallback(
    (status) => {
      if (!api || !selectedId || deciding) return;
      setDeciding(true);
      setDecisionError(null);
      api
        .decideReview({ id: selectedId, status, notes })
        .then((res) => {
          if (res?.success) {
            // The onReviewUpdate push will refresh the list; clear the selection now.
            clearSelection();
          } else {
            setDecisionError(res?.error || "Decision failed.");
          }
        })
        .catch((err) => setDecisionError(String(err?.message || err)))
        .finally(() => setDeciding(false));
    },
    [selectedId, notes, deciding, clearSelection]
  );

  const handleSetupGate = useCallback(() => {
    if (!api) return;
    setSetupStatus({ ok: null, message: "Setting up…" });
    api
      .setupGateMcpEntry()
      .then((res) => {
        if (res?.success) {
          setSetupStatus({
            ok: true,
            message: res.serverPath
              ? `Gate MCP entry ready: ${res.serverPath}`
              : "Gate MCP entry ready."
          });
        } else {
          setSetupStatus({ ok: false, message: res?.error || "Setup failed." });
        }
      })
      .catch((err) =>
        setSetupStatus({ ok: false, message: String(err?.message || err) })
      );
  }, []);

  // ── Browser-only fallback (npm run dev, no Electron) ─────────────────────────
  if (!api) {
    return (
      <div className="review-queue-panel">
        <div className="rq-toolbar">
          <h1 className="rq-heading">Review Queue</h1>
        </div>
        <div className="rq-empty">
          <p>
            The Review Queue requires the desktop app. Electron APIs are not
            available in browser-only dev mode.
          </p>
        </div>
      </div>
    );
  }

  const artifacts = selectedReview?.artifacts || [];
  const selectedQueueItem = reviews.find((r) => r.id === selectedId) || null;
  const isExpiredSelection = !!selectedQueueItem?.isExpired;
  const canReject = notes.trim().length > 0;

  return (
    <div className="review-queue-panel">
      {/* Toolbar */}
      <div className="rq-toolbar">
        <h1 className="rq-heading">Review Queue</h1>
        <div className="rq-toolbar-actions">
          <div className="rq-view-toggle" role="tablist" aria-label="Queue or history">
            <button
              type="button"
              role="tab"
              aria-selected={view === "queue"}
              className={`rq-toggle-btn${view === "queue" ? " active" : ""}`}
              onClick={() => setView("queue")}
            >
              Queue
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "history"}
              className={`rq-toggle-btn${view === "history" ? " active" : ""}`}
              onClick={() => setView("history")}
            >
              History
            </button>
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => (view === "history" ? fetchArchive() : fetchQueue())}
          >
            <RefreshIcon size={16} />
            Refresh
          </button>
          <button type="button" className="btn btn--secondary" onClick={handleSetupGate}>
            <GateIcon size={16} />
            Setup Gate
          </button>
        </div>
      </div>

      {setupStatus && (
        <div
          className={`rq-setup-status${
            setupStatus.ok === false ? " error" : setupStatus.ok ? " ok" : ""
          }`}
        >
          {setupStatus.message}
        </div>
      )}

      {/* Body: list (left) + detail (right) */}
      <div className="rq-body">
        {/* Left: list */}
        <div className="rq-list">
          {view === "queue" ? (
            reviews.length === 0 ? (
              <div className="rq-empty">
                <p>{loading ? "Loading reviews…" : "No pending reviews."}</p>
              </div>
            ) : (
              reviews.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rq-item${item.id === selectedId ? " selected" : ""}${
                    item.isExpired ? " expired" : ""
                  }`}
                  onClick={() => handleSelect(item)}
                >
                  <div className="rq-item-top">
                    <span className="rq-item-title">{item.title || item.id}</span>
                    <span className="rq-badge rq-badge--pending">Pending</span>
                  </div>
                  <div className="rq-item-meta">
                    <span className="rq-item-agent">{item.agent}</span>
                    <span className="rq-item-stage">{item.stage}</span>
                  </div>
                  <div className="rq-item-meta">
                    <span className="rq-item-age">{formatAge(item.createdAt)}</span>
                    {item.isExpired ? (
                      <span className="rq-badge rq-badge--expired">Expired</span>
                    ) : (
                      <span className="rq-item-expiry">
                        {formatCountdown(item.expiresAt)}
                      </span>
                    )}
                  </div>
                  {Array.isArray(item.artifactKinds) &&
                    item.artifactKinds.length > 0 && (
                      <div className="rq-item-kinds">
                        {item.artifactKinds.map((k) => (
                          <span key={k} className="rq-kind-tag">
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                </button>
              ))
            )
          ) : archived.length === 0 ? (
            <div className="rq-empty">
              <p>{loading ? "Loading history…" : "No archived reviews."}</p>
            </div>
          ) : (
            archived.map((item) => (
              <div key={item.id} className="rq-item rq-item--history">
                <div className="rq-item-top">
                  <span className="rq-item-title">{item.title || item.id}</span>
                  <span
                    className={`rq-badge rq-badge--${
                      item.status === "approved" ? "approved" : "rejected"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
                <div className="rq-item-meta">
                  <span className="rq-item-agent">{item.agent}</span>
                  <span className="rq-item-age">
                    {formatTimestamp(item.decidedAt)}
                  </span>
                </div>
                {item.notes && <p className="rq-item-notes">{item.notes}</p>}
              </div>
            ))
          )}
        </div>

        {/* Right: detail */}
        <div className="rq-detail">
          {view === "history" ? (
            <div className="rq-empty">
              <p>Select the Queue tab to review and decide on pending items.</p>
            </div>
          ) : !selectedId ? (
            <div className="rq-empty">
              <p>Select a review to inspect its artifacts and checklist.</p>
            </div>
          ) : !selectedReview ? (
            <div className="rq-empty">
              <p>Loading review…</p>
            </div>
          ) : selectedReview.error ? (
            <div className="rq-empty">
              <p>Could not load this review ({selectedReview.error}).</p>
            </div>
          ) : (
            <>
              <div className="rq-detail-header">
                <h2 className="rq-detail-title">
                  {selectedReview.request?.title || selectedId}
                </h2>
                <div className="rq-detail-sub">
                  <span>{selectedReview.request?.agent}</span>
                  <span>{selectedReview.request?.stage}</span>
                </div>
              </div>

              {/* Artifacts rendered SIDE BY SIDE (plain text only — never HTML) */}
              {artifacts.length === 0 ? (
                <div className="rq-artifact-view">
                  <div className="rq-empty">
                    <p>This review has no artifacts.</p>
                  </div>
                </div>
              ) : (
                <div
                  className="rq-artifact-split"
                  aria-label="Design artifacts (side by side)"
                >
                  {artifacts.map((art, idx) => (
                    <section
                      key={`${art.kind}-${idx}`}
                      className="rq-artifact-pane"
                      aria-label={`${art.kind || "artifact"} artifact`}
                    >
                      <header className="rq-artifact-pane-header">
                        <span className="rq-artifact-pane-kind">
                          {art.kind || "artifact"}
                        </span>
                        {art.path && (
                          <span className="rq-artifact-pane-path" title={art.path}>
                            {art.path}
                          </span>
                        )}
                      </header>
                      <div className="rq-artifact-pane-body">
                        {art.content == null ? (
                          <div className="rq-artifact-unavailable">
                            {art.error === "artifact-too-large"
                              ? "Artifact too large to display."
                              : art.error === "path-confined"
                              ? "Artifact path rejected (outside the allowed directory)."
                              : "Artifact unavailable."}
                            {art.path && (
                              <span className="rq-artifact-path">{art.path}</span>
                            )}
                          </div>
                        ) : (
                          <pre className="rq-artifact-pre">{art.content}</pre>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              {/* Checklist */}
              {checklistResults.length > 0 && (
                <div className="rq-checklist">
                  <h3 className="rq-checklist-heading">MTF Checklist</h3>
                  <ul className="rq-checklist-list">
                    {checklistResults.map((r) => (
                      <li key={r.id} className={`rq-check rq-check--${r.level}`}>
                        <span className="rq-check-level">{r.level}</span>
                        <span className="rq-check-body">
                          <span className="rq-check-name">
                            {r.id} · {r.name}
                          </span>
                          <span className="rq-check-detail">{r.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="rq-actions">
                <label className="rq-notes-label" htmlFor="rq-notes">
                  Notes (required to reject)
                </label>
                <textarea
                  id="rq-notes"
                  className="rq-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add review notes or rejection reasons…"
                  rows={4}
                />

                {decisionError && (
                  <div className="rq-decision-error" role="alert">
                    {decisionError}
                  </div>
                )}

                {isExpiredSelection && (
                  <div className="rq-decision-error" role="alert">
                    This review has expired and can no longer be decided.
                  </div>
                )}

                <div className="rq-action-buttons">
                  <button
                    type="button"
                    className="btn btn--save"
                    disabled={deciding || isExpiredSelection}
                    onClick={() => submitDecision("approved")}
                  >
                    {deciding ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--destructive"
                    disabled={deciding || isExpiredSelection || !canReject}
                    onClick={() => submitDecision("rejected")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
