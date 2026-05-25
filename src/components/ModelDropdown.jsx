import React, { useState, useRef, useEffect } from 'react'

const CLOUD_MODELS = [
  { id: 'anthropic/claude-opus-4-7',    name: 'Claude Opus 4.7',    provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4-6',  name: 'Claude Sonnet 4.6',  provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5',   name: 'Claude Haiku 4.5',   provider: 'anthropic' },
  { id: 'openai/gpt-4o',                name: 'GPT-4o',              provider: 'openai' },
  { id: 'openai/gpt-4o-mini',           name: 'GPT-4o Mini',         provider: 'openai' },
  { id: 'openai/o3-mini',               name: 'o3 Mini',             provider: 'openai' },
  { id: 'google/gemini-2.0-flash',      name: 'Gemini 2.0 Flash',   provider: 'google' },
  { id: 'google/gemini-1.5-pro',        name: 'Gemini 1.5 Pro',      provider: 'google' },
]

function ChevronIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WarnIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <path d="M5 1.5L9 8.5H1L5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 4.5V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5" cy="7.2" r="0.4" fill="currentColor" />
    </svg>
  )
}

/**
 * Normalize a model name: strip `:latest` suffix, use as lookup key
 */
function normalizeName(name) {
  return name?.replace(/:latest$/, '') ?? name
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes) {
  if (!bytes) return '—'
  const gb = bytes / 1073741824
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1048576
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${bytes} B`
}

/**
 * Find a display name for the current model value
 */
function getDisplayName(modelId, ollamaModels) {
  if (!modelId) return 'Select model...'

  // Check cloud models
  const cloud = CLOUD_MODELS.find((m) => m.id === modelId)
  if (cloud) return cloud.name

  // Check ollama models
  const normalized = normalizeName(modelId)
  const ollama = ollamaModels.find(
    (m) => normalizeName(m.name) === normalized
  )
  if (ollama) return normalizeName(ollama.name)

  return modelId
}

export default function ModelDropdown({ value, onChange, ollamaModels = [] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const displayName = getDisplayName(value, ollamaModels)

  const handleSelect = (id) => {
    onChange(id)
    setOpen(false)
  }

  // Group cloud by provider
  const anthropicModels = CLOUD_MODELS.filter((m) => m.provider === 'anthropic')
  const openaiModels    = CLOUD_MODELS.filter((m) => m.provider === 'openai')
  const googleModels    = CLOUD_MODELS.filter((m) => m.provider === 'google')

  return (
    <div className="model-dropdown-wrap" ref={wrapRef}>
      <button
        className={`model-dropdown-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="model-dropdown-btn-label">{displayName}</span>
        <span className={`model-dropdown-chevron${open ? ' open' : ''}`}>
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="model-dropdown-menu">
          {/* ── Local Ollama ── */}
          {ollamaModels.length > 0 && (
            <>
              <div className="model-dropdown-section-header">Local (Ollama)</div>
              {ollamaModels.map((m) => {
                const id = normalizeName(m.name)
                const isSelected = normalizeName(value) === id
                const sizeBytes = m.size || 0
                const paramStr = m.details?.parameter_size || '—'
                const ctxStr   = m.details?.context_length
                  ? m.details.context_length >= 131072
                    ? '128K'
                    : m.details.context_length >= 32768
                    ? '32K'
                    : `${Math.round(m.details.context_length / 1024)}K`
                  : '—'

                return (
                  <div
                    key={id}
                    className={`model-dropdown-option${isSelected ? ' selected' : ''}`}
                    onClick={() => handleSelect(id)}
                  >
                    <div className="model-option-left">
                      <span className="model-option-name">{id}</span>
                      {paramStr !== '—' && (
                        <span className="model-option-meta">{paramStr}</span>
                      )}
                      {ctxStr !== '—' && (
                        <span className="model-option-meta">{ctxStr} ctx</span>
                      )}
                    </div>
                    <span className="model-option-icon">
                      <CheckIcon />
                    </span>
                  </div>
                )
              })}
            </>
          )}

          {/* ── Cloud: Anthropic ── */}
          <div className="model-dropdown-section-header">Cloud: Anthropic</div>
          {anthropicModels.map((m) => (
            <div
              key={m.id}
              className={`model-dropdown-option${value === m.id ? ' selected' : ''}`}
              onClick={() => handleSelect(m.id)}
            >
              <div className="model-option-left">
                <span className="model-option-name">{m.name}</span>
              </div>
              {value === m.id && (
                <span className="model-option-icon">
                  <CheckIcon />
                </span>
              )}
            </div>
          ))}

          {/* ── Cloud: OpenAI ── */}
          <div className="model-dropdown-section-header">Cloud: OpenAI</div>
          {openaiModels.map((m) => (
            <div
              key={m.id}
              className={`model-dropdown-option${value === m.id ? ' selected' : ''}`}
              onClick={() => handleSelect(m.id)}
            >
              <div className="model-option-left">
                <span className="model-option-name">{m.name}</span>
              </div>
              {value === m.id && (
                <span className="model-option-icon">
                  <CheckIcon />
                </span>
              )}
            </div>
          ))}

          {/* ── Cloud: Google Gemini ── */}
          <div className="model-dropdown-section-header">Cloud: Google Gemini</div>
          {googleModels.map((m) => (
            <div
              key={m.id}
              className={`model-dropdown-option${value === m.id ? ' selected' : ''}`}
              onClick={() => handleSelect(m.id)}
            >
              <div className="model-option-left">
                <span className="model-option-name">{m.name}</span>
              </div>
              {value === m.id && (
                <span className="model-option-icon">
                  <CheckIcon />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
