'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sharpSplat', {
  selectInput: () => ipcRenderer.invoke('select-input'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  inspectInput: (inputPath, opts) => ipcRenderer.invoke('inspect-input', inputPath, opts),
  checkRuntime: () => ipcRenderer.invoke('check-runtime'),
  installRuntime: () => ipcRenderer.invoke('install-runtime'),
  runSharp: (request) => ipcRenderer.invoke('run-sharp', request),
  cancelJob: () => ipcRenderer.invoke('cancel-job'),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  loadPlyPreview: (filePath) => ipcRenderer.invoke('load-ply-preview', filePath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  stageUpdate: (updateInfo) => ipcRenderer.invoke('stage-update', updateInfo),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
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
});
