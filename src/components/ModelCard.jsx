import React from 'react'

function DotsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8"   r="1.2" fill="currentColor" />
      <circle cx="8" cy="12.5" r="1.2" fill="currentColor" />
    </svg>
  )
}

/**
 * Format raw byte size to human-readable
 */
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—'
  const gb = bytes / 1073741824
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1048576
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${bytes} B`
}

/**
 * Format context window length
 */
function formatContext(n) {
  if (!n) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}K`
  return String(n)
}

/**
 * Format parameter count e.g. "7b" → "7B", "14000000000" → "14B"
 */
function formatParams(raw) {
  if (!raw) return '—'
  if (typeof raw === 'string') {
    // Ollama returns strings like "7b", "14b", "72b", "0.5b"
    return raw.toUpperCase()
  }
  if (typeof raw === 'number') {
    if (raw >= 1e9) return `${(raw / 1e9).toFixed(0)}B`
    if (raw >= 1e6) return `${(raw / 1e6).toFixed(0)}M`
    return String(raw)
  }
  return '—'
}

/**
 * Extract a clean version tag from an Ollama model object
 * e.g. "qwen2.5-coder:7b-instruct-q4_K_M" → "q4_K_M"
 */
function getVersionTag(model) {
  const name = model.name || ''
  const colonIdx = name.indexOf(':')
  if (colonIdx === -1) return 'latest'
  const tag = name.slice(colonIdx + 1)
  // Try to pull out quantization pattern
  const quantMatch = tag.match(/q\d+_?[KMk]?_?[KMk]?/i)
  if (quantMatch) return quantMatch[0].toUpperCase()
  return tag
}

/**
 * Get a clean display name (without tag/quantization suffix)
 */
function getDisplayName(model) {
  const name = model.name || ''
  const colonIdx = name.indexOf(':')
  if (colonIdx === -1) return name
  return name.slice(0, colonIdx)
}

export default function ModelCard({ model }) {
  const displayName = getDisplayName(model)
  const versionTag  = getVersionTag(model)
  const size        = formatSize(model.size)
  const params      = formatParams(model.details?.parameter_size)
  const context     = formatContext(model.details?.context_length)
  const quant       = model.details?.quantization_level
    ? model.details.quantization_level.toUpperCase()
    : '—'

  const modelId = (model.name || '').replace(/:latest$/, '')

  return (
    <div className="model-card">
      {/* Header */}
      <div className="model-card-header">
        <div className="model-card-title-row">
          <span className="model-card-name" title={model.name}>{displayName}</span>
          <span className="model-version-tag">{versionTag}</span>
        </div>
        <button className="model-card-menu-btn" type="button" title="Options">
          <DotsIcon size={16} />
        </button>
      </div>

      {/* Stats 2×2 grid */}
      <div className="model-stats-grid">
        <div className="model-stat-cell">
          <span className="model-stat-label">Size on Disk</span>
          <span className="model-stat-value">{size}</span>
        </div>
        <div className="model-stat-cell">
          <span className="model-stat-label">Parameters</span>
          <span className="model-stat-value">{params}</span>
        </div>
        <div className="model-stat-cell">
          <span className="model-stat-label">Context Window</span>
          <span className="model-stat-value">{context}</span>
        </div>
        <div className="model-stat-cell">
          <span className="model-stat-label">Quantization</span>
          <span className="model-stat-value">{quant}</span>
        </div>
      </div>

      <hr className="model-card-separator" />

      {/* Footer */}
      <div className="model-card-footer">
        <span className="model-id-label" title={modelId}>{modelId}</span>
        <button className="model-use-btn" type="button">Use</button>
      </div>
    </div>
  )
}
