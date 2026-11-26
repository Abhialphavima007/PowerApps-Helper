'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    add: (options) => ipcRenderer.invoke('auth:add', options),
    setMethod: (method) => ipcRenderer.invoke('auth:setMethod', method),
    setActive: (id) => ipcRenderer.invoke('auth:setActive', id),
    signOut: (id) => ipcRenderer.invoke('auth:signOut', id),
    cancel: () => ipcRenderer.invoke('auth:cancel'),
    onProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on('auth:progress', listener);
      return () => ipcRenderer.removeListener('auth:progress', listener);
    }
  },
  env: {
    list: () => ipcRenderer.invoke('env:list')
  },
  solution: {
    list: (orgUrl) => ipcRenderer.invoke('solution:list', orgUrl)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    getClientName: () => ipcRenderer.invoke('settings:clientName:get'),
    saveClientName: (value, account) => ipcRenderer.invoke('settings:clientName:save', value, account),
    chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder')
  },
  credentials: {
    status: () => ipcRenderer.invoke('credentials:status'),
    save: (name, value) => ipcRenderer.invoke('credentials:save', name, value),
    remove: (name) => ipcRenderer.invoke('credentials:remove', name),
    reveal: (name) => ipcRenderer.invoke('credentials:reveal', name)
  },
  devops: {
    fetch: (references, onProgress) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      const listener = (_e, data) => { if (data.requestId === requestId && onProgress) onProgress(data); };
      ipcRenderer.on('devops:progress', listener);
      return ipcRenderer.invoke('devops:fetch', references, requestId).finally(() => ipcRenderer.removeListener('devops:progress', listener));
    }
  },
  oneDrive: {
    connect: () => ipcRenderer.invoke('onedrive:connect')
  },
  ai: {
    providers: () => ipcRenderer.invoke('ai:providers'),
    generateNotes: (payload) => ipcRenderer.invoke('ai:generateNotes', payload),
    summarizeWorkItems: (payload, onProgress) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      const listener = (_e, data) => { if (data.requestId === requestId && onProgress) onProgress(data); };
      ipcRenderer.on('ai:progress', listener);
      return ipcRenderer.invoke('ai:summarizeWorkItems', payload, requestId).finally(() => ipcRenderer.removeListener('ai:progress', listener));
    }
  },
  deploy: {
    exportSolution: (params) => ipcRenderer.invoke('deploy:export', params),
    importSolution: (params) => ipcRenderer.invoke('deploy:import', params),
    runAgent: (snapshot) => ipcRenderer.invoke('deploy:agent', snapshot),
    inspectFile: (filePath) => ipcRenderer.invoke('deploy:inspectFile', { filePath }),
    pickZip: () => ipcRenderer.invoke('dialog:pickZip'),
    record: (record) => ipcRenderer.invoke('deploy:record', record),
    onProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('deploy:progress', listener);
      return () => ipcRenderer.removeListener('deploy:progress', listener);
    }
  },
  notifications: {
    setupStatus: () => ipcRenderer.invoke('automation:status'),
    retryPending: () => ipcRenderer.invoke('automation:retry'),
    onDeployment: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on('deployment:notification', listener);
      return () => ipcRenderer.removeListener('deployment:notification', listener);
    }
  },
  teams: {
    connect: (expectedTransport) => ipcRenderer.invoke('teams:connect', expectedTransport),
    checkWorkflow: () => ipcRenderer.invoke('teams:checkWorkflow'),
    revealWorkflow: () => ipcRenderer.invoke('teams:revealWorkflow'),
    saveWorkflow: (url, choices) => ipcRenderer.invoke('teams:saveWorkflow', url, choices),
    removeWorkflow: () => ipcRenderer.invoke('teams:removeWorkflow'),
    status: () => ipcRenderer.invoke('teams:status'),
    onProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on('teams:progress', listener);
      return () => ipcRenderer.removeListener('teams:progress', listener);
    }
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    query: (options) => ipcRenderer.invoke('history:query', options),
    matchingIds: (filters) => ipcRenderer.invoke('history:matchingIds', filters),
    get: (id) => ipcRenderer.invoke('history:get', id),
    delete: (ids) => ipcRenderer.invoke('history:delete', ids),
    export: (ids, format) => ipcRenderer.invoke('history:export', ids, format)
  },
  git: {
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', { cwd, message })
  },
  util: {
    revealPath: (p) => ipcRenderer.invoke('open:path', p),
    openExternal: (url) => ipcRenderer.invoke('open:external', url),
    artifactsDir: () => ipcRenderer.invoke('artifacts:dir')
  }
});
