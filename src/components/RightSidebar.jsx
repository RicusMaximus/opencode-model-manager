import React from 'react'
import Card, { CardHeader } from './Card.jsx'
import Badge from './Badge.jsx'

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

// ── Shared rows ─────────────────────────────────────────────────────────────

function MetricRow({ label, value, valueClass, pct: p, barClass }) {
  return (
    <div className="metric-row">
      <div className="metric-row-header">
        <span className="metric-label">{label}</span>
        <span className={`metric-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</span>
      </div>
      <div className="metric-bar-bg">
        <div className={`metric-bar-fill ${barClass}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function HwRow({ icon, label, value }) {
  return (
    <div className="hw-row">
      <span className="hw-row-icon">{icon}</span>
      <div className="hw-row-info">
        <span className="hw-row-label">{label}</span>
        <span className="hw-row-value">{value}</span>
      </div>
    </div>
  )
}

// ── Agents Right Sidebar ───────────────────────────────────────────────────

function AgentsRightSidebar({ systemInfo }) {
  const ram   = systemInfo?.ram   ?? { used: 0, total: 16 }
  const vram  = systemInfo?.vram  ?? { used: 0, total: 0 }

  const cpuUsePct = 42 // demo (real CPU usage needs continuous polling)
  const ramPct    = pct(ram.used, ram.total)
  const vramPct   = pct(vram.used, vram.total)

  return (
    <aside className="sidebar-right agents">
      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader title="System Info" />
        <div className="rs-metrics">
          <MetricRow label="RAM" value={`${ram.used} / ${ram.total} GB`} valueClass="blue" pct={ramPct} barClass="bar-blue" />
          <MetricRow label="CPU" value={`${cpuUsePct}%`} valueClass="green" pct={cpuUsePct} barClass="bar-green" />
          <MetricRow label="VRAM" value={vram.total > 0 ? `${vram.used} / ${vram.total} GB` : 'N/A'} valueClass="yellow" pct={vramPct} barClass="bar-yellow" />
        </div>
      </Card>

      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader icon={<ClockIcon size={14} />} title="Performance" />
        <p className="turbo-card-desc">Coming soon: live model latency and token/s tracking.</p>
      </Card>

      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader icon={<LightningIcon size={14} />} title="Turbo Mode" />
        <p className="turbo-card-desc">Accelerate local inference using available CUDA cores.</p>
      </Card>
    </aside>
  )
}

// ── Models Right Sidebar ───────────────────────────────────────────────────

function ModelsRightSidebar({ systemInfo, ollamaStatus }) {
  const ram   = systemInfo?.ram   ?? { used: 0, total: 16 }
  const vram  = systemInfo?.vram  ?? { used: 0, total: 0 }
  const cpu   = systemInfo?.cpu   ?? { brand: 'Detecting...', cores: 0 }
  const gpu   = systemInfo?.gpu   ?? 'Unknown GPU'
  const connected = ollamaStatus?.connected ?? false

  const vramPct = pct(vram.used, vram.total)
  const ramPct  = pct(ram.used, ram.total)

  return (
    <aside className="sidebar-right models">
      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader
          title="Ollama"
          badges={
            <Badge size="sm" tone={connected ? 'green' : 'red'} dot={connected ? 'green' : 'red'}>
              {connected ? 'Connected' : 'Offline'}
            </Badge>
          }
        />
        <span className="rs-addr">127.0.0.1:11434</span>
      </Card>

      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader title="System Resources" />
        <div className="rs-metrics">
          <MetricRow label="VRAM Utilization" value={vram.total > 0 ? `${vram.used} / ${vram.total} GB` : 'N/A'} valueClass="mono" pct={vramPct} barClass="bar-blue" />
          <MetricRow label="System RAM" value={`${ram.used} / ${ram.total} GB`} valueClass="mono" pct={ramPct} barClass="bar-yellow" />
        </div>
      </Card>

      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader title="Hardware Profile" />
        <div className="rs-metrics">
          <HwRow icon={<CpuIcon size={14} />} label="Processor" value={cpu.brand} />
          <HwRow icon={<GpuIcon size={14} />} label="Graphics" value={gpu} />
        </div>
      </Card>

      <Card elevation={1} size="sm" className="rs-card">
        <CardHeader title="Ollama Logs" />
        <div className="log-box">
          {DEMO_LOGS.map((line, i) => (
            <div key={i} className={`log-line ${classifyLogLine(line)}`}>{line}</div>
          ))}
        </div>
      </Card>
    </aside>
  )
}

// ── Exported Component ─────────────────────────────────────────────────────

export default function RightSidebar({ activeView, systemInfo, ollamaStatus, expanded }) {
  if ((activeView === 'agents' || activeView === 'agent-settings') && !expanded) {
    return <AgentsRightSidebar systemInfo={systemInfo} />
  }
  if (activeView === 'models' || activeView === 'system' || expanded) {
    return <ModelsRightSidebar systemInfo={systemInfo} ollamaStatus={ollamaStatus} />
  }
  return null
}
