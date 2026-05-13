/* global sharpSplat */
'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  inputPath: '',
  outputFolder: '',
  outputPly: '',
  busy: false,
  progressMode: 'idle',
  viewer: {
    positions: [],
    colors: [],
    bounds: null,
    rotX: -0.28,
    rotY: 0.45,
    zoom: 1,
    dragging: false,
    lastX: 0,
    lastY: 0,
  },
};

const el = {
  inputPath: $('inputPath'),
  outputFolder: $('outputFolder'),
  chooseInput: $('chooseInput'),
  chooseOutputFolder: $('chooseOutputFolder'),
  sourceColorSpace: $('sourceColorSpace'),
  toneMap: $('toneMap'),
  exposureStops: $('exposureStops'),
  exposureValue: $('exposureValue'),
  device: $('device'),
  installButton: $('installButton'),
  runButton: $('runButton'),
  cancelButton: $('cancelButton'),
  status: $('status'),
  resultActions: $('resultActions'),
  viewPly: $('viewPly'),
  showPly: $('showPly'),
  openFolder: $('openFolder'),
  progressBar: $('progressBar'),
  inputPreview: $('inputPreview'),
  inputPlaceholder: $('inputPlaceholder'),
  inputInfo: $('inputInfo'),
  log: $('log'),
  runtimeInfo: $('runtimeInfo'),
  docsButton: $('docsButton'),
  runtimeButton: $('runtimeButton'),
  updateButton: $('updateButton'),
  updatePanel: $('updatePanel'),
  updateInfo: $('updateInfo'),
  downloadUpdate: $('downloadUpdate'),
  releaseNotes: $('releaseNotes'),
  plyCanvas: $('plyCanvas'),
  viewerPlaceholder: $('viewerPlaceholder'),
  viewerInfo: $('viewerInfo'),
};

function setStatus(message, kind = '') {
  el.status.className = `status ${kind}`.trim();
  el.status.textContent = message;
}

function appendLog(line) {
  if (!line) return;
  const atBottom = el.log.scrollTop + el.log.clientHeight >= el.log.scrollHeight - 20;
  el.log.textContent += `${line}\n`;
  if (atBottom) el.log.scrollTop = el.log.scrollHeight;
}

