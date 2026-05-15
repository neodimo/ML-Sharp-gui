/* global sharpSplat */
'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  inputPath: '',
  outputFolder: '',
  outputPly: '',
  outputFile: '',
  busy: false,
  activeMode: 'sharp',
  inputIsPanorama: false,
  progressMode: 'idle',
  downloads: { active: false, startedAt: 0, totalBytes: 0, doneBytes: 0, files: new Map(), doneFiles: 0 },
  longPhase: { active: false, label: '', startedAt: 0 },
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
  sharpAdvancedPanel: $('sharpAdvancedPanel'),
  sharpModeButton: $('sharpModeButton'),
  panoramaModeButton: $('panoramaModeButton'),
  pixalModeButton: $('pixalModeButton'),
  sharpModePanel: $('sharpModePanel'),
  panoramaModePanel: $('panoramaModePanel'),
  pixalModePanel: $('pixalModePanel'),
  modeSummary: $('modeSummary'),
  resultPanel: $('resultPanel'),
  viewerTitle: $('viewerTitle'),
  glbCanvas: $('glbCanvas'),
  runButton: $('runButton'),
  cancelButton: $('cancelButton'),
  status: $('status'),
  resultActions: $('resultActions'),
  viewPly: $('viewPly'),
  showPly: $('showPly'),
  openFolder: $('openFolder'),
  progressBar: $('progressBar'),
  progressDetails: $('progressDetails'),
  inputPreview: $('inputPreview'),
  inputPlaceholder: $('inputPlaceholder'),
  inputInfo: $('inputInfo'),
  log: $('log'),
  liveLog: $('liveLog'),
  copyLogButton: $('copyLogButton'),
  runtimeInfo: $('runtimeInfo'),
  pixalAccept: $('pixalAccept'),
  pixalRunButton: $('pixalRunButton'),
  pixalStatus: $('pixalStatus'),
  panoramaSideCount: $('panoramaSideCount'),
  panoramaAlignmentMode: $('panoramaAlignmentMode'),
  panoramaKeepIntermediates: $('panoramaKeepIntermediates'),
  panoramaRunButton: $('panoramaRunButton'),
  panoramaStatus: $('panoramaStatus'),
  updateButton: $('updateButton'),
  restartUpdateButton: $('restartUpdateButton'),
  updateStatus: $('updateStatus'),
  plyCanvas: $('plyCanvas'),
  viewerPlaceholder: $('viewerPlaceholder'),
  viewerHelp: $('viewerHelp'),
  viewerInfo: $('viewerInfo'),
};

let babylonEngine = null;
let babylonScene = null;

function setStatus(message, kind = '') {
  el.status.className = `status ${kind}`.trim();
  el.status.textContent = message;
}

let pendingLogText = '';
let logFlushScheduled = false;
const liveLogLines = [];

function setLiveLogLine(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const clipped = clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
  liveLogLines.push(clipped);
  while (liveLogLines.length > 8) liveLogLines.shift();
  if (el.liveLog) el.liveLog.textContent = liveLogLines.join('\n');
}

function flushLog() {
  logFlushScheduled = false;
  if (!pendingLogText) return;
  el.log.insertAdjacentText('beforeend', pendingLogText);
  pendingLogText = '';
  el.log.scrollTop = el.log.scrollHeight;
}

function appendLog(line) {
  const text = String(line || '');
  if (!text) return;
  setLiveLogLine(text);
  pendingLogText += `${text}\n`;
  if (!logFlushScheduled) {
    logFlushScheduled = true;
    setTimeout(flushLog, 16);
  }
}

function appendError(label, err) {
  const message = err && err.message ? err.message : String(err || 'Unknown error');
  appendLog('');
  appendLog(`[ERROR] ${label}`);
  appendLog(message);
  appendLog('');
  return message;
}

async function copyLog() {
  flushLog();
  const text = el.log.textContent || '';
  if (!text.trim()) {
    setStatus('Runtime log is empty.', 'busy');
    return;
  }
  try {
    await sharpSplat.copyText(text);
    setStatus('Runtime log copied to clipboard.', 'good');
  } catch (err) {
    setStatus(`Copy failed: ${err.message || err}`, 'bad');
  }
}


function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseSizeToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(unit || '').toLowerCase();
  if (u.startsWith('g')) return n * 1024 * 1024 * 1024;
  if (u.startsWith('m')) return n * 1024 * 1024;
  if (u.startsWith('k')) return n * 1024;
  return n;
}

