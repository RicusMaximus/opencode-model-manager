import React from 'react'

function AgentsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3" cy="10" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="10" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7.5 L3 8M10.5 7.5 L13 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ModelsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function SystemIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 14H11M8 11V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ReviewQueueIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5h12v9H2v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2 9.5h3l1 1.5h4l1-1.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6 6l1.5 1.5L11 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'agents', label: 'Agents', Icon: AgentsIcon },
  { id: 'models', label: 'Models', Icon: ModelsIcon },
  { id: 'review-queue', label: 'Review Queue', Icon: ReviewQueueIcon },
  { id: 'system', label: 'System', Icon: SystemIcon },
]

export default function Sidebar({ activeView, onNavigate, configPath, ollamaStatus, pendingReviewCount = 0 }) {
  // Extract the last folder name from the config path
  const dirName = configPath
    ? configPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'opencode'
    : 'opencode'

  const isConnected = ollamaStatus?.connected ?? false

  return (
    <aside className="sidebar-left">
      <div className="sidebar-logo">
        <span className="sidebar-logo-name">OpenCode</span>
        <span className="sidebar-logo-version">v1.0.0</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-item${(activeView === id || (id === 'agents' && activeView === 'agent-settings')) ? ' active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <span className="nav-icon">
              <Icon size={16} />
            </span>
            {label}
            {id === 'review-queue' && pendingReviewCount > 0 && (
              <span className="nav-badge">{pendingReviewCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {activeView === 'models' ? (
          <div className="ollama-status-card">
            <div className="ollama-status-row">
              <span className="ollama-status-label">Ollama Status</span>
              <div className={`status-dot ${isConnected ? 'green' : 'red'}`} />
            </div>
            <span className="ollama-addr">127.0.0.1:11434</span>
          </div>
        ) : (
          <div className="workspace-widget">
            <span className="workspace-label">Workspace</span>
            <span className="workspace-dir">{dirName}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
