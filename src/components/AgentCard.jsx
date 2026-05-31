import React from "react";
import ModelDropdown from "./ModelDropdown.jsx";

function CogIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.27 1.27M4.67 11.33L3.4 12.6M12.6 12.6l-1.27-1.27M4.67 4.67L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getBadgeText(modelId) {
  if (!modelId) return "no model";
  if (modelId.includes("/")) return modelId.split("/").pop();
  return modelId.replace(/:latest$/, "");
}

/**
 * Cloud models always use "provider/model-name" — Ollama models never contain a slash.
 * Returns 'cloud' | 'local' | null
 */
const getModelKind = (modelId) => {
  if (!modelId) return null;
  return modelId?.includes("ollama") ? "local" : "cloud";
};

export default function AgentCard({
  agent,
  ollamaModels,
  onModelChange,
  onOpenSettings
}) {
  const badge = getBadgeText(agent.model);
  const modelKind = getModelKind(agent.model);

  return (
    <div className="agent-card">
      {/* ── Row 1: accent square + model badge ── */}
      <div className="agent-card-top">
        <div
          className="agent-color-sq"
          style={{
            backgroundColor: agent.color,
            boxShadow: `0 4px 14px ${agent.color}55, 0 2px 5px ${agent.color}30, inset 0 1px 0 rgba(255,255,255,.2)`
          }}
        />
        <div className="flex gap-x-1">
          <div className="agent-card-badges">
            {agent.mode === "primary" && (
              <span className="agent-badge primary">Primary</span>
            )}
            {modelKind && (
              <span className={`agent-badge ${modelKind}`}>{modelKind}</span>
            )}
          </div>
          <div>{agent.modelKind}</div>
          <button
            type="button"
            className="agent-card-settings-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings?.(agent.id);
            }}
            aria-label={`Open settings for ${agent.displayName}`}
            title="Agent settings"
          >
            <CogIcon size={16} />
          </button>
        </div>
      </div>

      {/* ── Row 2: name + version + description ── */}
      <div className="agent-identity">
        <div className="agent-name-row">
          <span className="agent-name">{agent.displayName}</span>
          {agent.version && (
            <span className="agent-version">{agent.version}</span>
          )}
        </div>
        {agent.description && (
          <p className="agent-description">{agent.description}</p>
        )}
      </div>

      {/* ── Row 3: tool / permission chips ── */}
      {agent.tools && agent.tools.length > 0 && (
        <div className="agent-tools">
          <div className="agent-section-label">Tools & permissions</div>
          <div className="agent-tool-chips">
            {agent.tools.map((t) => (
              <span
                key={t.id}
                className="agent-tool-chip"
                style={{ "--chip-color": t.color }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Row 4: model dropdown ── */}
      <div className="agent-model-row">
        <div className="agent-section-label">Model</div>
        <ModelDropdown
          value={agent.model}
          onChange={(newModel) => onModelChange(agent.id, newModel)}
          ollamaModels={ollamaModels}
        />
      </div>
    </div>
  );
}