function setProgress(mode, percent = 0) {
  state.progressMode = mode;
  el.progressBar.classList.toggle('indeterminate', mode === 'busy');
  if (mode === 'idle') {
    el.progressBar.style.width = '0%';
  } else if (mode === 'done') {
    el.progressBar.style.width = '100%';
  } else if (mode === 'busy') {
    el.progressBar.style.width = '42%';
  } else {
    el.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
}

function updateProgressFromLog(line) {
  const text = String(line || '').toLowerCase();
  if (!state.busy) return;
  if (text.includes('installing/checking')) setProgress('busy');
  else if (text.includes('converting exr')) setProgress('fixed', 20);
  else if (text.includes('predict') || text.includes('running sharp')) setProgress('busy');
  else if (text.includes('ply written')) setProgress('done');
}

function setBusy(busy) {
  state.busy = busy;
  if (busy) setProgress('busy');
  else if (state.progressMode === 'busy') setProgress('idle');
  el.chooseInput.disabled = busy;
  el.chooseOutputFolder.disabled = busy;
  el.installButton.disabled = busy;
  el.runButton.disabled = busy;
  el.updateButton.disabled = busy;
  el.downloadUpdate.disabled = busy;
  el.cancelButton.disabled = !busy;
}

function readOptions() {
  return {
    inputPath: state.inputPath,
    outputFolder: state.outputFolder,
    sourceColorSpace: el.sourceColorSpace.value,
    toneMap: el.toneMap.value,
    exposureStops: Number(el.exposureStops.value),
    device: el.device.value,
    verbose: true,
  };
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function refreshInputPreview() {
  if (!state.inputPath) return;
  setBusy(true);
  setStatus('Decoding input preview…', 'busy');
  try {
    const info = await sharpSplat.inspectInput(state.inputPath, readOptions());
    el.inputPreview.src = info.previewDataUrl;
    el.inputPreview.classList.remove('hidden');
    el.inputPlaceholder.classList.add('hidden');
    el.inputInfo.textContent = `${info.width}×${info.height} • ${info.source.toUpperCase()} • ${el.sourceColorSpace.value}`;
    setStatus('Input loaded. Choose output folder, then run SHARP.', 'good');
    setProgress('idle');
  } catch (err) {
    el.inputPreview.removeAttribute('src');
    el.inputPreview.classList.add('hidden');
    el.inputPlaceholder.classList.remove('hidden');
    el.inputInfo.textContent = '';
    setStatus(`Preview failed: ${err.message || err}`, 'bad');
  } finally {
    setBusy(false);
  }
}

async function chooseInput() {
  const selected = await sharpSplat.selectInput();
  if (!selected) return;
  state.inputPath = selected.inputPath;
  el.inputPath.value = state.inputPath;
  el.sourceColorSpace.value = selected.defaultColorSpace;
  await refreshInputPreview();
}

async function chooseOutputFolder() {
  const selected = await sharpSplat.selectOutputFolder();
  if (!selected) return;
  state.outputFolder = selected;
  el.outputFolder.value = selected;
}

async function checkRuntime(showGood = true) {
  try {
    const status = await sharpSplat.checkRuntime();
    el.runtimeInfo.textContent = status.ready ? 'Ready' : 'Needs install';
    appendLog(`Runtime folder: ${status.runtimeRoot}`);
    appendLog(`Bundled ml-sharp: ${status.mlSharpSource}`);
    appendLog(`uv: ${status.uv}${status.uvExists ? '' : ' (not bundled on this platform)'}`);
    appendLog(`Python: ${status.pythonExists ? status.python : 'not installed yet'}`);
    appendLog(`sharp CLI: ${status.sharpExists ? status.sharp : 'not installed yet'}`);
    if (showGood) setStatus(status.ready ? 'Runtime ready.' : 'Runtime not installed yet. Click install/check runtime or just Run SHARP.', status.ready ? 'good' : 'busy');
    return status;
  } catch (err) {
    setStatus(`Runtime check failed: ${err.message || err}`, 'bad');
    return null;
  }
}

async function installRuntime() {
  setBusy(true);
  setStatus('Installing/checking runtime… first run can be large.', 'busy');
  try {
    await sharpSplat.installRuntime();
    await setProgress('idle');
checkRuntime(false);
drawPlyViewer();
    setStatus('Runtime ready.', 'good');
  } catch (err) {
    setStatus(`Runtime install failed: ${err.message || err}`, 'bad');
  } finally {
    setBusy(false);
  }
}

async function runSharp() {
  if (!state.inputPath) {
    setStatus('Choose an input frame first.', 'bad');
    return;
  }
  if (!state.outputFolder) {
    await chooseOutputFolder();
    if (!state.outputFolder) return;
  }
  el.resultActions.classList.add('hidden');
  state.outputPly = '';
  setProgress('busy');
  setBusy(true);
  setStatus('Running SHARP…', 'busy');
  try {
    const result = await sharpSplat.runSharp(readOptions());
    state.outputPly = result.outputPly;
    el.resultActions.classList.remove('hidden');
    const size = result.sizeBytes ? ` • ${humanBytes(result.sizeBytes)}` : '';
    const converted = result.converted ? ' Converted EXR to inference PNG first.' : '';
    setStatus(`Done: ${result.outputPly}${size}.${converted}`, 'good');
    setProgress('done');
    await loadPlyViewer(result.outputPly);
  } catch (err) {
    setStatus(`SHARP failed: ${err.message || err}`, 'bad');
  } finally {
    setBusy(false);
  }
}

async function cancelJob() {
  await sharpSplat.cancelJob();
  setBusy(false);
  setStatus('Cancelled.', 'busy');
  setProgress('idle');
}

let lastUpdateInfo = null;

async function checkForUpdates() {
  setStatus('Checking GitHub Releases for updates…', 'busy');
  try {
    const info = await sharpSplat.checkForUpdates();
    lastUpdateInfo = info;
    if (info.updateAvailable) {
      el.updateInfo.textContent = `Update available: ${info.currentVersion} → ${info.latestVersion} (${info.assetName})`;
      el.updatePanel.classList.remove('hidden');
      setStatus('Update available. Click Update to download it; restart the app after it is ready.', 'good');
    } else {
      el.updatePanel.classList.add('hidden');
      setStatus(`Already up to date (${info.currentVersion}).`, 'good');
    }
  } catch (err) {
    setStatus(`Update check failed: ${err.message || err}`, 'bad');
  }
}

async function downloadUpdate() {
  setBusy(true);
  setStatus('Downloading update…', 'busy');
  setProgress('busy');
  try {
    const result = await sharpSplat.stageUpdate(lastUpdateInfo);
    lastUpdateInfo = result;
    if (result.staged) {
      el.updateInfo.textContent = `Update ready: ${result.latestVersion}. Restart the app to finish.`;
      setStatus('Update downloaded. Restart the app to finish installing.', 'good');
      setProgress('done');
    } else {
      setStatus(result.message || 'Already up to date.', 'good');
      setProgress('idle');
    }
  } catch (err) {
    setStatus(`Update failed: ${err.message || err}`, 'bad');
  } finally {
    setBusy(false);
  }
}

let previewTimer = null;
function schedulePreviewRefresh() {
  if (!state.inputPath) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshInputPreview, 250);
}

sharpSplat.onLog((line) => { appendLog(line); updateProgressFromLog(line); });
sharpSplat.onJobState((jobState) => {
  if (jobState && typeof jobState.busy === 'boolean') setBusy(jobState.busy);
  if (jobState && jobState.label) appendLog(`[${jobState.label}]`);
});

el.chooseInput.addEventListener('click', chooseInput);
el.chooseOutputFolder.addEventListener('click', chooseOutputFolder);
el.installButton.addEventListener('click', installRuntime);
el.runButton.addEventListener('click', runSharp);
el.cancelButton.addEventListener('click', cancelJob);
el.runtimeButton.addEventListener('click', () => checkRuntime(true));
el.updateButton.addEventListener('click', checkForUpdates);
el.downloadUpdate.addEventListener('click', downloadUpdate);
el.releaseNotes.addEventListener('click', () => {
  if (lastUpdateInfo && lastUpdateInfo.releaseUrl) sharpSplat.openExternal(lastUpdateInfo.releaseUrl);
});
el.docsButton.addEventListener('click', () => sharpSplat.openExternal('https://github.com/apple/ml-sharp'));
el.sourceColorSpace.addEventListener('change', refreshInputPreview);
el.toneMap.addEventListener('change', refreshInputPreview);
el.exposureStops.addEventListener('input', () => {
  el.exposureValue.textContent = Number(el.exposureStops.value).toFixed(1);
  schedulePreviewRefresh();
});
el.showPly.addEventListener('click', () => {
  if (state.outputPly) sharpSplat.showInFolder(state.outputPly);
});
el.openFolder.addEventListener('click', () => {
  if (state.outputFolder) sharpSplat.openPath(state.outputFolder);
});
el.viewPly.addEventListener('click', () => loadPlyViewer());


function resizeCanvasToDisplaySize() {
  const rect = el.plyCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (el.plyCanvas.width !== width || el.plyCanvas.height !== height) {
    el.plyCanvas.width = width;
    el.plyCanvas.height = height;
  }
  return dpr;
}

function resetViewerCamera() {
  state.viewer.rotX = -0.28;
  state.viewer.rotY = 0.45;
  state.viewer.zoom = 1;
  drawPlyViewer();
}

function drawPlyViewer() {
  const canvas = el.plyCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = resizeCanvasToDisplaySize();
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080b12';
  ctx.fillRect(0, 0, width, height);

  const { positions, colors, bounds, rotX, rotY, zoom } = state.viewer;
  if (!positions.length || !bounds) return;

  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const cz = (bounds.minZ + bounds.maxZ) * 0.5;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 1e-6);
  const scale = Math.min(width, height) * 0.72 * zoom / extent;
  const sinX = Math.sin(rotX), cosX = Math.cos(rotX);
  const sinY = Math.sin(rotY), cosY = Math.cos(rotY);
  const pts = [];

  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i] - cx;
    let y = positions[i + 1] - cy;
    let z = positions[i + 2] - cz;
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const y2 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;
    pts.push({
      x: width * 0.5 + x1 * scale,
      y: height * 0.5 - y2 * scale,
      z: z2,
      r: colors[i],
      g: colors[i + 1],
      b: colors[i + 2],
    });
  }

  pts.sort((a, b) => a.z - b.z);
  const radius = Math.max(0.75 * dpr, Math.min(2.2 * dpr, 70000 / Math.max(positions.length, 1)));
  for (const pt of pts) {
    ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
    ctx.fillRect(pt.x, pt.y, radius, radius);
  }
}

