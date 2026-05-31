import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import ModelDropdown from './ModelDropdown.jsx'

// ── Icons ──────────────────────────────────────────────────────────────────

function ChevronRightIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CpuIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5" y="5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 1V3M9 1V3M5 11V13M9 11V13M1 5H3M1 9H3M11 5H13M11 9H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function TerminalIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 4L6 7L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 10H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SlidersIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M1 4H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M1 10H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="4" cy="4" r="1.5" fill="var(--bg-card)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="10" r="1.5" fill="var(--bg-card)" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function ShieldIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5L2 3.5V7C2 9.8 4.2 12.2 7 13C9.8 12.2 12 9.8 12 7V3.5L7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4.5 7L6.5 9L9.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M9.5 2.5L11.5 4.5L5 11H3V9L9.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WrenchIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M9 2C7.3 2 6 3.3 6 5C6 5.4 6.1 5.7 6.2 6L2 10.2C1.6 10.6 1.6 11.3 2 11.7L2.3 12C2.7 12.4 3.4 12.4 3.8 12L8 7.8C8.3 7.9 8.6 8 9 8C10.7 8 12 6.7 12 5C12 4.5 11.9 4.1 11.7 3.7L9.8 5.6L8.4 4.2L10.3 2.3C9.9 2.1 9.5 2 9 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function XIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M6 1V11M1 6H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M1.5 3H10.5M4.5 3V2H7.5V3M3 3L3.5 10H8.5L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SaveIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <path d="M2 2H9L11 4V11H2V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="4" y="8" width="5" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="4" y="2" width="4" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function InfoIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.5 6v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6.5" cy="3.8" r="0.7" fill="currentColor" />
    </svg>
  )
}

