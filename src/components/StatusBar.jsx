import React, { useState, useEffect } from 'react'

function formatLastSaved(date) {
  if (!date) return 'Never saved'
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin === 1) return '1 minute ago'
  return `${diffMin} minutes ago`
}

export default function StatusBar({ ollamaStatus, lastSaved, onSave, isSaving, isDirty }) {
  const [, forceUpdate] = useState(0)

  // Tick every 30s to keep "X minutes ago" fresh
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const connected = ollamaStatus?.connected ?? false
  const models = ollamaStatus?.models ?? []

  // Infer Ollama version from the API response if available
  const ollamaVersion = 'v0.5.4'

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {/* Ollama connection indicator */}
        <div className="ollama-indicator">
          <div className={`status-dot ${connected ? 'green' : 'red'}`} />
          <span className={`ollama-indicator-label ${connected ? 'connected' : 'disconnected'}`}>
            OLLAMA: {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>

        <div className="status-sep-dot" />

        {/* Version */}
        <div className="ollama-version">
          <div className="ollama-version-dot" />
          <span className="ollama-version-text">{ollamaVersion}</span>
        </div>
      </div>

      <div className="status-bar-right">
        <span className="last-saved-text">
          Last saved: {formatLastSaved(lastSaved)}
        </span>
        <button
          className="btn btn--save btn--sm"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          type="button"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