async function loadPlyViewer(filePath = state.outputPly) {
  if (!filePath) return;
  el.viewerInfo.textContent = 'Loading PLY…';
  try {
    const ply = await sharpSplat.loadPlyPreview(filePath);
    state.viewer.positions = ply.positions;
    state.viewer.colors = ply.colors;
    state.viewer.bounds = ply.bounds;
    state.outputPly = filePath;
    el.viewerPlaceholder.classList.add('hidden');
    el.viewerInfo.textContent = `${ply.shownCount.toLocaleString()} / ${ply.vertexCount.toLocaleString()} points shown`;
    resetViewerCamera();
  } catch (err) {
    el.viewerPlaceholder.classList.remove('hidden');
    el.viewerInfo.textContent = `PLY preview failed: ${err.message || err}`;
  }
}

el.plyCanvas.addEventListener('pointerdown', (event) => {
  state.viewer.dragging = true;
  state.viewer.lastX = event.clientX;
  state.viewer.lastY = event.clientY;
  el.plyCanvas.setPointerCapture(event.pointerId);
});
el.plyCanvas.addEventListener('pointermove', (event) => {
  if (!state.viewer.dragging) return;
  const dx = event.clientX - state.viewer.lastX;
  const dy = event.clientY - state.viewer.lastY;
  state.viewer.lastX = event.clientX;
  state.viewer.lastY = event.clientY;
  state.viewer.rotY += dx * 0.008;
  state.viewer.rotX += dy * 0.008;
  drawPlyViewer();
});
el.plyCanvas.addEventListener('pointerup', () => { state.viewer.dragging = false; });
el.plyCanvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.viewer.zoom *= event.deltaY < 0 ? 1.12 : 0.89;
  state.viewer.zoom = Math.max(0.08, Math.min(80, state.viewer.zoom));
  drawPlyViewer();
}, { passive: false });
el.plyCanvas.addEventListener('dblclick', resetViewerCamera);
window.addEventListener('resize', drawPlyViewer);


el.inputPreview.classList.add('hidden');
setProgress('idle');
checkRuntime(false);
drawPlyViewer();
