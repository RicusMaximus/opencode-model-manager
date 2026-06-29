import React from "react";
import AgentCard from "./AgentCard.jsx";

function PlusIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path
        d="M7 2V12M2 7H12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AgentPanel({
  agents,
  onOpenSettings,
  onCreateAgent,
  skills = [],
  mcpStatus = {},
  mcpReady = false
}) {
  return (
    <div className="agent-panel">
      {/* Section header */}
      <div className="panel-header">
        <div className="panel-header-text">
          <h1 className="panel-title">Active Agents</h1>
          <p className="panel-subtitle">
            Configure the LLM orchestration for your current project pipeline.
          </p>
        </div>
        <button className="btn btn--primary" type="button" onClick={onCreateAgent}>
          <PlusIcon size={14} />
          New Agent
        </button>
      </div>

      {/* Bento grid */}
      <div className="agent-grid-shell">
        <div className="agent-grid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onOpenSettings={onOpenSettings}
              skills={skills}
              mcpStatus={mcpStatus}
              mcpReady={mcpReady}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
