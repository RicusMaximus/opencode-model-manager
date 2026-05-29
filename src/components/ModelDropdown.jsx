import React, { useState, useRef, useEffect } from 'react'

const CLOUD_MODELS = [
  { id: 'anthropic/claude-opus-4-7',   name: 'Claude Opus 4.7',   provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'anthropic' },
  { id: 'openai/gpt-4o',               name: 'GPT-4o',             provider: 'openai'    },
  { id: 'openai/gpt-4o-mini',          name: 'GPT-4o Mini',        provider: 'openai'    },
  { id: 'openai/o3-mini',              name: 'o3 Mini',            provider: 'openai'    },
  { id: 'google/gemini-2.0-flash',     name: 'Gemini 2.0 Flash',  provider: 'google'    },
  { id: 'google/gemini-1.5-pro',       name: 'Gemini 1.5 Pro',    provider: 'google'    },
]

// ── Icons ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeName(name) {
  return name?.replace(/:latest$/, '') ?? name
}

function getDisplayName(modelId, ollamaModels) {
  if (!modelId) return ''
  const cloud = CLOUD_MODELS.find((m) => m.id === modelId)
  if (cloud) return cloud.name
  const normalized = normalizeName(modelId)
  const ollama = ollamaModels.find((m) => normalizeName(m.name) === normalized)
  if (ollama) return normalizeName(ollama.name)
  return modelId
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelDropdown({ value, onChange, ollamaModels = [] }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

  const displayName = getDisplayName(value, ollamaModels)

  // ── Filter ────────────────────────────────────────────────────────────────

  const q   = query.toLowerCase().trim()
  const hit = (text) => !q || text.toLowerCase().includes(q)

  const filteredOllama    = ollamaModels.filter((m) => hit(normalizeName(m.name)))
  const filteredAnthropic = CLOUD_MODELS.filter((m) => m.provider === 'anthropic' && (hit(m.name) || hit(m.id)))
  const filteredOpenai    = CLOUD_MODELS.filter((m) => m.provider === 'openai'    && (hit(m.name) || hit(m.id)))
  const filteredGoogle    = CLOUD_MODELS.filter((m) => m.provider === 'google'    && (hit(m.name) || hit(m.id)))
  const hasResults = filteredOllama.length + filteredAnthropic.length + filteredOpenai.length + filteredGoogle.length > 0

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleOpen = () => {
    setQuery('')
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const handleClose = () => {
    setQuery('')
    setOpen(false)
  }

  const handleSelect = (id) => {
    onChange(id)
    handleClose()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') handleClose()
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) handleClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // ── Option renderer ───────────────────────────────────────────────────────

  const Option = ({ id, label, meta, isSelected }) => (
    <div
      className={`model-dropdown-option${isSelected ? ' selected' : ''}`}
      // onMouseDown + preventDefault keeps the input focused while selecting
      onMouseDown={(e) => { e.preventDefault(); handleSelect(id) }}
    >
      <div className="model-option-left">
        <span className="model-option-name">{label}</span>
        {meta && <span className="model-option-meta">{meta}</span>}
      </div>
      {isSelected && (
        <span className="model-option-icon"><CheckIcon /></span>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="model-dropdown-wrap" ref={wrapRef}>

      {/* Trigger — div so we can nest an input without invalid HTML */}
      <div
        className={`model-dropdown-btn${open ? ' is-open' : ''}`}
        onClick={!open ? handleOpen : undefined}
      >
        <input
          ref={inputRef}
          className="model-dropdown-combobox-input"
          // Closed: show selected name (readonly). Open: show live query.
          value={open ? query : displayName}
          readOnly={!open}
          onChange={open ? (e) => setQuery(e.target.value) : undefined}
          onKeyDown={open ? handleKeyDown : undefined}
          placeholder={open ? 'Search models…' : 'Select model…'}
          spellCheck={false}
          autoComplete="off"
        />
        {/* onMouseDown so toggling the chevron doesn't blur the input first */}
        <span
          className={`model-dropdown-chevron${open ? ' open' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); open ? handleClose() : handleOpen() }}
        >
          <ChevronIcon />
        </span>
      </div>

      {/* Menu */}
      {open && (
        <div className="model-dropdown-menu">
          {!hasResults ? (
            <div className="model-dropdown-no-results">
              No models match &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {filteredOllama.length > 0 && (
                <>
                  <div className="model-dropdown-section-header">Local · Ollama</div>
                  {filteredOllama.map((m) => {
                    const id = normalizeName(m.name)
                    return (
                      <Option
                        key={id}
                        id={id}
                        label={id}
                        meta={m.details?.parameter_size || undefined}
                        isSelected={normalizeName(value) === id}
                      />
                    )
                  })}
                </>
              )}

              {filteredAnthropic.length > 0 && (
                <>
                  <div className="model-dropdown-section-header">Cloud · Anthropic</div>
                  {filteredAnthropic.map((m) => (
                    <Option key={m.id} id={m.id} label={m.name} isSelected={value === m.id} />
                  ))}
                </>
              )}

              {filteredOpenai.length > 0 && (
                <>
                  <div className="model-dropdown-section-header">Cloud · OpenAI</div>
                  {filteredOpenai.map((m) => (
                    <Option key={m.id} id={m.id} label={m.name} isSelected={value === m.id} />
                  ))}
                </>
              )}

              {filteredGoogle.length > 0 && (
                <>
                  <div className="model-dropdown-section-header">Cloud · Google</div>
                  {filteredGoogle.map((m) => (
                    <Option key={m.id} id={m.id} label={m.name} isSelected={value === m.id} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
