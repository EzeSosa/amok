'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getRoot: () => ipcRenderer.invoke('root:get'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  listFiles: () => ipcRenderer.invoke('files:list'),
  readFile: (rel) => ipcRenderer.invoke('file:read', rel),
  writeFile: (rel, content, eol, bom) => ipcRenderer.invoke('file:write', rel, content, eol, bom),
  exists: (rel) => ipcRenderer.invoke('file:exists', rel),
  search: (query, opts) => ipcRenderer.invoke('search', query, opts),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (rel) => ipcRenderer.invoke('git:diff', rel),
  onGitChanged: (cb) => ipcRenderer.on('git:changed', () => cb()),
  getState: () => ipcRenderer.invoke('state:get'),
  updateState: (patch) => ipcRenderer.send('state:update', patch),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  toggleDevtools: () => ipcRenderer.send('devtools'),
  setZoom: (factor) => ipcRenderer.send('zoom:set', factor),
  setTheme: (name) => ipcRenderer.send('theme:set', name),
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  onFsChanged: (cb) => ipcRenderer.on('fs:changed', (_e, changes) => cb(changes)),
  onRootChanged: (cb) => ipcRenderer.on('root:changed', (_e, r) => cb(r)),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
});
