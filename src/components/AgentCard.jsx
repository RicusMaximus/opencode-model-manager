import React, { useState } from 'react'
import ModelDropdown from './ModelDropdown.jsx'

function getBadgeText(modelId) {
  if (!modelId) return 'no model'
  if (modelId.includes('/')) return modelId.split('/').pop()
  return modelId.replace(/:latest$/, '')
}

export default function AgentCard({ agent, ollamaModels, onModelChange }) {
  const [expanded, setExpanded] = useState(false)
  const badge = getBadgeText(agent.model)

  const showResponsibilities = agent.responsibilities && agent.responsibilities.length > 0
  const visibleResponsibilities = expanded
    ? agent.responsibilities
    : agent.responsibilities?.slice(0, 3)
  const hasMore = (agent.responsibilities?.length ?? 0) > 3

  return (
    <div className="agent-card">
      {/* ── Row 1: accent square + model badge ── */}
      <div className="agent-card-top">
        <div
          className="agent-color-sq"
          style={{
            backgroundColor: agent.color,
            boxShadow: `0 4px 14px ${agent.color}55, 0 2px 5px ${agent.color}30, inset 0 1px 0 rgba(255,255,255,.2)`,
          }}
        />
        <div className="agent-card-badges">
          {agent.mode === 'primary' && (
            <span className="agent-badge primary">Primary</span>
          )}
          <span className="agent-model-badge" title={agent.model ?? 'no model'}>
            {badge}
          </span>
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

      {/* ── Row 3: responsibilities ── */}
      {showResponsibilities && (
        <div className="agent-responsibilities">
          <div className="agent-section-label">What I do</div>
          <ul className="agent-resp-list">
            {visibleResponsibilities.map((r, i) => (
              <li key={i} className="agent-resp-item">{r}</li>
            ))}
          </ul>
          {hasMore && (
            <button
              className="agent-expand-btn"
              onClick={() => setExpanded(v => !v)}
              type="button"
            >
              {expanded ? '↑ Show less' : `↓ +${agent.responsibilities.length - 3} more`}
            </button>
          )}
        </div>
      )}

      {/* ── Row 4: tool / permission chips ── */}
      {agent.tools && agent.tools.length > 0 && (
        <div className="agent-tools">
          <div className="agent-section-label">Tools & permissions</div>
          <div className="agent-tool-chips">
            {agent.tools.map(t => (
              <span
                key={t.id}
                className="agent-tool-chip"
                style={{ '--chip-color': t.color }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Row 5: model dropdown ── */}
      <div className="agent-model-row">
        <div className="agent-section-label">Model</div>
        <ModelDropdown
          value={agent.model}
          onChange={(newModel) => onModelChange(agent.id, newModel)}
          ollamaModels={ollamaModels}
        />
      </div>
    </div>
  )
}
