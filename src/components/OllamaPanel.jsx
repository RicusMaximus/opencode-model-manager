import React, { useState } from 'react'
import ModelCard from './ModelCard.jsx'

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function FilterIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 4H14M4.5 8H11.5M7 12H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2V14M2 8H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function OllamaPanel({ ollamaModels, ollamaConnected }) {
  const [search, setSearch] = useState('')

  const filtered = ollamaModels.filter((m) =>
    (m.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="ollama-panel">
      {/* Toolbar */}
      <div className="ollama-toolbar">
        <div className="search-wrap">
          <span className="search-icon">
            <SearchIcon size={16} />
          </span>
          <input
            className="search-input"
            type="text"
            placeholder="Search locally installed models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="filter-btn" type="button">
          <FilterIcon size={16} />
          Filter
        </button>
        <button className="pull-model-btn" type="button">
          <PlusIcon size={16} />
          Pull Model
        </button>
      </div>

      {/* Grid */}
      {!ollamaConnected ? (
        <div className="models-empty">
          <p>Ollama is not connected. Start Ollama to see locally installed models.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="models-empty">
          {search
            ? `No models match "${search}".`
            : 'No local models installed. Use "Pull Model" to download one.'}
        </div>
      ) : (
        <div className="model-grid">
          {filtered.map((model) => (
            <ModelCard key={model.name} model={model} />
          ))}
        </div>
      )}
    </div>
  )
}
