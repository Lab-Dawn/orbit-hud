// The page's only way out: a few named calls, no file system or Node of its own.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('hud', {
  area: () => ipcRenderer.invoke('area'),
  prefs: () => ipcRenderer.invoke('prefs'),
  lang: () => ipcRenderer.invoke('lang'),
  platform: () => ipcRenderer.invoke('platform'),
  savePrefs: value => ipcRenderer.send('save-prefs', value),
  pointer: isOverPiece => ipcRenderer.send('pointer', isOverPiece),
  moveCore: point => ipcRenderer.invoke('move-core', point),
  readSessions: () => ipcRenderer.invoke('read-sessions'),
  readFile: rel => ipcRenderer.invoke('read-file', rel),
  fileStamp: rel => ipcRenderer.invoke('file-stamp', rel),
  writeFile: (rel, text) => ipcRenderer.send('write-file', rel, text),
  writePng: (rel, dataUrl) => ipcRenderer.send('write-png', rel, dataUrl),
  appSession: cliId => ipcRenderer.invoke('app-session', cliId),
  // A file picked or dropped has a path on disk; a pasted one (a screenshot) is saved.
  pathOf: file => webUtils.getPathForFile(file),
  saveAttachment: (name, bytes) => ipcRenderer.invoke('save-attachment', name, bytes),
  openLink: url => ipcRenderer.send('open-link', url),
  hide: () => ipcRenderer.send('hide'),
  menu: scale => ipcRenderer.send('menu', scale),
  snap: rect => ipcRenderer.send('snap', rect),
  failure: text => ipcRenderer.send('failure', text),
  on: (channel, listener) => {
    if (['area', 'hidden', 'debug', 'scale', 'reset-position', 'lang'].includes(channel)) {
      ipcRenderer.on(channel, (_e, value) => listener(value))
    }
  },
})
