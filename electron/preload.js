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

  // System info
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
})
