// Preload: the only bridge between the sandboxed overlay page and the main
// process. contextIsolation is ON; the renderer never touches Node or the
// API key — image crops go up, answer text streams down.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drawToAsk', {
  // main → renderer
  onSessionStart: (cb) => ipcRenderer.on('session:start', (_e, data) => cb(data)),
  onSessionCancel: (cb) => ipcRenderer.on('session:cancel', () => cb()),
  onSessionError: (cb) => ipcRenderer.on('session:error', (_e, data) => cb(data)),
  onPermissionNeeded: (cb) => ipcRenderer.on('session:permission-needed', () => cb()),
  onAnswerChunk: (cb) => ipcRenderer.on('answer:chunk', (_e, data) => cb(data)),
  onAnswerDone: (cb) => ipcRenderer.on('answer:done', (_e, data) => cb(data)),
  onAnswerError: (cb) => ipcRenderer.on('answer:error', (_e, data) => cb(data)),

  // renderer → main
  ask: (payload) => ipcRenderer.invoke('ask', payload),
  saveNote: (payload) => ipcRenderer.invoke('note:save', payload),
  endSession: (opts) => ipcRenderer.send('session:end', opts),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('overlay:set-ignore-mouse', ignore),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
  markWelcomeSeen: () => ipcRenderer.send('settings:mark-welcome-seen'),
  openPermissionSettings: () => ipcRenderer.send('permissions:open-settings'),
});