function resetDownloadProgress() {
  state.downloads = { active: false, startedAt: 0, totalBytes: 0, doneBytes: 0, files: new Map(), doneFiles: 0 };
}

function setProgressDetails(message) {
  if (el.progressDetails) el.progressDetails.textContent = message;
}

function updateDownloadDetails() {
  const d = state.downloads;
  if (!d.active || d.totalBytes <= 0) return;
  const elapsedMs = Math.max(1, Date.now() - d.startedAt);
  const speed = d.doneBytes / (elapsedMs / 1000);
  const percent = Math.max(0, Math.min(99, (d.doneBytes / d.totalBytes) * 100));
  setProgress('fixed', percent);
  setProgressDetails(`Downloading packages: ${humanBytes(d.doneBytes)} / ${humanBytes(d.totalBytes)} (${percent.toFixed(0)}%) • avg ${humanBytes(speed)}/s • ${d.doneFiles}/${d.files.size} files`);
}

function startLongPhase(label) {
  state.longPhase = { active: true, label, startedAt: Date.now() };
  setProgress('busy');
  setProgressDetails(`${label} • elapsed 0:00`);
}

function updateLongPhaseDetails() {
  if (!state.longPhase.active) return;
  setProgressDetails(`${state.longPhase.label} • elapsed ${formatDuration(Date.now() - state.longPhase.startedAt)}`);
}

setInterval(() => {
  if (!state.busy) return;
  updateDownloadDetails();
  updateLongPhaseDetails();
}, 1000);

