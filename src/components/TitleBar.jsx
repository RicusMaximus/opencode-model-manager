import React from 'react'

const api = window.electronAPI

// Minimal SVG icons inline
function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1" y="4.5" width="8" height="1" rx="0.5" fill="currentColor" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function TitleBar({ configPath, onBrowse }) {
  const handleMinimize = () => api?.minimizeWindow()
  const handleMaximize = () => api?.maximizeWindow()
  const handleClose = () => api?.closeWindow()

  // Show a friendly path display (no process.env in renderer — normalise slashes only)
  const displayPath = configPath
    ? configPath.replace(/\\/g, '/')
    : '~/.config/opencode'

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-app-name">OpenCode Agent Manager</span>
        <div className="titlebar-divider" />
        <span className="titlebar-config-path">{displayPath}</span>
      </div>
      <div className="titlebar-right">
        <button className="btn btn--secondary btn--sm" onClick={onBrowse}>
          Browse
        </button>
        <div className="window-controls">
          <button className="win-btn" onClick={handleMinimize} title="Minimize">
            <MinimizeIcon />
          </button>
          <button className="win-btn" onClick={handleMaximize} title="Maximize">
            <MaximizeIcon />
          </button>
          <button className="win-btn close" onClick={handleClose} title="Close">
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
