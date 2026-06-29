import React, { useState, useEffect, useMemo, useCallback } from 'react'

const api = window.electronAPI

// Capability form for the Project Scaffolding Tool (spec §6). Scoped to the
// active workspace (resolved in main via getConfigDir()); there is no folder
// picker here — the user switches projects via Browse first.
export default function ScaffoldModal({ onClose, onScaffolded }) {
  const [catalog, setCatalog] = useState(null)
  const [target, setTarget] = useState(null)
  const [globalAgents, setGlobalAgents] = useState(null) // { dir, agents: [{id,name}] }

  // — selections —
  const [servers, setServers] = useState({})          // { [id]: true }
  const [authProfile, setAuthProfile] = useState({})  // { [id]: profileId }
  const [configValues, setConfigValues] = useState({})// { [envVar]: value }
  const [skills, setSkills] = useState({})            // { [id]: true }
  const [includeAgents, setIncludeAgents] = useState(true) // copy global agents (default on)
  const [projectMemory, setProjectMemory] = useState(false)
  const [memoryFolder, setMemoryFolder] = useState('project-memory')
  const [specsFolder, setSpecsFolder] = useState(false)

  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!api) return
    api.getScaffoldCatalog().then(setCatalog).catch(() => setCatalog({ mcp: {}, skills: {} }))
    api.getScaffoldTarget().then(setTarget).catch(() => setTarget(null))
    api.getScaffoldGlobalAgents?.().then(setGlobalAgents).catch(() => setGlobalAgents({ dir: '', agents: [] }))
  }, [])

  const agentCount = globalAgents?.agents?.length ?? 0

  // Build the selections object the engine expects.
  const selections = useMemo(() => ({
    mcpServers: Object.keys(servers).filter((id) => servers[id]),
    authProfile,
    configValues,
    skills: Object.keys(skills).filter((id) => skills[id]),
    includeAgents: includeAgents && agentCount > 0,
    projectMemory,
    memoryFolder,
    specsFolder,
  }), [servers, authProfile, configValues, skills, includeAgents, agentCount, projectMemory, memoryFolder, specsFolder])

  // Live preview — debounced dry run whenever the selection changes (spec §6).
  useEffect(() => {
    if (!api || !catalog) return
    let cancelled = false
    const t = setTimeout(() => {
      api.previewScaffold(selections)
        .then((res) => { if (!cancelled) setPreview(res) })
        .catch(() => {})
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [selections, catalog])

  const toggleServer = useCallback((id, descriptor) => {
    setServers((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      return next
    })
    setAuthProfile((prev) => (prev[id] ? prev : { ...prev, [id]: descriptor.defaultAuthProfile }))
  }, [])

  // The config-input fields to prompt: required `config` inputs with no default,
  // belonging to a selected server's active profile (spec §6 form behaviour).
  const configPrompts = useMemo(() => {
    if (!catalog) return []
    const out = []
    const seen = new Set()
    for (const id of Object.keys(servers).filter((s) => servers[s])) {
      const desc = catalog.mcp[id]
      if (!desc) continue
      const profileId = authProfile[id] || desc.defaultAuthProfile
      const profile = desc.authProfiles[profileId]
      if (!profile) continue
      for (const input of profile.inputs) {
        if (input.kind === 'config' && input.defaultValue === undefined && !seen.has(input.envVar)) {
          seen.add(input.envVar)
          out.push({ envVar: input.envVar, prompt: input.prompt || input.envVar, required: input.required })
        }
      }
    }
    return out
  }, [catalog, servers, authProfile])

  const handleSubmit = useCallback(async () => {
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.runScaffold(selections)
      if (res?.error) { setError(res.error); return }
      setSummary(res)
      onScaffolded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [selections, busy, onScaffolded])

  const isGlobal = target?.isGlobal
  const needsSecretsFolder = preview?.needsSecretsFolder

  return (
    <div className="scaffold-overlay" onClick={onClose}>
      <div className="scaffold-modal" onClick={(e) => e.stopPropagation()}>
        <header className="scaffold-modal__header">
          <div>
            <h2>Scaffold project</h2>
            {target && (
              <p className="scaffold-modal__target">
                Scaffolding into <strong>{target.name}</strong> — <span>{target.root?.replace(/\\/g, '/')}</span>
              </p>
            )}
          </div>
          <button className="btn btn--icon" onClick={onClose} title="Close">✕</button>
        </header>

        {isGlobal ? (
          <div className="scaffold-modal__body">
            <p className="scaffold-warn">
              The active workspace is the global OpenCode config. Browse to a project folder first.
            </p>
          </div>
        ) : summary ? (
          <SummaryView summary={summary} onClose={onClose} />
        ) : (
          <>
            <div className="scaffold-modal__body">
              {!catalog && <p>Loading catalog…</p>}

              {catalog && (
                <>
                  {/* MCP servers */}
                  <section className="scaffold-section">
                    <h3>MCP servers</h3>
                    {Object.values(catalog.mcp).map((desc) => {
                      const checked = !!servers[desc.id]
                      const activeProfile = authProfile[desc.id] || desc.defaultAuthProfile
                      return (
                        <div key={desc.id} className="scaffold-row">
                          <label className="scaffold-check">
                            <input type="checkbox" checked={checked} onChange={() => toggleServer(desc.id, desc)} />
                            <span>{desc.label}</span>
                          </label>
                          {checked && (
                            <div className="scaffold-profiles">
                              {Object.values(desc.authProfiles).map((p) => (
                                <label key={p.id} className="scaffold-radio">
                                  <input
                                    type="radio"
                                    name={`auth-${desc.id}`}
                                    checked={activeProfile === p.id}
                                    onChange={() => setAuthProfile((prev) => ({ ...prev, [desc.id]: p.id }))}
                                  />
                                  <span>{p.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </section>

                  {/* Config prompts */}
                  {configPrompts.length > 0 && (
                    <section className="scaffold-section">
                      <h3>Configuration values</h3>
                      {configPrompts.map((c) => (
                        <label key={c.envVar} className="scaffold-field">
                          <span>{c.prompt}{c.required ? ' *' : ''}</span>
                          <input
                            type="text"
                            value={configValues[c.envVar] || ''}
                            placeholder={c.envVar}
                            onChange={(e) => setConfigValues((prev) => ({ ...prev, [c.envVar]: e.target.value }))}
                          />
                        </label>
                      ))}
                    </section>
                  )}

                  {/* Skills */}
                  <section className="scaffold-section">
                    <h3>Skills</h3>
                    {Object.values(catalog.skills).length === 0 && <p className="scaffold-muted">No skills in catalog.</p>}
                    {Object.values(catalog.skills).map((s) => (
                      <label key={s.id} className="scaffold-check">
                        <input
                          type="checkbox"
                          checked={!!skills[s.id]}
                          onChange={() => setSkills((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                        />
                        <span>{s.name} — <em>{s.description}</em></span>
                      </label>
                    ))}
                  </section>

                  {/* Agents — copy all from the user's global agents folder */}
                  <section className="scaffold-section">
                    <h3>Agents</h3>
                    <label className={`scaffold-check${agentCount === 0 ? ' scaffold-check--disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={includeAgents && agentCount > 0}
                        disabled={agentCount === 0}
                        onChange={() => setIncludeAgents((v) => !v)}
                      />
                      <span>
                        Copy agents from your global config
                        {globalAgents && (
                          <em> — {agentCount} found{agentCount > 0 ? `: ${globalAgents.agents.map((a) => a.id).join(', ')}` : ''}</em>
                        )}
                      </span>
                    </label>
                    {globalAgents && agentCount === 0 && (
                      <p className="scaffold-muted">No <code>.agent.md</code> files in your global agents folder.</p>
                    )}
                  </section>

                  {/* Project memory */}
                  <section className="scaffold-section">
                    <h3>Project memory</h3>
                    <label className="scaffold-check">
                      <input type="checkbox" checked={projectMemory} onChange={() => setProjectMemory((v) => !v)} />
                      <span>Obsidian project-memory vault</span>
                    </label>
                    {projectMemory && (
                      <label className="scaffold-field">
                        <span>Folder name</span>
                        <input type="text" value={memoryFolder} onChange={(e) => setMemoryFolder(e.target.value)} />
                      </label>
                    )}
                  </section>

                  {/* Specs folder */}
                  <section className="scaffold-section">
                    <h3>Specs folder</h3>
                    <label className="scaffold-check">
                      <input type="checkbox" checked={specsFolder} onChange={() => setSpecsFolder((v) => !v)} />
                      <span>Create <code>specs/</code> with README + SDD template</span>
                    </label>
                  </section>

                  {/* Secrets folder — implied, explanatory only */}
                  <section className="scaffold-section">
                    <h3>Secrets folder</h3>
                    <label className="scaffold-check scaffold-check--disabled">
                      <input type="checkbox" checked={!!needsSecretsFolder} disabled readOnly />
                      <span>
                        <code>.opencode-secrets/</code>{' '}
                        {needsSecretsFolder
                          ? '— required by a selected server\'s auth profile'
                          : '— added automatically when a server needs a secret file'}
                      </span>
                    </label>
                  </section>
                </>
              )}
            </div>

            {/* Live preview + footer */}
            <footer className="scaffold-modal__footer">
              <div className="scaffold-preview">
                {preview?.error && <span className="scaffold-warn">{preview.error}</span>}
                {preview && !preview.error && (
                  <>
                    <div>
                      <strong>Will create ({preview.willCreate.length}):</strong>{' '}
                      {preview.willCreate.length ? preview.willCreate.join(', ') : '—'}
                    </div>
                    {preview.willSkip.length > 0 && (
                      <div className="scaffold-muted">
                        <strong>Skip (exists):</strong> {preview.willSkip.join(', ')}
                      </div>
                    )}
                  </>
                )}
                {error && <div className="scaffold-warn">Error: {error}</div>}
              </div>
              <div className="scaffold-actions">
                <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn--primary" onClick={handleSubmit} disabled={busy}>
                  {busy ? 'Scaffolding…' : 'Scaffold'}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryView({ summary, onClose }) {
  return (
    <>
      <div className="scaffold-modal__body">
        <section className="scaffold-section">
          <h3>Created ({summary.created?.length || 0})</h3>
          <ul className="scaffold-list">
            {(summary.created || []).map((f) => <li key={f}>+ {f}</li>)}
          </ul>
        </section>
        {summary.skipped?.length > 0 && (
          <section className="scaffold-section">
            <h3>Skipped — already existed ({summary.skipped.length})</h3>
            <ul className="scaffold-list scaffold-muted">
              {summary.skipped.map((f) => <li key={f}>= {f}</li>)}
            </ul>
          </section>
        )}
        {summary.needsFill?.length > 0 && (
          <section className="scaffold-section">
            <h3 className="scaffold-warn">Still needs a real value ({summary.needsFill.length})</h3>
            <ul className="scaffold-list">
              {summary.needsFill.map((n, i) => (
                <li key={i}>⚠ {n.file ? n.file : n.envVar} {n.config ? '(config left blank)' : ''}</li>
              ))}
            </ul>
          </section>
        )}
        {summary.warnings?.length > 0 && (
          <section className="scaffold-section">
            {summary.warnings.map((w, i) => <p key={i} className="scaffold-warn">⚠ {w}</p>)}
          </section>
        )}
      </div>
      <footer className="scaffold-modal__footer">
        <div className="scaffold-preview" />
        <div className="scaffold-actions">
          <button className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </footer>
    </>
  )
}