function setProgress(mode, percent = 0) {
  state.progressMode = mode;
  el.progressBar.classList.toggle('indeterminate', mode === 'busy');
  if (mode === 'idle') {
    el.progressBar.style.width = '0%';
    setProgressDetails('Idle.');
  } else if (mode === 'done') {
    el.progressBar.style.width = '100%';
  } else if (mode === 'busy') {
    el.progressBar.style.width = '42%';
  } else {
    el.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
}

function updateProgressFromLog(line) {
  const raw = String(line || '');
  const text = raw.toLowerCase();
  if (!state.busy) return;

  const downloading = raw.match(/^\s*Downloading\s+(.+?)\s+\((\d+(?:\.\d+)?)\s*([kmgt]?i?b)\)/i);
  if (downloading) {
    const name = downloading[1].trim();
    const bytes = parseSizeToBytes(downloading[2], downloading[3]);
    if (!state.downloads.active) {
      resetDownloadProgress();
      state.downloads.active = true;
      state.downloads.startedAt = Date.now();
      state.longPhase.active = false;
    }
    if (!state.downloads.files.has(name)) {
      state.downloads.files.set(name, { bytes, done: false });
      state.downloads.totalBytes += bytes;
    }
    updateDownloadDetails();
    return;
  }

  const downloaded = raw.match(/^\s*Downloaded\s+(.+)$/i);
  if (downloaded && state.downloads.active) {
    const name = downloaded[1].trim();
    const file = state.downloads.files.get(name);
    if (file && !file.done) {
      file.done = true;
      state.downloads.doneBytes += file.bytes;
      state.downloads.doneFiles += 1;
    }
    updateDownloadDetails();
    return;
  }

  if (text.includes('prepared ') || text.includes('installed ') || text.includes('checked ')) {
    if (state.downloads.active) {
      state.downloads.doneBytes = Math.max(state.downloads.doneBytes, state.downloads.totalBytes);
      updateDownloadDetails();
      resetDownloadProgress();
    }
  }

  if (text.includes('[pipeline] loading') || text.includes('hugging face') || text.includes('huggingface') || text.includes('from_pretrained')) {
    if (!state.longPhase.active) startLongPhase('Downloading/loading Hugging Face model weights');
    return;
  }

  if (text.includes('first pixal3d run can sit quietly')) {
    startLongPhase('Waiting on Hugging Face model downloads / model load');
    return;
  }

  if (text.includes('installing/checking')) {
    setProgress('busy');
    setProgressDetails('Installing/checking runtime…');
  } else if (text.includes('converting exr')) {
    setProgress('fixed', 20);
    setProgressDetails('Converting EXR…');
  } else if (text.includes('predict') || text.includes('running sharp')) {
    setProgress('busy');
    setProgressDetails('Running SHARP…');
  } else if (text.includes('360 panorama pipeline') || text.includes('running 360')) {
    setProgress('busy');
    setProgressDetails('Running 360 panorama SHARP…');
  } else if (text.includes('running pixal3d')) {
    setProgress('busy');
    setProgressDetails('Running Pixal3D…');
  } else if (text.includes('ply written') || text.includes('360 ply written') || text.includes('glb written') || text.includes('complete')) {
    state.longPhase.active = false;
    resetDownloadProgress();
    setProgress('done');
    setProgressDetails('Done.');
  }
}

function setBusy(busy) {
  state.busy = busy;
  if (busy) setProgress('busy');
  else if (state.progressMode === 'busy') setProgress('idle');
  el.chooseInput.disabled = busy;
  el.chooseOutputFolder.disabled = busy;
  el.runButton.disabled = busy;
  el.panoramaRunButton.disabled = busy;
  el.pixalRunButton.disabled = busy;
  el.cancelButton.disabled = !busy;
}

function setMode(mode) {
  if (mode === 'panorama' && !state.inputIsPanorama) mode = 'sharp';
  state.activeMode = mode;
  const isSharp = mode === 'sharp';
  const isPanorama = mode === 'panorama';
  const isPixal = mode === 'pixal';
  el.sharpModeButton.classList.toggle('active', isSharp);
  el.panoramaModeButton.classList.toggle('active', isPanorama);
  el.pixalModeButton.classList.toggle('active', isPixal);
  el.sharpModePanel.classList.toggle('hidden', !isSharp);
  el.panoramaModePanel.classList.toggle('hidden', !isPanorama);
  el.pixalModePanel.classList.toggle('hidden', !isPixal);
  el.sharpAdvancedPanel.classList.toggle('hidden', isPixal);
  el.modeSummary.textContent = isSharp ? 'SHARP .PLY selected' : (isPanorama ? '360 panorama .PLY selected' : 'Pixal3D .GLB selected');
  setStatus(isSharp ? 'SHARP will output a Gaussian splat .PLY.' : (isPanorama ? '360 mode will output a merged Gaussian splat .PLY.' : 'Pixal3D will output an experimental textured .GLB.'), 'busy');
}

function showOutputPanel(kind) {
  el.resultPanel.classList.remove('hidden');
  const isGlb = kind === 'glb';
  el.plyCanvas.classList.toggle('hidden', isGlb);
  el.glbCanvas.classList.toggle('hidden', !isGlb);
  el.viewerHelp.classList.toggle('hidden', false);
  el.viewerPlaceholder.classList.add('hidden');
  el.viewerTitle.textContent = isGlb ? 'Pixal3D GLB preview' : 'SHARP PLY preview';
  el.viewPly.classList.toggle('hidden', isGlb);
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
    acceptLicense: !!el.pixalAccept.checked,
    panoramaSideCount: el.panoramaSideCount.value,
    panoramaAlignmentMode: el.panoramaAlignmentMode.value,
    panoramaKeepIntermediates: !!el.panoramaKeepIntermediates.checked,
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
    state.inputIsPanorama = !!info.isPanorama;
    el.panoramaModeButton.classList.toggle('hidden', !state.inputIsPanorama);
    el.inputInfo.textContent = `${info.width}×${info.height} • ${info.source.toUpperCase()} • ${state.inputIsPanorama ? '360 pano' : el.sourceColorSpace.value}`;
    if (state.inputIsPanorama) {
      setStatus('2:1 panorama detected. 360 SHARP mode is available.', 'good');
      if (state.activeMode === 'sharp') setMode('panorama');
    } else {
      if (state.activeMode === 'panorama') setMode('sharp');
      setStatus('Input loaded. Choose output folder, then run SHARP.', 'good');
    }
    setProgress('idle');
  } catch (err) {
    el.inputPreview.removeAttribute('src');
    el.inputPreview.classList.add('hidden');
    el.inputPlaceholder.classList.remove('hidden');
    el.inputInfo.textContent = '';
    state.inputIsPanorama = false;
    el.panoramaModeButton.classList.add('hidden');
    if (state.activeMode === 'panorama') setMode('sharp');
    appendError('Preview failed', err);
    setStatus('Preview failed — see Runtime log.', 'bad');
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
    appendError('Runtime check failed', err);
    setStatus('Runtime check failed — see Runtime log.', 'bad');
    return null;
  }
}

