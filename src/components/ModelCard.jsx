import React from 'react'

// ── Formatters ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—'
  const gb = bytes / 1073741824
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1048576
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${bytes} B`
}

function formatParams(raw) {
  if (!raw) return '—'
  if (typeof raw === 'string') return raw.toUpperCase()
  if (typeof raw === 'number') {
    if (raw >= 1e9) return `${(raw / 1e9).toFixed(0)}B`
    if (raw >= 1e6) return `${(raw / 1e6).toFixed(0)}M`
    return String(raw)
  }
  return '—'
}

function getVersionTag(model) {
  const name     = model.name || ''
  const colonIdx = name.indexOf(':')
  if (colonIdx === -1) return 'latest'
  const tag        = name.slice(colonIdx + 1)
  const quantMatch = tag.match(/q\d+_?[KMk]?_?[KMk]?/i)
  if (quantMatch) return quantMatch[0].toUpperCase()
  return tag
}

function getDisplayName(model) {
  const name     = model.name || ''
  const colonIdx = name.indexOf(':')
  return colonIdx === -1 ? name : name.slice(0, colonIdx)
}

// ── Performance estimation ────────────────────────────────────────────────────
//
// Approach: memory-bandwidth model.
//   tokens/s ≈ effective_bandwidth_GB_s / model_size_GB
//
// Bandwidth constants (conservative representative values):
//   VRAM  — 400 GB/s  (modern mid-range discrete GPU)
//   RAM   — 50  GB/s  (DDR4/5 system memory)
//
// Routing:
//   1. model fits in free VRAM          → full GPU path
//   2. partial VRAM + overflow to RAM   → weighted blend
//   3. model fits in free RAM           → CPU path
//   4. barely fits (needs swap/paging)  → very slow
//   5. won't fit at all                 → Too heavy

function estimatePerformance(model, systemInfo) {
  if (!systemInfo) return null

  const modelSizeGB = (model.size || 0) / 1073741824
  if (modelSizeGB === 0) return null

  const vramTotal = systemInfo.vram?.total ?? 0
  const vramUsed  = systemInfo.vram?.used  ?? 0
  const ramTotal  = systemInfo.ram?.total  ?? 0
  const ramUsed   = systemInfo.ram?.used   ?? 0

  // Guard: if system info hasn't populated yet, defer
  if (!ramTotal && !vramTotal) return null

  const vramFree = Math.max(0, vramTotal - vramUsed)
  const ramFree  = Math.max(0, ramTotal  - ramUsed)
  const VRAM_BW  = 400
  const RAM_BW   = 50

  let tps, tier, mode

  if (vramTotal > 0 && vramFree >= modelSizeGB) {
    // Fully VRAM-resident — fastest path
    tps  = Math.round(VRAM_BW / modelSizeGB)
    tier = 'Runs great'
    mode = 'GPU'

  } else if (vramTotal > 0 && vramFree > 0 && vramFree + ramFree >= modelSizeGB) {
    // GPU layers in VRAM, remainder offloaded to RAM
    const gpuFrac = Math.min(1, vramFree / modelSizeGB)
    const bw      = VRAM_BW * gpuFrac + RAM_BW * (1 - gpuFrac)
    tps  = Math.round(bw / modelSizeGB)
    tier = tps >= 25 ? 'Runs well' : 'Decent'
    mode = 'GPU+RAM'

  } else if (ramFree >= modelSizeGB) {
    // CPU-only inference
    tps  = Math.round(RAM_BW / modelSizeGB)
    tier = tps >= 8 ? 'Decent' : 'Tight fit'
    mode = 'CPU'

  } else if (ramTotal >= modelSizeGB * 0.8) {
    // Paged / swap-backed — barely usable
    tps  = Math.max(1, Math.round(RAM_BW * 0.4 / modelSizeGB))
    tier = 'Barely runs'
    mode = 'CPU'

  } else {
    return { tps: 0, tier: 'Too heavy', color: '#c0392b', score: 0, mode: null }
  }

  // Logarithmic score so mid-range models don't all flatten near zero.
  // 120 t/s → 1.0 (full bar),  10 t/s → ~0.66,  1 t/s → ~0.24
  const score = Math.min(1, Math.log10(Math.max(tps, 1)) / Math.log10(120))

  const color =
    tier === 'Runs great' ? '#66de70' :
    tier === 'Runs well'  ? '#a8de6e' :
    tier === 'Decent'     ? '#fabf45' :
    tier === 'Tight fit'  ? '#f57c00' :
                            '#e53935'   // Barely runs

  return { tps, tier, color, score, mode }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelCard({ model, systemInfo }) {
  const displayName = getDisplayName(model)
  const versionTag  = getVersionTag(model)
  const size        = formatSize(model.size)
  const params      = formatParams(model.details?.parameter_size)
  const perf        = estimatePerformance(model, systemInfo)

  return (
    <div className="model-card">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="model-card-header">
        <div className="model-card-title-row">
          <span className="model-card-name" title={model.name}>{displayName}</span>
          <span className="model-version-tag">{versionTag}</span>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="model-stats-grid">
        <div className="model-stat-cell">
          <span className="model-stat-label">Size on Disk</span>
          <span className="model-stat-value">{size}</span>
        </div>
        <div className="model-stat-cell">
          <span className="model-stat-label">Parameters</span>
          <span className="model-stat-value">{params}</span>
        </div>
      </div>

      <hr className="model-card-separator" />

      {/* ── Performance meter ──────────────────────────────────────────── */}
      <div className="model-perf-section">

        <div className="model-perf-header">
          <span className="model-perf-label">Performance</span>
          {perf && perf.tps > 0 && (
            <span className="model-perf-tps" style={{ color: perf.color }}>
              ~{perf.tps} t/s
            </span>
          )}
        </div>

        <div className="model-perf-bar-bg">
          {!perf ? (
            // System info still loading — shimmer skeleton
            <div className="model-perf-bar-skeleton" />
          ) : perf.tier === 'Too heavy' ? (
            // Model won't fit — dim red track
            <div
              className="model-perf-bar-fill"
              style={{ width: '100%', background: '#c0392b', opacity: 0.3 }}
            />
          ) : (
            <div
              className="model-perf-bar-fill"
              style={{
                width: `${Math.max(6, perf.score * 100)}%`,
                background: perf.color,
                boxShadow: `0 0 8px ${perf.color}55`,
              }}
            />
          )}
        </div>

        <div className="model-perf-footer">
          {!perf ? (
            <span className="model-perf-mode">Calculating…</span>
          ) : (
            <>
              {perf.mode && (
                <span className="model-perf-mode">{perf.mode}&thinsp;·&thinsp;</span>
              )}
              <span className="model-perf-tier" style={{ color: perf.color }}>
                {perf.tier}
              </span>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
