/* global sharpSplat */
'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  inputPath: '',
  outputFolder: '',
  outputPly: '',
  busy: false,
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
  showPly: $('showPly'),
  openFolder: $('openFolder'),
  inputPreview: $('inputPreview'),
  inputPlaceholder: $('inputPlaceholder'),
  inputInfo: $('inputInfo'),
  log: $('log'),
  runtimeInfo: $('runtimeInfo'),
  docsButton: $('docsButton'),
  runtimeButton: $('runtimeButton'),
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

function setBusy(busy) {
  state.busy = busy;
  el.chooseInput.disabled = busy;
  el.chooseOutputFolder.disabled = busy;
  el.installButton.disabled = busy;
  el.runButton.disabled = busy;
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
    await checkRuntime(false);
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
  setBusy(true);
  setStatus('Running SHARP…', 'busy');
  try {
    const result = await sharpSplat.runSharp(readOptions());
    state.outputPly = result.outputPly;
    el.resultActions.classList.remove('hidden');
    const size = result.sizeBytes ? ` • ${humanBytes(result.sizeBytes)}` : '';
    const converted = result.converted ? ' Converted EXR to inference PNG first.' : '';
    setStatus(`Done: ${result.outputPly}${size}.${converted}`, 'good');
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
}

let previewTimer = null;
function schedulePreviewRefresh() {
  if (!state.inputPath) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshInputPreview, 250);
}

sharpSplat.onLog((line) => appendLog(line));
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

el.inputPreview.classList.add('hidden');
checkRuntime(false);