async function checkForUpdates() {
  el.updateButton.disabled = true;
  el.updateStatus.textContent = 'Checking for updates…';
  try {
    const result = await sharpSplat.checkForUpdates();
    if (result && result.ok === false) el.updateStatus.textContent = result.message || 'Updater is unavailable in this build.';
  } catch (err) {
    appendError('Update check failed', err);
    el.updateStatus.textContent = 'Update check failed — see Runtime log.';
    el.updateButton.disabled = false;
  }
}

async function restartAndInstallUpdate() {
  el.restartUpdateButton.disabled = true;
  el.updateStatus.textContent = 'Restarting to apply update…';
  try {
    await sharpSplat.restartAndInstallUpdate();
  } catch (err) {
    appendError('Restart failed', err);
    el.updateStatus.textContent = 'Restart failed — see Runtime log.';
    el.restartUpdateButton.disabled = false;
  }
}

async function installRuntime() {
  resetDownloadProgress();
  setBusy(true);
  setStatus('Installing/checking runtime… first run can be large.', 'busy');
  try {
    await sharpSplat.installRuntime();
    setProgress('idle');
    checkRuntime(false);
    drawPlyViewer();
    setStatus('Runtime ready.', 'good');
  } catch (err) {
    appendError('Runtime install failed', err);
    setStatus('Runtime install failed — see Runtime log.', 'bad');
  } finally {
    setBusy(false);
  }
}

async function runSharp() {
  resetDownloadProgress();
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
    state.outputFile = result.outputPly;
    el.resultActions.classList.remove('hidden');
    showOutputPanel('ply');
    const size = result.sizeBytes ? ` • ${humanBytes(result.sizeBytes)}` : '';
    const converted = result.converted ? ' Converted EXR to inference PNG first.' : '';
    setStatus(`Done: ${result.outputPly}${size}.${converted}`, 'good');
    setProgress('done');
    await loadPlyViewer(result.outputPly);
  } catch (err) {
    appendError('SHARP failed', err);
    setStatus('SHARP failed — see Runtime log.', 'bad');
  } finally {
    setBusy(false);
  }
}

async function checkPanorama360(showGood = true) {
  try {
    const status = await sharpSplat.checkPanorama360();
    el.panoramaStatus.textContent = status.ready ? `Ready: ${status.repo}` : `Needs install: ${status.root}`;
    appendLog(`360 backend root: ${status.root}`);
    appendLog(`360 backend repo: ${status.repoExists ? status.repo : 'not cloned yet'}`);
    if (showGood) setStatus(status.ready ? '360 panorama backend ready.' : '360 panorama backend not installed yet.', status.ready ? 'good' : 'busy');
    return status;
  } catch (err) {
    appendError('360 backend check failed', err);
    el.panoramaStatus.textContent = '360 backend check failed — see Runtime log.';
    return null;
  }
}

async function installPanorama360() {
  resetDownloadProgress();
  setBusy(true);
  setStatus('Installing/checking 360 panorama backend… first run can be large.', 'busy');
  try {
    await sharpSplat.installPanorama360();
    setStatus('360 panorama backend ready.', 'good');
    await checkPanorama360(false);
  } catch (err) {
    appendError('360 backend install failed', err);
    setStatus('360 backend install failed — see Runtime log.', 'bad');
    el.panoramaStatus.textContent = 'Install failed — see Runtime log.';
  } finally {
    setBusy(false);
  }
}

async function runPanorama360() {
  resetDownloadProgress();
  if (!state.inputPath) { setStatus('Choose a 2:1 panorama first.', 'bad'); return; }
  if (!state.inputIsPanorama) { setStatus('360 mode needs a stitched 2:1 panorama input.', 'bad'); return; }
  if (!state.outputFolder) { await chooseOutputFolder(); if (!state.outputFolder) return; }
  el.resultActions.classList.add('hidden');
  state.outputPly = '';
  state.outputFile = '';
  setProgress('busy');
  setBusy(true);
  setStatus('Running 360 panorama SHARP…', 'busy');
  try {
    const result = await sharpSplat.runPanorama360(readOptions());
    state.outputPly = result.outputPly;
    state.outputFile = result.outputPly;
    el.resultActions.classList.remove('hidden');
    showOutputPanel('ply');
    const size = result.sizeBytes ? ` • ${humanBytes(result.sizeBytes)}` : '';
    setStatus(`360 panorama PLY done: ${result.outputPly}${size}.`, 'good');
    setProgress('done');
    await loadPlyViewer(result.outputPly);
  } catch (err) {
    appendError('360 panorama SHARP failed', err);
    setStatus('360 panorama SHARP failed — see Runtime log.', 'bad');
  } finally {
    setBusy(false);
  }
}

