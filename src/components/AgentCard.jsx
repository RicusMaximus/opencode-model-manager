import React from "react";
import Badge from "./Badge.jsx";

function EditIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M10.8 2.4a1.4 1.4 0 0 1 2 2L4.7 12.5l-2.7 0.7 0.7-2.7 8.1-8.1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M9.4 3.8l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Cloud models always use "provider/model-name" — Ollama models never contain a slash.
 * Returns 'cloud' | 'local' | null
 */
const getModelKind = (modelId) => {
  if (!modelId) return null;
  return modelId.includes("ollama") ? "local" : "cloud";
};

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Built-in tools surfaced as chips. Skills (the `skill` tool) are shown in their
// own section, and MCP servers come from the `<server>*` wildcard tool keys.
const BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "glob", "webfetch", "todowrite"];

// MCP reachability → the whole badge takes the status colour. While the first
// probe is still in flight the badge shows a pulsing loading dot.
//   green  = reachable · yellow = up but unauthenticated · red = unreachable
//   neutral = unknown / disabled · neutral + loading dot = connecting
function mcpBadge(status, ready) {
  if (status === undefined) {
    return ready
      ? { tone: "neutral", dot: "gray", label: "not configured" }
      : { tone: "neutral", dot: "loading", label: "connecting…" };
  }
  switch (status) {
    case "reachable": return { tone: "green", dot: "green", label: "reachable" };
    case "unauthenticated": return { tone: "yellow", dot: "yellow", label: "running · unauthenticated" };
    case "unreachable": return { tone: "red", dot: "red", label: "unreachable" };
    case "disabled": return { tone: "neutral", dot: "gray", label: "disabled" };
    default: return { tone: "neutral", dot: "gray", label: "reachability unknown" };
  }
}

export default function AgentCard({ agent, onOpenSettings, skills = [], mcpStatus = {}, mcpReady = false }) {
  const modelKind = getModelKind(agent.model);
  const modeLabel = agent.mode ? titleCase(agent.mode) : null;

  const toolsMap =
    agent.tools && typeof agent.tools === "object" && !Array.isArray(agent.tools) ? agent.tools : {};

  // Skills live under permission.skill = { <skillId>: 'allow' }
  const skillIds = Object.entries(agent.permission?.skill || {})
    .filter(([, v]) => v === "allow")
    .map(([id]) => id);
  const skillName = (id) => skills.find((s) => s.id === id)?.name || id;

  // Built-in tools that are enabled.
  const enabledTools = BUILTIN_TOOLS.filter((t) => toolsMap[t] === true);

  // MCP servers from `<server>*` keys that are enabled.
  const mcpServers = Object.keys(toolsMap)
    .filter((k) => k.endsWith("*") && toolsMap[k] === true)
    .map((k) => k.slice(0, -1));

  const modelText = agent.model || "Inherits global model";

  return (
    <div className="agent-card">
      {/* ── Top: accent square · badges + edit ── */}
      <div className="agent-card-top">
        <div
          className="agent-color-sq"
          style={{
            backgroundColor: agent.color,
            boxShadow: `0 4px 14px ${agent.color}55, 0 2px 5px ${agent.color}30, inset 0 1px 0 rgba(255,255,255,.2)`
          }}
        />
        <div className="agent-card-top-right">
          <div className="agent-card-badges">
            {modelKind && (
              <Badge size="md" tone={modelKind === "local" ? "green" : "blue"}>
                {modelKind}
              </Badge>
            )}
            {modeLabel && <Badge size="md" tone="gold">{modeLabel}</Badge>}
          </div>
          <button
            type="button"
            className="btn btn--icon btn--icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings?.(agent.id);
            }}
            aria-label={`Edit ${agent.displayName}`}
            title="Edit agent"
          >
            <EditIcon size={16} />
          </button>
        </div>
      </div>

      {/* ── Identity ── */}
      <div className="agent-identity">
        <div className="agent-name-row">
          <span className="agent-name">{agent.displayName}</span>
          {agent.version && <span className="agent-version">{agent.version}</span>}
        </div>
        {agent.description && <p className="agent-description">{agent.description}</p>}
      </div>

      {/* ── Summary: model · skills · tools · MCP ── */}
      <div className="agent-summary">
        <div className="agent-summary-row">
          <span className="agent-section-label">Model</span>
          <span className="agent-model-text">{modelText}</span>
        </div>

        {skillIds.length > 0 && (
          <div className="agent-summary-row">
            <span className="agent-section-label">Skills</span>
            <div className="agent-badge-list">
              {skillIds.map((id) => (
                <Badge key={id} size="sm" tone="violet" title={id}>
                  {skillName(id)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {enabledTools.length > 0 && (
          <div className="agent-summary-row">
            <span className="agent-section-label">Tools</span>
            <div className="agent-badge-list">
              {enabledTools.map((t) => (
                <Badge key={t} size="sm" tone="blue">{t}</Badge>
              ))}
            </div>
          </div>
        )}

        {mcpServers.length > 0 && (
          <div className="agent-summary-row">
            <span className="agent-section-label">MCP servers</span>
            <div className="agent-badge-list">
              {mcpServers.map((id) => {
                const b = mcpBadge(mcpStatus[id], mcpReady);
                return (
                  <Badge key={id} size="sm" tone={b.tone} dot={b.dot} title={`${id} — ${b.label}`}>
                    {id}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
