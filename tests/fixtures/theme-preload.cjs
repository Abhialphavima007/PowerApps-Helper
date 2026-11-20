// Synthetic APIs for the isolated theme UI checks. No credentials or cloud calls.
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('theme-test:settings-get'),
    save: (patch) => ipcRenderer.invoke('theme-test:settings-save', patch)
  },
  auth: {
    status: () => ipcRenderer.invoke('theme-test:auth-status'),
    onProgress: (callback) => subscribe('auth:progress', callback),
    cancel: () => ipcRenderer.invoke('theme-test:cancel')
  },
  ai: { providers: async () => ({}) },
  env: { list: async () => ({ ok: true, environments: [] }) },
  credentials: { status: async () => ({}) },
  deploy: { onProgress: (callback) => subscribe('deploy:progress', callback) },
  notifications: { onDeployment: (callback) => subscribe('deployment:notification', callback) },
  history: {
    list: async () => [{ id: 'synthetic-deployment', createdAt: '2026-11-20T00:00:00Z', solution: 'Synthetic Solution', version: '1.0.0.0', sourceEnv: 'Source', targetEnv: 'Target', exportManaged: true, status: 'success', notes: 'Synthetic deployment notes' }]
  }
});