async function checkPixal3D(showGood = true) {
  try {
    const status = await sharpSplat.checkPixal3D();
    el.pixalStatus.textContent = status.ready ? `Ready: ${status.repo}` : `Needs install: ${status.root}`;
    appendLog(`Pixal3D root: ${status.root}`);
    appendLog(`Pixal3D repo: ${status.repoExists ? status.repo : 'not cloned yet'}`);
    appendLog(`Pixal3D Python: ${status.pythonExists ? status.python : 'not installed yet'}`);
    if (showGood) setStatus(status.ready ? 'Pixal3D experimental backend ready.' : 'Pixal3D not installed yet.', status.ready ? 'good' : 'busy');
    return status;
  } catch (err) {
    appendError('Pixal3D check failed', err);
    el.pixalStatus.textContent = 'Pixal3D check failed — see Runtime log.';
    return null;
  }
}

function requirePixalLicense() {
  if (el.pixalAccept.checked) return true;
  const msg = 'Check the Pixal3D license box first: academic/research only, no commercial/production use, not intended for EU use.';
  el.pixalStatus.textContent = msg;
  setStatus(msg, 'bad');
  return false;
}

async function installPixal3D() {
  if (!requirePixalLicense()) return;
  resetDownloadProgress();
  setBusy(true);
  setStatus('Installing Pixal3D experimental backend… this can be large and CUDA-specific.', 'busy');
  try {
    await sharpSplat.installPixal3D(readOptions());
    setStatus('Pixal3D experimental backend ready.', 'good');
    await checkPixal3D(false);
  } catch (err) {
    appendError('Pixal3D install failed', err);
    setStatus('Pixal3D install failed — see Runtime log.', 'bad');
    el.pixalStatus.textContent = 'Install failed — see Runtime log. Use Copy log to paste the full report.';
  } finally {
    setBusy(false);
  }
}

