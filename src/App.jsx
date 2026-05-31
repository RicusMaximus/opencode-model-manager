import React, { useState, useEffect, useCallback, useRef } from "react";
import TitleBar from "./components/TitleBar.jsx";
import Sidebar from "./components/Sidebar.jsx";
import AgentPanel from "./components/AgentPanel.jsx";
import AgentSettingsPanel from "./components/AgentSettingsPanel.jsx";
import OllamaPanel from "./components/OllamaPanel.jsx";
import RightSidebar from "./components/RightSidebar.jsx";
import StatusBar from "./components/StatusBar.jsx";

const api = window.electronAPI;

// Hardcoded agent metadata (colors + fallback descriptions).
// The display names and descriptions are overridden by .agent.md frontmatter when available.
const AGENT_META = {
  "agent-orchestrator": {
    color: "#59a6ff",
    fallbackName: "Orchestrator",
    fallbackDesc: "Routes tasks and manages the agent pipeline."
  },
  builder: {
    color: "#26a540",
    fallbackName: "Builder",
    fallbackDesc: "Implements features and writes production-quality code."
  },
  architect: {
    color: "#d19921",
    fallbackName: "Architect",
    fallbackDesc: "Plans system design and technical decisions."
  },
  validator: {
    color: "#940009",
    fallbackName: "Validator",
    fallbackDesc: "Verifies correctness and runs tests."
  },
  scribe: {
    color: "#404752",
    fallbackName: "Scribe",
    fallbackDesc: "Generates documentation and commit messages."
  },
  ux_ui_designer: {
    color: "#59a6ff",
    fallbackName: "UX/UI Designer",
    fallbackDesc: "Designs interfaces and refines UX."
  }
};

function getAgentColor(id) {
  return AGENT_META[id]?.color ?? "#404752";
}

