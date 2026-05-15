'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sharpSplat', {
  selectInput: () => ipcRenderer.invoke('select-input'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  inspectInput: (inputPath, opts) => ipcRenderer.invoke('inspect-input', inputPath, opts),
  checkRuntime: () => ipcRenderer.invoke('check-runtime'),
  installRuntime: () => ipcRenderer.invoke('install-runtime'),
  runSharp: (request) => ipcRenderer.invoke('run-sharp', request),
  checkPixal3D: () => ipcRenderer.invoke('check-pixal3d'),
  installPixal3D: (request) => ipcRenderer.invoke('install-pixal3d', request),
  runPixal3D: (request) => ipcRenderer.invoke('run-pixal3d', request),
  cancelJob: () => ipcRenderer.invoke('cancel-job'),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  loadPlyPreview: (filePath) => ipcRenderer.invoke('load-ply-preview', filePath),
  loadGlbPreview: (filePath) => ipcRenderer.invoke('load-glb-preview', filePath),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  restartAndInstallUpdate: () => ipcRenderer.invoke('restart-and-install-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onLog: (handler) => {
    const listener = (_event, line) => handler(line);
    ipcRenderer.on('job-log', listener);
    return () => ipcRenderer.removeListener('job-log', listener);
  },
  onJobState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('job-state', listener);
    return () => ipcRenderer.removeListener('job-state', listener);
  },
  onUpdateState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('update-state', listener);
    return () => ipcRenderer.removeListener('update-state', listener);
  },
});
