const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Config path management
  getConfigPath: () => ipcRenderer.invoke('config:get-path'),
  setConfigPath: (dirPath) => ipcRenderer.invoke('config:set-path', dirPath),
  selectFolder: () => ipcRenderer.invoke('config:select-folder'),

  // Config read/write
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (payload) => ipcRenderer.invoke('config:write', payload),

  // Ollama
  listOllamaModels: () => ipcRenderer.invoke('ollama:list-models'),
  getOllamaModelDetail: (modelName) =>
    ipcRenderer.invoke('ollama:get-model-detail', modelName),

  // Agent file creation
  createAgentFile: (agentId, agentData) => ipcRenderer.invoke('agent:create-file', { agentId, agentData }),

  // Agent raw markdown read/write
  readAgentFile: (agentId) => ipcRenderer.invoke('agent:read-file', agentId),
  writeAgentFile: (agentId, content) => ipcRenderer.invoke('agent:write-file', { agentId, content }),

  // Skills
  listSkills: () => ipcRenderer.invoke('skills:list'),

  // Project scaffolding
  getScaffoldCatalog: () => ipcRenderer.invoke('scaffold:catalog'),
  getScaffoldTarget: () => ipcRenderer.invoke('scaffold:target-info'),
  previewScaffold: (selections) => ipcRenderer.invoke('scaffold:preview', selections),
  runScaffold: (selections) => ipcRenderer.invoke('scaffold:sync', selections),
  doctorScaffold: (selections) => ipcRenderer.invoke('scaffold:doctor', selections),

  // System info
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),

  // Gate (Review Queue)
  listReviews: () => ipcRenderer.invoke('gate:list'),
  listArchivedReviews: () => ipcRenderer.invoke('gate:list-archive'),
  readReview: (id) => ipcRenderer.invoke('gate:read', id),
  decideReview: (payload) => ipcRenderer.invoke('gate:decide', payload),
  setupGateMcpEntry: () => ipcRenderer.invoke('gate:setup-mcp-entry'),
  // Subscribe to live queue/decision pushes; returns an unsubscribe function.
  onReviewUpdate: (cb) => {
    const l = (_e, d) => cb(d)
    ipcRenderer.on('gate:updated', l)
    return () => ipcRenderer.removeListener('gate:updated', l)
  },
})