export default function App() {
  const [activeView, setActiveView] = useState("agents");
  const [settingsAgentId, setSettingsAgentId] = useState(null);
  const [configPath, setConfigPath] = useState("");
  // Pre-populate with hardcoded defaults so the grid renders immediately;
  // config load will override with real model assignments.
  const [agents, setAgents] = useState(() =>
    Object.entries(AGENT_META).map(([id, meta]) => ({
      id,
      displayName: meta.fallbackName,
      description: meta.fallbackDesc,
      model: null,
      disabled: false,
      _extra: {},
      color: meta.color
    }))
  );
  const [defaultModel, setDefaultModel] = useState(
    "anthropic/claude-sonnet-4-6"
  );
  const [ollamaProviderModels, setOllamaProviderModels] = useState({});
  const [ollamaStatus, setOllamaStatus] = useState({
    connected: false,
    models: []
  });
  const [systemInfo, setSystemInfo] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Snapshot for dirty-check — initialised after config load
  const originalRef = useRef(null);
  const configLoadedRef = useRef(false);

  // ── Initial load ─────────────────────────────────────────────────
  useEffect(() => {
    if (!api) return;

    // Load config path, then read config
    api
      .getConfigPath()
      .then((p) => {
        setConfigPath(p || "");
        return api.readConfig();
      })
      .then((data) => {
        if (!data) return;
        setDefaultModel(data.defaultModel || "anthropic/claude-sonnet-4-6");
        setOllamaProviderModels(data.ollamaProviderModels || {});

        // Merge config agents with hardcoded metadata (color + fallback text)
        const merged = (data.agents || [])
          .filter((a) => !a.disabled) // hide disabled built-in agents
          .map((a) => ({
            ...a,
            color: getAgentColor(a.id),
            displayName:
              a.displayName || AGENT_META[a.id]?.fallbackName || a.id,
            description: a.description || AGENT_META[a.id]?.fallbackDesc || ""
            // tools, version, mode come through from main.js as-is
          }));

        // If config has no agents yet, fall back to defaults derived from AGENT_META
        const agentList =
          merged.length > 0
            ? merged
            : Object.entries(AGENT_META).map(([id, meta]) => ({
                id,
                displayName: meta.fallbackName,
                description: meta.fallbackDesc,
                model: null,
                disabled: false,
                _extra: {},
                color: meta.color
              }));

        setAgents(agentList);
        originalRef.current = JSON.stringify(agentList);
      })
      .catch(console.error);

    // Poll Ollama every 10s
    const pollOllama = () => {
      api
        .listOllamaModels()
        .then(setOllamaStatus)
        .catch(() => setOllamaStatus({ connected: false, models: [] }));
    };
    pollOllama();
    const ollamaTimer = setInterval(pollOllama, 10000);

    // System info every 5s
    const pollSys = () =>
      api
        .getSystemInfo()
        .then(setSystemInfo)
        .catch(() => {});
    pollSys();
    const sysTimer = setInterval(pollSys, 5000);

    return () => {
      clearInterval(ollamaTimer);
      clearInterval(sysTimer);
    };
  }, []);

  // ── Agent model change ────────────────────────────────────────────
  const handleAgentModelChange = useCallback((agentId, newModel) => {
    setAgents((prev) => {
      const next = prev.map((a) =>
        a.id === agentId ? { ...a, model: newModel } : a
      );
      setIsDirty(JSON.stringify(next) !== originalRef.current);
      return next;
    });
  }, []);

  // ── Agent settings save (from AgentSettingsPanel) ─────────────────
  // Called with the full updated agent draft. Merges it back into agents[].
  const handleAgentSettingsSave = useCallback((updatedAgent) => {
    setAgents((prev) => {
      const next = prev.map((a) =>
        a.id === updatedAgent.id ? { ...a, ...updatedAgent } : a
      );
      // Immediately persist to disk
      const providerModels = {};
      for (const m of ollamaStatus.models || []) {
        const id = m.name.replace(/:latest$/, "");
        providerModels[id] = { name: id };
      }
      const api = window.electronAPI;
      if (api) {
        api.writeConfig({ defaultModel, ollamaProviderModels: providerModels, agents: next })
          .then(() => {
            setLastSaved(new Date());
            originalRef.current = JSON.stringify(next);
            setIsDirty(false);
          })
          .catch(console.error);
      }
      return next;
    });
  }, [defaultModel, ollamaStatus.models, ollamaProviderModels]);

  // ── New agent save (from AgentSettingsPanel in create mode) ────────
  // draft: the form fields, agentId: the slug that becomes the filename
  const handleNewAgentSave = useCallback(async (draft, agentId) => {
    if (!api) return;
    try {
      // 1. Write the .agent.md file
      await api.createAgentFile(agentId, {
        name: draft.name || agentId,
        description: draft.description || '',
        version: draft.version || '',
        mode: draft.mode || 'subagent',
        prompt: draft.prompt || '',
      });

      // 2. Build the new agent entry to add to state
      const newAgent = {
        id: agentId,
        displayName: draft.name || agentId,
        description: draft.description || '',
        version: draft.version || '',
        mode: draft.mode || 'subagent',
        model: draft.model ?? null,
        prompt: draft.prompt ?? null,
        maxTokens: draft.maxTokens ?? null,
        maxSteps: draft.maxSteps ?? null,
        options: draft.options ?? {},
        tools: draft.tools ?? {},
        permission: draft.permission ?? {},
        disabled: false,
        _extra: {},
        color: getAgentColor(agentId), // uses AGENT_META color or default #404752
        responsibilities: [],
        rules: [],
      };

      // 3. Merge into agents state and persist to opencode.jsonc
      setAgents((prev) => {
        const next = [...prev, newAgent];
        const providerModels = {};
        for (const m of ollamaStatus.models || []) {
          const id = m.name.replace(/:latest$/, "");
          providerModels[id] = { name: id };
        }
        api.writeConfig({ defaultModel, ollamaProviderModels: providerModels, agents: next })
          .then(() => {
            setLastSaved(new Date());
            originalRef.current = JSON.stringify(next);
            setIsDirty(false);
          })
          .catch(console.error);
        return next;
      });

      // 4. Navigate back to the agents grid
      setActiveView("agents");
    } catch (err) {
      console.error("Failed to create agent:", err);
    }
  }, [defaultModel, ollamaStatus.models]);

  // ── Browse (folder picker) ────────────────────────────────────────
  const handleBrowse = useCallback(async () => {
    if (!api) return;
    const selected = await api.selectFolder();
    if (selected) {
      await api.setConfigPath(selected);
      setConfigPath(selected);
    }
  }, []);

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!api || isSaving) return;
    setIsSaving(true);
    try {
      // Build ollamaProviderModels from current Ollama API models
      const providerModels = {};
      for (const m of ollamaStatus.models || []) {
        const id = m.name.replace(/:latest$/, "");
        providerModels[id] = {
          name: ollamaProviderModels[id]?.name ?? id
        };
      }

      // Include any in config but not in Ollama (stale, preserve)
      for (const [id, meta] of Object.entries(ollamaProviderModels)) {
        if (!providerModels[id]) providerModels[id] = meta;
      }

      console.log({
        defaultModel,
        ollamaProviderModels: providerModels,
        agents
      });

      await api.writeConfig({
        defaultModel,
        ollamaProviderModels: providerModels,
        agents
      });

      setLastSaved(new Date());
      setIsDirty(false);
      originalRef.current = JSON.stringify(agents);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [agents, defaultModel, ollamaProviderModels, ollamaStatus, isSaving]);

  return (
    <div className="app-root">
      <TitleBar configPath={configPath} onBrowse={handleBrowse} />
      <div className="app-body">
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          configPath={configPath}
          ollamaStatus={ollamaStatus}
        />
        <main className="app-main">
          {activeView === "agents" && (
            <AgentPanel
              agents={agents}
              ollamaModels={ollamaStatus.models}
              onModelChange={handleAgentModelChange}
              onOpenSettings={(agentId) => {
                setSettingsAgentId(agentId);
                setActiveView("agent-settings");
              }}
              onCreateAgent={() => setActiveView("agent-new")}
            />
          )}
          {activeView === "agent-settings" && (
            <AgentSettingsPanel
              agent={agents.find((a) => a.id === settingsAgentId) ?? agents[0]}
              ollamaModels={ollamaStatus.models}
              onBack={() => setActiveView("agents")}
              onSave={handleAgentSettingsSave}
            />
          )}
          {activeView === "agent-new" && (
            <AgentSettingsPanel
              isNew={true}
              ollamaModels={ollamaStatus.models}
              onBack={() => setActiveView("agents")}
              onSave={handleNewAgentSave}
            />
          )}
          {activeView === "models" && (
            <OllamaPanel
              ollamaModels={ollamaStatus.models}
              ollamaConnected={ollamaStatus.connected}
              systemInfo={systemInfo}
            />
          )}
          {activeView === "system" && (
            <div className="system-full-view">
              <RightSidebar
                activeView="system"
                systemInfo={systemInfo}
                ollamaStatus={ollamaStatus}
                expanded
              />
            </div>
          )}
        </main>
        <RightSidebar
          activeView={activeView}
          systemInfo={systemInfo}
          ollamaStatus={ollamaStatus}
        />
      </div>
      <StatusBar
        ollamaStatus={ollamaStatus}
        lastSaved={lastSaved}
        onSave={handleSave}
        isSaving={isSaving}
        isDirty={isDirty}
      />
    </div>
  );
}