async function runPixal3D() {
  resetDownloadProgress();
  if (!requirePixalLicense()) return;
  if (!state.inputPath) { setStatus('Choose an input frame first.', 'bad'); return; }
  if (!state.outputFolder) { await chooseOutputFolder(); if (!state.outputFolder) return; }
  el.resultActions.classList.add('hidden');
  state.outputPly = '';
  state.outputFile = '';
  setProgress('busy');
  setBusy(true);
  setStatus('Running Pixal3D experimental GLB…', 'busy');
  try {
    const result = await sharpSplat.runPixal3D(readOptions());
    state.outputFile = result.outputGlb;
    el.resultActions.classList.remove('hidden');
    showOutputPanel('glb');
    const size = result.sizeBytes ? ` • ${humanBytes(result.sizeBytes)}` : '';
    setStatus(`Pixal3D GLB done: ${result.outputGlb}${size}.`, 'good');
    setProgress('done');
    await loadGlbViewer(result.outputGlb);
  } catch (err) {
    appendError('Pixal3D failed', err);
    setStatus('Pixal3D failed — see Runtime log.', 'bad');
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

let previewTimer = null;
function schedulePreviewRefresh() {
  if (!state.inputPath) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshInputPreview, 250);
}

sharpSplat.onLog((chunk) => {
  for (const line of String(chunk || '').split(/\r?\n/)) {
    if (!line) continue;
    appendLog(line);
    updateProgressFromLog(line);
  }
});
sharpSplat.onJobState((jobState) => {
  if (jobState && typeof jobState.busy === 'boolean') setBusy(jobState.busy);
  if (jobState && jobState.label) appendLog(`[${jobState.label}]`);
});
sharpSplat.onUpdateState((update) => {
  if (!update) return;
  el.updateStatus.textContent = update.message || update.status || '';
  appendLog(`[update] ${update.message || update.status}`);
  el.updateButton.disabled = update.status === 'checking' || update.status === 'downloading';
  if (update.status === 'available') {
    el.updateStatus.textContent = `${update.message} Downloading now…`;
    sharpSplat.downloadUpdate().catch((err) => {
      appendError('Update download failed', err);
      el.updateStatus.textContent = 'Update download failed — see Runtime log.';
      el.updateButton.disabled = false;
    });
  }
  if (update.status === 'downloaded') {
    el.restartUpdateButton.classList.remove('hidden');
    el.updateButton.disabled = false;
  }
  if (update.status === 'none' || update.status === 'error') el.updateButton.disabled = false;
});

el.chooseInput.addEventListener('click', chooseInput);
el.chooseOutputFolder.addEventListener('click', chooseOutputFolder);
el.sharpModeButton.addEventListener('click', () => setMode('sharp'));
el.panoramaModeButton.addEventListener('click', () => setMode('panorama'));
el.pixalModeButton.addEventListener('click', () => setMode('pixal'));
el.runButton.addEventListener('click', runSharp);
el.panoramaRunButton.addEventListener('click', runPanorama360);
el.cancelButton.addEventListener('click', cancelJob);
el.copyLogButton.addEventListener('click', copyLog);
el.pixalRunButton.addEventListener('click', runPixal3D);
el.updateButton.addEventListener('click', checkForUpdates);
el.restartUpdateButton.addEventListener('click', restartAndInstallUpdate);
el.sourceColorSpace.addEventListener('change', refreshInputPreview);
el.toneMap.addEventListener('change', refreshInputPreview);
el.exposureStops.addEventListener('input', () => {
  el.exposureValue.textContent = Number(el.exposureStops.value).toFixed(1);
  schedulePreviewRefresh();
});
el.showPly.addEventListener('click', () => {
  if (state.outputFile || state.outputPly) sharpSplat.showInFolder(state.outputFile || state.outputPly);
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

async function loadGlbViewer(filePath) {
  if (!filePath || !el.glbCanvas || !window.BABYLON) return;
  showOutputPanel('glb');
  el.viewerInfo.textContent = 'Loading GLB preview…';
  try {
    if (babylonEngine) {
      babylonEngine.dispose();
      babylonEngine = null;
      babylonScene = null;
    }
    const dataUrl = await sharpSplat.loadGlbPreview(filePath);
    babylonEngine = new BABYLON.Engine(el.glbCanvas, true, { preserveDrawingBuffer: true, stencil: true });
    babylonScene = new BABYLON.Scene(babylonEngine);
    babylonScene.clearColor = new BABYLON.Color4(0.06, 0.065, 0.075, 1);
    const camera = new BABYLON.ArcRotateCamera('camera', Math.PI / 2.4, Math.PI / 2.7, 2.4, BABYLON.Vector3.Zero(), babylonScene);
    camera.attachControl(el.glbCanvas, true);
    camera.wheelPrecision = 45;
    new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.3, 1, 0.4), babylonScene).intensity = 1.1;
    const dir = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.6, -1, -0.8), babylonScene);
    dir.intensity = 1.4;
    await BABYLON.SceneLoader.AppendAsync('', dataUrl, babylonScene);
    const meshes = babylonScene.meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
    if (meshes.length) {
      const min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      const max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
      for (const mesh of meshes) {
        const info = mesh.getBoundingInfo();
        BABYLON.Vector3.MinimizeToRef(min, info.boundingBox.minimumWorld, min);
        BABYLON.Vector3.MaximizeToRef(max, info.boundingBox.maximumWorld, max);
      }
      const center = min.add(max).scale(0.5);
      const radius = Math.max(0.8, max.subtract(min).length() * 0.75);
      camera.setTarget(center);
      camera.radius = radius * 1.7;
    }
    babylonEngine.runRenderLoop(() => babylonScene && babylonScene.render());
    el.viewerInfo.textContent = 'GLB preview loaded · drag rotate · wheel zoom';
    window.addEventListener('resize', () => babylonEngine && babylonEngine.resize());
  } catch (err) {
    el.viewerInfo.textContent = `GLB preview failed: ${err.message || err}`;
    appendError('GLB preview failed', err);
  }
}

async function loadPlyViewer(filePath = state.outputPly) {
  if (!filePath) return;
  showOutputPanel('ply');
  if (babylonEngine) {
    babylonEngine.dispose();
    babylonEngine = null;
    babylonScene = null;
  }
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
setMode('sharp');
setProgress('idle');
checkRuntime(false);
drawPlyViewer();