function InfoTooltip({ text }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const show = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.top, left: r.left + r.width / 2 })
  }

  const hide = () => setPos(null)

  return (
    <span className="as-info-wrap" ref={btnRef}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button type="button" className="as-info-btn" aria-label="More info" tabIndex={-1}>
        <InfoIcon size={13} />
      </button>
      {pos && ReactDOM.createPortal(
        <span
          className="as-info-tooltip"
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getModelKind(modelId) {
  if (!modelId) return null
  if (modelId.startsWith('ollama/')) return 'LOCAL'
  return modelId.includes('/') ? 'CLOUD' : 'LOCAL'
}

/** Deep-clone an agent object so local edits don't mutate the parent state */
function cloneAgent(agent) {
  return JSON.parse(JSON.stringify(agent))
}

/** Ensure all required sub-objects exist in the draft */
function normalizeDraft(draft) {
  if (!draft.options)    draft.options    = {}
  if (!draft.tools)     draft.tools      = {}
  if (!draft.permission) draft.permission = {}
  if (draft.options.thinking == null) draft.options.thinking = null
  return draft
}

// Permission values allowed per field
const PERM_VALUES = ['allow', 'ask', 'deny']

// Simple tools available as toggles
const KNOWN_TOOLS = ['skill', 'webfetch', 'todowrite', 'bash', 'read', 'write', 'edit', 'grep', 'glob']

// Simple (string) permission keys that get a 3-way selector
const SIMPLE_PERM_KEYS = ['*', 'read', 'write', 'edit', 'grep', 'glob', 'todowrite', 'question', 'webfetch', 'bash', 'websearch']

// Complex (object) permission keys that need pattern editing
const COMPLEX_PERM_KEYS = ['bash', 'skill', 'external_directory']

// ── Sub-components ─────────────────────────────────────────────────────────

/** 3-way allow/ask/deny selector */
function PermSelect({ value, onChange }) {
  return (
    <div className="as-perm-select">
      {PERM_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          className={`as-perm-btn as-perm-btn--${v}${value === v ? ' is-active' : ''}`}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

/** A single key/value pattern row */
function PatternRow({ pattern, value, onChange, onDelete }) {
  return (
    <div className="as-pattern-row">
      <input
        className="as-input as-pattern-key"
        value={pattern}
        placeholder="pattern (e.g. git *)"
        onChange={(e) => onChange(e.target.value, value)}
        spellCheck={false}
      />
      <PermSelect value={value} onChange={(v) => onChange(pattern, v)} />
      <button type="button" className="as-icon-btn as-icon-btn--danger" onClick={onDelete} title="Remove">
        <TrashIcon size={11} />
      </button>
    </div>
  )
}

/** Expandable block for object-valued permissions (bash, skill, external_directory) */
function PatternBlock({ keyName, patterns, onChange }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(patterns || {})

  const updateEntry = (oldKey, newKey, newVal) => {
    const next = {}
    for (const [k, v] of entries) {
      if (k === oldKey) { if (newKey) next[newKey] = newVal }
      else next[k] = v
    }
    onChange(next)
  }

  const addEntry = () => {
    onChange({ ...patterns, '': 'ask' })
  }

  const deleteEntry = (k) => {
    const next = { ...patterns }
    delete next[k]
    onChange(next)
  }

  return (
    <div className="as-pattern-block">
      <button type="button" className="as-pattern-block-toggle" onClick={() => setExpanded((p) => !p)}>
        <span className={`as-pattern-chevron${expanded ? ' open' : ''}`}>▶</span>
        <span className="as-perm-key-label">{keyName}</span>
        <span className="as-perm-key-badge">{entries.length} pattern{entries.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <div className="as-pattern-block-body">
          {entries.map(([k, v]) => (
            <PatternRow
              key={k}
              pattern={k}
              value={v}
              onChange={(nk, nv) => updateEntry(k, nk, nv)}
              onDelete={() => deleteEntry(k)}
            />
          ))}
          <button type="button" className="as-add-row-btn" onClick={addEntry}>
            <PlusIcon size={10} /> Add pattern
          </button>
        </div>
      )}
    </div>
  )
}

/** Markdown editor modal */
function MarkdownEditorModal({ value, onSave, onClose }) {
  const [text, setText] = useState(value ?? '')
  const taRef = useRef(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  // Close on Escape, save on Ctrl+S
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave(text)
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [text, onSave, onClose])

  return (
    <div className="as-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="as-modal">
        <div className="as-modal-header">
          <span className="as-modal-title">
            <TerminalIcon size={14} /> System Prompt / Instructions
          </span>
          <div className="as-modal-actions">
            <button
              type="button"
              className="save-btn"
              onClick={() => { onSave(text); onClose() }}
            >
              <SaveIcon size={12} /> Apply
            </button>
            <button type="button" className="as-icon-btn" onClick={onClose} title="Close">
              <XIcon size={14} />
            </button>
          </div>
        </div>
        <div className="as-modal-hint">Markdown supported · Ctrl+S to save · Esc to discard</div>
        <textarea
          ref={taRef}
          className="as-modal-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Enter system instructions or prompt…"
        />
      </div>
    </div>
  )
}

// Default draft for new agents
const NEW_AGENT_DEFAULTS = {
  mode: 'subagent',
  model: null,
  description: '',
  prompt: '',
  maxTokens: 8000,
  maxSteps: 45,
  options: {},
  tools: {},
  permission: {},
}

// Validate agent ID slug: lowercase letters, numbers, hyphens only
function isValidSlug(slug) {
  return /^[a-z0-9-]+$/.test(slug)
}

// ── Parameter descriptions ─────────────────────────────────────────────────

const PARAM_INFO = {
  mode:             'Controls how this agent is selected. "primary" is the main agent, "fallback" is used when the primary fails, and "subagent" is called as a tool by other agents.',
  model:            'The LLM used for this agent. Overrides the global default model. Leave unset to inherit the global model.',
  description:      'A short human-readable summary of what this agent does. Shown on the agent card in the overview.',
  systemPrompt:     'The system-level instructions prepended to every conversation with this agent. Defines its persona, rules, and behaviour.',
  maxTokens:        'Maximum number of tokens the model can generate in a single response. Higher values allow longer outputs but increase cost and latency.',
  maxSteps:         'Maximum number of tool-call / reasoning steps the agent may take before it must produce a final answer. Prevents runaway loops.',
  temperature:      'Controls randomness. 0 = fully deterministic (same input → same output). 2 = highly creative / unpredictable. Most tasks work best between 0.5–1.0.',
  topP:             'Nucleus sampling threshold. The model considers only the smallest set of tokens whose cumulative probability ≥ Top P. 1.0 = disabled. Lower values (e.g. 0.9) make output more focused.',
  reasoningEffort:  'For reasoning models (e.g. o1, o3). Controls how much compute is spent on internal reasoning before answering. Higher effort = better accuracy at more cost.',
  extendedThinking: "Enables Claude's extended thinking mode, where the model reasons step-by-step internally before responding. Requires a compatible Claude model.",
  thinkingBudget:   'Maximum number of tokens Claude may use for internal reasoning (thinking tokens). Does not count toward the output token limit.',
  toolOverrides:    'Explicitly enable or disable individual built-in tools for this agent. Overrides the global tool configuration.',
  permissions:      'Fine-grained allow / ask / deny rules per tool or command. "allow" = run without confirmation, "ask" = prompt the user first, "deny" = block entirely.',
}

const TOOL_INFO = {
  skill:     'Loads and executes skill files (.skill.md) that provide specialised instructions.',
  webfetch:  'Fetches content from URLs and returns it as text or markdown.',
  todowrite: 'Creates and updates a structured todo list to track multi-step tasks.',
  bash:      'Runs shell commands on the host machine.',
  read:      'Reads file contents from the filesystem.',
  write:     'Writes or creates files on the filesystem.',
  edit:      'Makes targeted string replacements inside existing files.',
  grep:      'Searches file contents using regular expressions.',
  glob:      'Finds files by name patterns (e.g. **/*.ts).',
}

const PERM_KEY_INFO = {
  '*':              'Wildcard — applies to all tools not explicitly listed. Use as a default fallback rule.',
  read:             'Permission to read files from the filesystem.',
  write:            'Permission to write or create files on the filesystem.',
  edit:             'Permission to make targeted edits to existing files.',
  grep:             'Permission to search file contents with regex.',
  glob:             'Permission to search for files by name patterns.',
  todowrite:        'Permission to create and update the todo list.',
  question:         'Permission to ask the user clarifying questions.',
  webfetch:         'Permission to fetch content from external URLs.',
  bash:             'Permission to execute shell commands. Use with caution.',
  websearch:        'Permission to perform web searches.',
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AgentSettingsPanel({ agent, ollamaModels, onBack, onSave, isNew = false }) {
  // In create mode use a sentinel so the useEffect doesn't reset us on first render
  const initDraft = isNew
    ? normalizeDraft({ ...NEW_AGENT_DEFAULTS })
    : normalizeDraft(cloneAgent(agent ?? {}))

  const [draft, setDraft] = useState(() => initDraft)
  // agentId slug for the new-agent form
  const [agentId, setAgentId] = useState('')
  const [agentIdError, setAgentIdError] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  // Track which complex-perm keys to show as pattern blocks vs simple
  // In create mode use a non-matching sentinel so isDirty triggers immediately
  const originalJson = useRef(isNew ? '__new__' : JSON.stringify(agent ?? {}))

  // Re-sync when the parent agent prop changes (e.g. navigating between agents)
  // Only run in edit mode (not isNew) so create form isn't wiped
  useEffect(() => {
    if (isNew) return
    const next = normalizeDraft(cloneAgent(agent ?? {}))
    setDraft(next)
    setIsDirty(false)
    originalJson.current = JSON.stringify(agent ?? {})
  }, [agent?.id, isNew])

  if (!isNew && !agent) {
    return (
      <div className="as-panel">
        <p style={{ color: 'var(--text-secondary)', padding: '24px' }}>No agent selected.</p>
      </div>
    )
  }

  // ── Mutators ───────────────────────────────────────────────────────────────

  const update = (updater) => {
    setDraft((prev) => {
      const next = updater(cloneAgent(prev))
      setIsDirty(JSON.stringify(next) !== originalJson.current)
      return next
    })
  }

  const setField = (key, value) => update((d) => { d[key] = value; return d })

  const setOption = (key, value) => update((d) => {
    d.options = d.options ?? {}
    if (value === '' || value === null || value === undefined) {
      delete d.options[key]
    } else {
      d.options[key] = value
    }
    return d
  })

  const setThinking = (enabled) => update((d) => {
    d.options = d.options ?? {}
    d.options.thinking = enabled ? { type: 'enabled', budgetTokens: d.options.thinking?.budgetTokens ?? 8000 } : null
    return d
  })

  const setThinkingBudget = (v) => update((d) => {
    d.options = d.options ?? {}
    if (d.options.thinking) d.options.thinking.budgetTokens = Number(v)
    return d
  })

  const setTool = (name, enabled) => update((d) => {
    d.tools = d.tools ?? {}
    if (enabled) d.tools[name] = true
    else delete d.tools[name]
    return d
  })

  const setSimplePerm = (key, value) => update((d) => {
    d.permission = d.permission ?? {}
    if (value === '') delete d.permission[key]
    else d.permission[key] = value
    return d
  })

  const setComplexPerm = (key, patterns) => update((d) => {
    d.permission = d.permission ?? {}
    if (!patterns || Object.keys(patterns).length === 0) delete d.permission[key]
    else d.permission[key] = patterns
    return d
  })

  const handleSave = () => {
    if (isNew) {
      // Validate slug
      if (!agentId || !isValidSlug(agentId)) {
        setAgentIdError('Agent ID must contain only lowercase letters, numbers, and hyphens.')
        return
      }
      setAgentIdError('')
      onSave?.(draft, agentId)
    } else {
      onSave?.(draft)
      setIsDirty(false)
      originalJson.current = JSON.stringify(draft)
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const modelKind = getModelKind(draft.model)
  const thinkingEnabled = !!draft.options?.thinking

  // Separate simple vs complex permissions currently in draft
  const permEntries = Object.entries(draft.permission ?? {})
  const simplePerms = permEntries.filter(([, v]) => typeof v === 'string')
  const complexPerms = permEntries.filter(([, v]) => typeof v === 'object' && v !== null)

  // All simple perm keys present or suggested
  const simplePermKeys = Array.from(new Set([
    ...SIMPLE_PERM_KEYS,
    ...simplePerms.map(([k]) => k),
  ])).filter((k) => !COMPLEX_PERM_KEYS.includes(k))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="as-panel">

      {/* ── Header ── */}
      <div className="as-header">
        <div className="as-breadcrumbs">
          <button type="button" className="as-breadcrumb-link" onClick={onBack}>Agents</button>
          <span style={{ color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center' }}>
            <ChevronRightIcon size={12} />
          </span>
          <span className="as-breadcrumb-current">{isNew ? 'New Agent' : agent.id}</span>
        </div>

        <div className="as-heading-row">
          <div className="as-heading-text">
            {isNew ? (
              <h1>New Agent</h1>
            ) : (
              <h1>
                {agent.displayName}
                {draft.version && <span className="as-version-pill">{draft.version}</span>}
              </h1>
            )}
            {!isNew && draft.description && <p>{draft.description}</p>}
          </div>

          <div className="as-tags">
            {draft.mode === 'primary'   && <span className="as-tag primary">PRIMARY</span>}
            {draft.mode === 'fallback'  && <span className="as-tag">FALLBACK</span>}
            {draft.mode === 'subagent'  && <span className="as-tag">SUBAGENT</span>}
            {modelKind && <span className="as-tag">{modelKind}</span>}
            {!isNew && isDirty && <span className="as-tag as-tag--dirty">UNSAVED</span>}
          </div>
        </div>
      </div>

      {/* ── Agent ID field (create mode only) ── */}
      {isNew && (
        <div className="as-agent-id-row">
          <div className="as-card" style={{ marginBottom: 0 }}>
            <div className="as-card-header">
              <span className="as-icon"><PencilIcon size={14} /></span>
              Agent Identity
            </div>
            <div className="as-field-row">
              <div className="as-label">Agent ID</div>
              <div style={{ flex: 1 }}>
                <input
                  className={`as-input${agentIdError ? ' as-input--error' : ''}`}
                  value={agentId}
                  placeholder="e.g. my-agent (lowercase, hyphens only)"
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                    setAgentId(val)
                    if (agentIdError) setAgentIdError('')
                  }}
                  spellCheck={false}
                  autoFocus
                />
                {agentIdError && (
                  <p className="as-field-error">{agentIdError}</p>
                )}
                <p className="as-field-hint">
                  This becomes the filename: <code>{agentId || 'agent-id'}.agent.md</code>
                </p>
              </div>
            </div>
            <div className="as-field-row">
              <div className="as-label">Display Name</div>
              <input
                className="as-input"
                value={draft.name ?? ''}
                placeholder="Human-readable name shown in the agent grid"
                onChange={(e) => setField('name', e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Two-column grid ── */}
      <div className="as-grid">

        {/* ── Left column ── */}
        <div className="as-col">

          {/* Model Configuration */}
          <div className="as-card">
            <div className="as-card-header">
              <span className="as-icon"><CpuIcon size={14} /></span>
              Model Configuration
            </div>

            {/* Mode */}
            <div className="as-field-row">
              <div className="as-label-row">
                <span className="as-label">Mode</span>
                <InfoTooltip text={PARAM_INFO.mode} />
              </div>
              <div className="as-seg-group">
                {['primary', 'fallback', 'subagent'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`as-seg-btn${draft.mode === m ? ' is-active' : ''}`}
                    onClick={() => setField('mode', m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="as-field-row">
              <div className="as-label-row">
                <span className="as-label">Primary LLM</span>
                <InfoTooltip text={PARAM_INFO.model} />
              </div>
              <ModelDropdown
                value={draft.model}
                ollamaModels={ollamaModels}
                onChange={(v) => setField('model', v)}
              />
            </div>

            {/* Description */}
            <div className="as-field-row">
              <div className="as-label-row">
                <span className="as-label">Description</span>
                <InfoTooltip text={PARAM_INFO.description} />
              </div>
              <input
                className="as-input"
                value={draft.description ?? ''}
                placeholder="Short description of this agent's role…"
                onChange={(e) => setField('description', e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          {/* System Prompt */}
          <div className="as-card as-card-flush">
            <div className="as-card-header">
              <div className="as-card-header-left">
                <span className="as-icon"><TerminalIcon size={14} /></span>
                System Prompt
                <InfoTooltip text={PARAM_INFO.systemPrompt} />
              </div>
              <button
                type="button"
                className="as-icon-btn"
                aria-label="Edit system prompt"
                onClick={() => setPromptEditorOpen(true)}
              >
                <PencilIcon size={14} />
              </button>
            </div>
            <pre className="as-instructions-body">
              {draft.prompt?.trim()
                ? draft.prompt
                : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No prompt set. Click the pencil to add one.</span>}
            </pre>
          </div>

          {/* Parameters */}
          <div className="as-card">
            <div className="as-card-header">
              <span className="as-icon"><SlidersIcon size={14} /></span>
              Parameters
            </div>

            {/* maxTokens */}
            <div className="as-param-row">
              <div className="as-param-row-header">
                <span className="as-label-row">
                  <span className="as-label">Max Output Tokens</span>
                  <InfoTooltip text={PARAM_INFO.maxTokens} />
                </span>
                <span className="as-param-value">{draft.maxTokens ?? '—'}</span>
              </div>
              <input
                type="range"
                className="as-range-input"
                min={1000} max={32000} step={500}
                value={draft.maxTokens ?? 8000}
                onChange={(e) => setField('maxTokens', Number(e.target.value))}
              />
              <div className="as-range-labels"><span>1k</span><span>32k</span></div>
            </div>

            {/* maxSteps */}
            <div className="as-param-row">
              <div className="as-param-row-header">
                <span className="as-label-row">
                  <span className="as-label">Max Steps</span>
                  <InfoTooltip text={PARAM_INFO.maxSteps} />
                </span>
                <span className="as-param-value">{draft.maxSteps ?? '—'}</span>
              </div>
              <input
                type="range"
                className="as-range-input"
                min={1} max={100} step={1}
                value={draft.maxSteps ?? 45}
                onChange={(e) => setField('maxSteps', Number(e.target.value))}
              />
              <div className="as-range-labels"><span>1</span><span>100</span></div>
            </div>

            {/* Temperature */}
            <div className="as-param-row">
              <div className="as-param-row-header">
                <span className="as-label-row">
                  <span className="as-label">Temperature</span>
                  <InfoTooltip text={PARAM_INFO.temperature} />
                </span>
                <span className="as-param-value">
                  {draft.options?.temperature != null ? draft.options.temperature.toFixed(2) : '—'}
                </span>
              </div>
              <input
                type="range"
                className="as-range-input"
                min={0} max={2} step={0.01}
                value={draft.options?.temperature ?? 0.7}
                onChange={(e) => setOption('temperature', parseFloat(e.target.value))}
              />
              <div className="as-range-labels"><span>0</span><span>2</span></div>
            </div>

            {/* Top P */}
            <div className="as-param-row">
              <div className="as-param-row-header">
                <span className="as-label-row">
                  <span className="as-label">Top P</span>
                  <InfoTooltip text={PARAM_INFO.topP} />
                </span>
                <span className="as-param-value">
                  {draft.options?.topP != null ? draft.options.topP.toFixed(2) : '—'}
                </span>
              </div>
              <input
                type="range"
                className="as-range-input"
                min={0} max={1} step={0.01}
                value={draft.options?.topP ?? 1}
                onChange={(e) => setOption('topP', parseFloat(e.target.value))}
              />
              <div className="as-range-labels"><span>0</span><span>1</span></div>
            </div>

            {/* Reasoning effort (for o-series / reasoning models) */}
            <div className="as-field-row">
              <div className="as-label-row">
                <span className="as-label">Reasoning Effort</span>
                <InfoTooltip text={PARAM_INFO.reasoningEffort} />
              </div>
              <div className="as-seg-group">
                {[null, 'low', 'medium', 'high'].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    className={`as-seg-btn${(draft.options?.reasoningEffort ?? null) === v ? ' is-active' : ''}`}
                    onClick={() => setOption('reasoningEffort', v)}
                  >
                    {v ?? 'off'}
                  </button>
                ))}
              </div>
            </div>

            {/* Extended Thinking toggle */}
            <div className="as-perm-item">
              <div className="as-perm-text">
                <span className="as-perm-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  Extended Thinking
                  <InfoTooltip text={PARAM_INFO.extendedThinking} />
                </span>
                <span className="as-perm-desc">Claude extended thinking (budgetTokens)</span>
              </div>
              <div
                className={`as-toggle${thinkingEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={thinkingEnabled}
                tabIndex={0}
                onClick={() => setThinking(!thinkingEnabled)}
                onKeyDown={(e) => e.key === ' ' || e.key === 'Enter' ? setThinking(!thinkingEnabled) : null}
                style={{ cursor: 'pointer' }}
              />
            </div>
            {thinkingEnabled && (
              <div className="as-param-row">
                <div className="as-param-row-header">
                  <span className="as-label-row">
                    <span className="as-label">Thinking Budget (tokens)</span>
                    <InfoTooltip text={PARAM_INFO.thinkingBudget} />
                  </span>
                  <span className="as-param-value">{draft.options.thinking?.budgetTokens ?? 8000}</span>
                </div>
                <input
                  type="range"
                  className="as-range-input"
                  min={1000} max={32000} step={1000}
                  value={draft.options.thinking?.budgetTokens ?? 8000}
                  onChange={(e) => setThinkingBudget(e.target.value)}
                />
                <div className="as-range-labels"><span>1k</span><span>32k</span></div>
              </div>
            )}
          </div>

        </div>

        {/* ── Right column ── */}
        <div className="as-col">

          {/* Tool Toggles */}
          <div className="as-card">
            <div className="as-card-header">
              <span className="as-icon"><WrenchIcon size={14} /></span>
              Tool Overrides
              <InfoTooltip text={PARAM_INFO.toolOverrides} />
            </div>
            <p className="as-card-hint">Explicitly enable or disable individual tools for this agent.</p>
            <div className="as-perm-list">
              {KNOWN_TOOLS.map((tool) => {
                const on = draft.tools?.[tool] === true
                return (
                  <div key={tool} className="as-perm-item">
                    <div className="as-perm-text">
                      <span className="as-perm-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {tool}
                        {TOOL_INFO[tool] && <InfoTooltip text={TOOL_INFO[tool]} />}
                      </span>
                    </div>
                    <div
                      className={`as-toggle${on ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={on}
                      tabIndex={0}
                      onClick={() => setTool(tool, !on)}
                      onKeyDown={(e) => e.key === ' ' || e.key === 'Enter' ? setTool(tool, !on) : null}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Permissions */}
          <div className="as-card">
            <div className="as-card-header">
              <span className="as-icon"><ShieldIcon size={14} /></span>
              Permissions
              <InfoTooltip text={PARAM_INFO.permissions} />
            </div>
            <p className="as-card-hint">Set allow / ask / deny per tool. Pattern blocks support glob-style matching.</p>

            {/* Simple string permissions */}
            <div className="as-perm-list">
              {simplePermKeys.map((key) => {
                const current = typeof draft.permission?.[key] === 'string' ? draft.permission[key] : ''
                return (
                  <div key={key} className="as-perm-item">
                    <span className="as-perm-title as-perm-key-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {key}
                      {PERM_KEY_INFO[key] && <InfoTooltip text={PERM_KEY_INFO[key]} />}
                    </span>
                    <PermSelect
                      value={current}
                      onChange={(v) => setSimplePerm(key, v === current ? '' : v)}
                    />
                  </div>
                )
              })}
            </div>

            {/* Complex pattern-map permissions */}
            <div className="as-perm-complex-list">
              {COMPLEX_PERM_KEYS.map((key) => {
                const patterns = typeof draft.permission?.[key] === 'object' && draft.permission[key] !== null
                  ? draft.permission[key]
                  : {}
                return (
                  <PatternBlock
                    key={key}
                    keyName={key}
                    patterns={patterns}
                    onChange={(p) => setComplexPerm(key, p)}
                  />
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ── Sticky save bar ── */}
      {(isNew || isDirty) && (
        <div className="as-save-bar">
          <span className="as-save-bar-hint">
            {isNew ? 'Fill in the details and create your agent' : 'You have unsaved changes'}
          </span>
          <div className="as-save-bar-actions">
            {!isNew && (
              <button
                type="button"
                className="as-discard-btn"
                onClick={() => {
                  setDraft(normalizeDraft(cloneAgent(agent)))
                  setIsDirty(false)
                }}
              >
                Discard
              </button>
            )}
            <button type="button" className="save-btn" onClick={handleSave}>
              <SaveIcon size={12} /> {isNew ? 'Create Agent' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── Markdown editor modal ── */}
      {promptEditorOpen && (
        <MarkdownEditorModal
          value={draft.prompt ?? ''}
          onSave={(v) => setField('prompt', v)}
          onClose={() => setPromptEditorOpen(false)}
        />
      )}
    </div>
  )
}
