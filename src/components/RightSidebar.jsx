import React from 'react'

// ── Icons ──────────────────────────────────────────────────────────────────

function ClockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LightningIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M8 1.5L3.5 7.5H7L6 12.5L10.5 6.5H7.5L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function CpuIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5" y="5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 1V3M9 1V3M5 11V13M9 11V13M1 5H3M1 9H3M11 5H13M11 9H13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function GpuIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="3.5" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="6" width="3" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 10.5V12M10 10.5V12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val))
}

function pct(used, total) {
  if (!total || total === 0) return 0
  return clamp(Math.round((used / total) * 100), 0, 100)
}

// Fake Ollama log lines for demo purposes when actually connected
const DEMO_LOGS = [
  '[INFO]  Loaded model: llama3.2:3b',
  '[INFO]  Listening on 127.0.0.1:11434',
  '[DEBUG] GET /api/tags → 200 1.2ms',
  '[DEBUG] GET /api/tags → 200 0.9ms',
  '[INFO]  Context length: 4096',
  '[DEBUG] POST /api/show → 200 3.1ms',
  '[DEBUG] GET /api/tags → 200 1.1ms',
]

function classifyLogLine(line) {
  if (line.includes('[INFO]')) return 'info'
  if (line.includes('[DEBUG]')) return 'debug'
  return ''
}

// ── Agents Right Sidebar ───────────────────────────────────────────────────

function AgentsRightSidebar({ systemInfo }) {
  const ram   = systemInfo?.ram   ?? { used: 0, total: 16 }
  const cpu   = systemInfo?.cpu   ?? { brand: 'Detecting...', speed: 0, cores: 0 }
  const vram  = systemInfo?.vram  ?? { used: 0, total: 0 }

  // Simulate CPU usage (real usage requires continuous polling; show a demo value)
  const cpuUsePct = 42
  const ramPct    = pct(ram.used, ram.total)
  const vramPct   = pct(vram.used, vram.total)

  return (
    <aside className="sidebar-right agents">
      {/* System Info */}
      <div className="rs-section">
        <div className="rs-section-label">System Info</div>

        <div className="metric-row">
          <div className="metric-row-header">
            <span className="metric-label">RAM</span>
            <span className="metric-value blue">{ram.used} / {ram.total} GB</span>
          </div>
          <div className="metric-bar-bg">
            <div
              className="metric-bar-fill bar-blue"
              style={{ width: `${ramPct}%` }}
            />
          </div>
        </div>

        <div className="metric-row">
          <div className="metric-row-header">
            <span className="metric-label">CPU</span>
            <span className="metric-value green">{cpuUsePct}%</span>
          </div>
          <div className="metric-bar-bg">
            <div
              className="metric-bar-fill bar-green"
              style={{ width: `${cpuUsePct}%` }}
            />
          </div>
        </div>

        <div className="metric-row">
          <div className="metric-row-header">
            <span className="metric-label">VRAM</span>
            <span className="metric-value yellow">
              {vram.total > 0 ? `${vram.used} / ${vram.total} GB` : 'N/A'}
            </span>
          </div>
          <div className="metric-bar-bg">
            <div
              className="metric-bar-fill bar-yellow"
              style={{ width: `${vramPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Performance */}
      <div className="rs-section">
        <div className="rs-section-label" style={{ marginBottom: 12 }}>Performance</div>
        <div className="perf-placeholder">
          <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
            <ClockIcon size={16} />
          </span>
          <span className="perf-placeholder-text">
            Coming soon: Live model latency and token/s tracking
          </span>
        </div>

        <div className="turbo-card">
          <div className="turbo-card-header">
            <span style={{ color: 'var(--accent-green)' }}>
              <LightningIcon size={14} />
            </span>
            <span className="turbo-card-title">Turbo Mode</span>
          </div>
          <p className="turbo-card-desc">
            Accelerate local inference using available CUDA cores.
          </p>
        </div>
      </div>
    </aside>
  )
}

// ── Models Right Sidebar ───────────────────────────────────────────────────

function ModelsRightSidebar({ systemInfo }) {
  const ram   = systemInfo?.ram   ?? { used: 0, total: 16 }
  const vram  = systemInfo?.vram  ?? { used: 0, total: 0 }
  const cpu   = systemInfo?.cpu   ?? { brand: 'Detecting...', cores: 0 }
  const gpu   = systemInfo?.gpu   ?? 'Unknown GPU'

  const vramPct = pct(vram.used, vram.total)
  const ramPct  = pct(ram.used, ram.total)

  return (
    <aside className="sidebar-right models">
      {/* System Resources */}
      <div className="rs-section">
        <div className="rs-section-heading">System Resources</div>

        <div className="metric-row">
          <div className="metric-row-header">
            <span className="metric-label">VRAM Utilization</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)' }}>
              {vram.total > 0 ? `${vram.used} / ${vram.total} GB` : 'N/A'}
            </span>
          </div>
          <div className="metric-bar-bg tall">
            <div
              className="metric-bar-fill bar-blue"
              style={{ width: `${vramPct}%` }}
            />
          </div>
        </div>

        <div className="metric-row">
          <div className="metric-row-header">
            <span className="metric-label">System RAM</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)' }}>
              {ram.used} / {ram.total} GB
            </span>
          </div>
          <div className="metric-bar-bg tall">
            <div
              className="metric-bar-fill bar-yellow"
              style={{ width: `${ramPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Hardware Profile */}
      <div className="rs-section">
        <div className="rs-section-heading">Hardware Profile</div>
        <div className="hw-card">
          <div className="hw-row">
            <span className="hw-row-icon"><CpuIcon size={14} /></span>
            <div className="hw-row-info">
              <span className="hw-row-label">Processor</span>
              <span className="hw-row-value">{cpu.brand}</span>
            </div>
          </div>
          <div className="hw-row">
            <span className="hw-row-icon"><GpuIcon size={14} /></span>
            <div className="hw-row-info">
              <span className="hw-row-label">Graphics</span>
              <span className="hw-row-value">{gpu}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ollama Logs */}
      <div className="rs-section">
        <div className="rs-section-heading">Ollama Logs</div>
        <div className="log-box">
          {DEMO_LOGS.map((line, i) => (
            <div key={i} className={`log-line ${classifyLogLine(line)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

// ── Exported Component ─────────────────────────────────────────────────────

export default function RightSidebar({ activeView, systemInfo, ollamaStatus, expanded }) {
  if (activeView === 'agents' && !expanded) {
    return <AgentsRightSidebar systemInfo={systemInfo} />
  }
  if (activeView === 'models' || activeView === 'system' || expanded) {
    return <ModelsRightSidebar systemInfo={systemInfo} ollamaStatus={ollamaStatus} />
  }
  return null
}
