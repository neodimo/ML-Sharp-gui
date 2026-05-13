'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { PNG } = require('pngjs');
const { defaultColorSpaceFor, loadImage, makePreviewPngDataUrl } = require('./lib/image-loader.cjs');
const { clamp01 } = require('./lib/color.cjs');

let mainWindow;
let activeProcess = null;
let updateDownloaded = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#101217',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}


function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateState({ status: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (info) => sendUpdateState({ status: 'available', message: `Update ${info.version} available.`, info }));
  autoUpdater.on('update-not-available', (info) => sendUpdateState({ status: 'none', message: `You're up to date (${info.version || app.getVersion()}).`, info }));
  autoUpdater.on('download-progress', (progress) => sendUpdateState({
    status: 'downloading',
    message: `Downloading update… ${Math.round(progress.percent || 0)}%`,
    progress,
  }));
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    sendUpdateState({ status: 'downloaded', message: 'Update ready. Restart the app to finish.', info });
  });
  autoUpdater.on('error', (err) => sendUpdateState({ status: 'error', message: err.message || String(err) }));
}

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function sendLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-log', String(line));
}

function sendJobState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('job-state', state);
}

function sendUpdateState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-state', state);
}

function isPackagedWin() {
  return app.isPackaged && process.platform === 'win32';
}

function appRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'vendor');
}

function runtimeRoot() {
  return path.join(app.getPath('userData'), 'sharp-runtime');
}

function legacyRuntimeRoot() {
  return path.join(appRoot(), 'sharp-runtime');
}

function migrateLegacyRuntimeIfNeeded() {
  const current = runtimeRoot();
  const legacy = legacyRuntimeRoot();
  if (current === legacy || fs.existsSync(current) || !fs.existsSync(legacy)) return;
  fs.mkdirSync(path.dirname(current), { recursive: true });
  try {
    fs.renameSync(legacy, current);
    sendLog(`Migrated sharp-runtime to stable update-safe location: ${current}`);
  } catch (err) {
    sendLog(`Could not move legacy sharp-runtime automatically: ${err.message || err}`);
    sendLog(`If needed, copy ${legacy} to ${current}`);
  }
}

function mlSharpSourcePath() {
  return path.join(resourcesRoot(), 'ml-sharp');
}

function uvPath() {
  if (process.platform === 'win32') {
    const bundled = path.join(resourcesRoot(), 'uv', 'uv.exe');
    if (fs.existsSync(bundled)) return bundled;
    return 'uv.exe';
  }
  const bundled = path.join(resourcesRoot(), 'uv', 'uv');
  if (fs.existsSync(bundled)) return bundled;
  return 'uv';
}

function venvPythonPath() {
  if (process.platform === 'win32') return path.join(runtimeRoot(), 'venv', 'Scripts', 'python.exe');
  return path.join(runtimeRoot(), 'venv', 'bin', 'python');
}

function sharpExePath() {
  if (process.platform === 'win32') return path.join(runtimeRoot(), 'venv', 'Scripts', 'sharp.exe');
  return path.join(runtimeRoot(), 'venv', 'bin', 'sharp');
}

function pixal3dRoot() {
  return path.join(app.getPath('userData'), 'pixal3d-experimental');
}

function pixal3dRepoPath() {
  return path.join(pixal3dRoot(), 'Pixal3D');
}

function pixal3dVenvPath() {
  return path.join(pixal3dRoot(), 'venv');
}

function pixal3dPythonPath() {
  if (process.platform === 'win32') return path.join(pixal3dVenvPath(), 'Scripts', 'python.exe');
  return path.join(pixal3dVenvPath(), 'bin', 'python');
}

function pixal3dInstallMarkerPath() {
  const markerName = process.platform === 'win32' ? 'install-windows-sdpa-v1.json' : 'install-linux-cuda-v1.json';
  return path.join(pixal3dRoot(), markerName);
}

const PIXAL3D_WINDOWS_WHEELS_BASE = 'https://raw.githubusercontent.com/visualbruno/ComfyUI-Trellis2/86d13d9eac4a2bd4395954c7184d3aa4fa81a9d8/wheels/Windows/Torch270';
const PIXAL3D_WINDOWS_WHEELS = [
  ['cumesh-1.0-cp311-cp311-win_amd64.whl', 'f6ec70f31fa24ebef0026ea5d622fce4314e22e2c56979219598fdd6e4df3b28'],
  ['flex_gemm-0.0.1-cp311-cp311-win_amd64.whl', '3a1b8ef109735cc8f19729a007abb48b9a91815f350bc10cc513f5c7e27608f2'],
  ['nvdiffrast-0.4.0-cp311-cp311-win_amd64.whl', '6d273cc912143a306389ec7b5e0fa44efbe45ea7577f86d8f13ce6b209c56c3e'],
  ['nvdiffrec_render-0.0.0-cp311-cp311-win_amd64.whl', 'c0e4bf4ea6622ddff0eea0ca8b9be75a48318db62a7184891bcb0f1da65d1f8c'],
  ['o_voxel-0.0.1-cp311-cp311-win_amd64.whl', 'da17f251f05ea31c1d0ad2fa3e4b7e025463cb9a12a66fb8ddb3b28634ad1636'],
];

function pixal3dWindowsWheelRequirements() {
  return PIXAL3D_WINDOWS_WHEELS.map(([fileName, sha256]) => `${PIXAL3D_WINDOWS_WHEELS_BASE}/${fileName}#sha256=${sha256}`);
}

function pixal3dExecutionEnv(extra = {}) {
  return {
    ...extra,
    // Windows has no official flash-attn/NATTEN path here. Use PyTorch SDPA for
    // the experimental provider and keep SHARP's runtime untouched.
    ATTN_BACKEND: process.platform === 'win32' ? 'sdpa' : (extra.ATTN_BACKEND || process.env.ATTN_BACKEND || 'flash_attn'),
    SPARSE_ATTN_BACKEND: process.platform === 'win32' ? 'sdpa' : (extra.SPARSE_ATTN_BACKEND || process.env.SPARSE_ATTN_BACKEND || 'flash_attn'),
  };
}

function patchPixal3DWindowsSource(repo) {
  if (process.platform !== 'win32') return;

  const sparseConfigPath = path.join(repo, 'pixal3d', 'modules', 'sparse', 'config.py');
  const sparseAttentionPath = path.join(repo, 'pixal3d', 'modules', 'sparse', 'attention', 'full_attn.py');
  if (!fs.existsSync(sparseConfigPath) || !fs.existsSync(sparseAttentionPath)) {
    throw new Error('Pixal3D sparse attention files were not found for Windows SDPA patching.');
  }

  let sparseConfig = fs.readFileSync(sparseConfigPath, 'utf8').replace(/\r\n/g, '\n');
  sparseConfig = sparseConfig
    .replace("ATTN = 'flash_attn'", "ATTN = 'sdpa'")
    .replace("['xformers', 'flash_attn', 'flash_attn_3', 'flash_attn_4']", "['xformers', 'flash_attn', 'flash_attn_3', 'flash_attn_4', 'sdpa']")
    .replace("Literal['xformers', 'flash_attn', 'flash_attn_3', 'flash_attn_4']", "Literal['xformers', 'flash_attn', 'flash_attn_3', 'flash_attn_4', 'sdpa']");
  fs.writeFileSync(sparseConfigPath, sparseConfig);

  let sparseAttention = fs.readFileSync(sparseAttentionPath, 'utf8').replace(/\r\n/g, '\n');
  if (!sparseAttention.includes('Windows-native SDPA fallback')) {
    const marker = "    if config.ATTN == 'xformers':";
    const fallback = `    # Windows-native SDPA fallback: slower than flash-attn/xformers, but avoids\n    # Linux-only CUDA wheels and keeps the experimental provider inside the app.\n    def _sdpa_varlen(q, k, v, q_seqlen, kv_seqlen):\n        outs = []\n        q_off = 0\n        kv_off = 0\n        for n in range(len(q_seqlen)):\n            qn = q_seqlen[n]\n            kn = kv_seqlen[n]\n            q_i = q[q_off:q_off + qn].transpose(0, 1).unsqueeze(0)\n            k_i = k[kv_off:kv_off + kn].transpose(0, 1).unsqueeze(0)\n            v_i = v[kv_off:kv_off + kn].transpose(0, 1).unsqueeze(0)\n            out_i = torch.nn.functional.scaled_dot_product_attention(\n                q_i, k_i, v_i, dropout_p=0.0, is_causal=False\n            )[0]\n            outs.append(out_i.transpose(0, 1))\n            q_off += qn\n            kv_off += kn\n        return torch.cat(outs, dim=0)\n\n    if num_all_args == 1:\n        q, k, v = qkv.unbind(dim=1)\n    elif num_all_args == 2:\n        k, v = kv.unbind(dim=1)\n\n`;
    const markerAt = sparseAttention.indexOf(marker);
    if (markerAt < 0) throw new Error('Pixal3D sparse attention dispatch marker changed upstream.');
    sparseAttention = `${sparseAttention.slice(0, markerAt)}${fallback}${sparseAttention.slice(markerAt)}`;
  }

  const raiseText = "    else:\n        raise ValueError(f\"Unknown attention module: {config.ATTN}\")\n";
  const sdpaText = "    elif config.ATTN == 'sdpa':\n        out = _sdpa_varlen(q, k, v, q_seqlen, kv_seqlen)\n    else:\n        raise ValueError(f\"Unknown attention module: {config.ATTN}\")\n";
  if (sparseAttention.includes("elif config.ATTN == 'sdpa':")) {
    // Already patched.
  } else if (sparseAttention.includes(raiseText)) {
    sparseAttention = sparseAttention.replace(raiseText, sdpaText);
  } else {
    throw new Error('Pixal3D sparse attention fallback marker changed upstream.');
  }
  fs.writeFileSync(sparseAttentionPath, sparseAttention);
  sendLog('Patched Pixal3D sparse attention to allow Windows PyTorch SDPA fallback.');
}

function ensureDirs() {
  migrateLegacyRuntimeIfNeeded();
  fs.mkdirSync(runtimeRoot(), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot(), 'converted-inputs'), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot(), 'logs'), { recursive: true });
}

function quoteForLog(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || appRoot(),
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      shell: false,
    });
    activeProcess = child;
    const commandLine = [command, ...args].map(quoteForLog).join(' ');
    const recentOutput = [];
    const rememberOutput = (chunk) => {
      const text = chunk.toString().trimEnd();
      if (!text) return;
      sendLog(text);
      for (const line of text.split(/\r?\n/)) {
        recentOutput.push(line);
        if (recentOutput.length > 40) recentOutput.shift();
      }
    };
    sendLog(`> ${commandLine}`);
    child.stdout.on('data', rememberOutput);
    child.stderr.on('data', rememberOutput);
    child.on('error', (err) => {
      activeProcess = null;
      err.message = `${err.message}\nCommand: ${commandLine}`;
      reject(err);
    });
    child.on('close', (code) => {
      activeProcess = null;
      if (code === 0) resolve();
      else {
        const tail = recentOutput.length ? `\n\nLast output:\n${recentOutput.join('\n')}` : '';
        reject(new Error(`Command exited with code ${code}\nCommand: ${commandLine}${tail}`));
      }
    });
  });
}

async function checkRuntimeStatus() {
  migrateLegacyRuntimeIfNeeded();
  const root = runtimeRoot();
  const py = venvPythonPath();
  const sharp = sharpExePath();
  const ml = mlSharpSourcePath();
  const uv = uvPath();
  return {
    runtimeRoot: root,
    mlSharpSource: ml,
    uv,
    uvExists: uv === 'uv' || uv === 'uv.exe' ? false : fs.existsSync(uv),
    python: py,
    pythonExists: fs.existsSync(py),
    sharp: sharp,
    sharpExists: fs.existsSync(sharp),
    ready: fs.existsSync(py) && fs.existsSync(sharp),
  };
}

async function installRuntime() {
  ensureDirs();
  const ml = mlSharpSourcePath();
  if (!fs.existsSync(path.join(ml, 'requirements.txt'))) {
    throw new Error(`Bundled ml-sharp source not found at ${ml}`);
  }
  sendJobState({ busy: true, label: 'Installing SHARP runtime' });
  sendLog('Installing/checking Python + Apple SHARP runtime. First run can take a while because PyTorch is large.');

  const uv = uvPath();
  const venvDir = path.join(runtimeRoot(), 'venv');
  const env = {
    UV_PYTHON_INSTALL_DIR: path.join(runtimeRoot(), 'uv-python'),
    UV_CACHE_DIR: path.join(runtimeRoot(), 'uv-cache'),
    UV_LINK_MODE: 'copy',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  await runProcess(uv, ['venv', venvDir, '--python', '3.13', '--python-preference', 'managed'], { env });
  const py = venvPythonPath();

  // Apple's requirements.txt contains `-e .`. For a portable app, install dependencies
  // first, then install ml-sharp non-editably so the bundled resources can stay read-only.
  const filteredRequirements = path.join(runtimeRoot(), 'requirements-no-editable.txt');
  const reqText = fs.readFileSync(path.join(ml, 'requirements.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('-e '))
    .join('\n');
  fs.writeFileSync(filteredRequirements, reqText);
  await runProcess(uv, ['pip', 'install', '--python', py, '-r', filteredRequirements], {
    cwd: ml,
    env,
  });
  await runProcess(uv, ['pip', 'install', '--python', py, ml], { cwd: ml, env });

  sendLog('Runtime install complete.');
  sendJobState({ busy: false, label: 'Runtime ready' });
  return checkRuntimeStatus();
}

function isImagePath(inputPath) {
  return ['.exr', '.png', '.jpg', '.jpeg'].includes(path.extname(inputPath || '').toLowerCase());
}

function sanitizeStem(inputPath) {
  return path.basename(inputPath, path.extname(inputPath)).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function writePngFromImage(image, outputPath) {
  const png = new PNG({ width: image.width, height: image.height, colorType: 6 });
  const count = image.width * image.height;
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    png.data[j] = Math.round(clamp01(image.rgba[j]) * 255);
    png.data[j + 1] = Math.round(clamp01(image.rgba[j + 1]) * 255);
    png.data[j + 2] = Math.round(clamp01(image.rgba[j + 2]) * 255);
    png.data[j + 3] = Math.round(clamp01(image.rgba[j + 3]) * 255);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(png));
}

async function prepareInferenceInput(inputPath, opts) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.exr') return { inferencePath: inputPath, converted: false };

  sendLog('Converting EXR for SHARP inference: ACEScg/linear input → tone-mapped sRGB PNG. Original EXR is preserved.');
  const image = await loadImage(inputPath, opts || {});
  const out = path.join(runtimeRoot(), 'converted-inputs', `${sanitizeStem(inputPath)}_sharp_input.png`);
  writePngFromImage(image, out);
  return { inferencePath: out, converted: true, convertedPath: out };
}

function findNewestByExt(outputDir, extension) {
  if (!fs.existsSync(outputDir)) return null;
  const wanted = String(extension || '').toLowerCase();
  const files = fs.readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith(wanted))
    .map((name) => {
      const filePath = path.join(outputDir, name);
      const stat = fs.statSync(filePath);
      return { filePath, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

function findNewestPly(outputDir) {
  return findNewestByExt(outputDir, '.ply');
}

function findNewestGlb(outputDir) {
  return findNewestByExt(outputDir, '.glb');
}

function _oldFindNewestPly(outputDir) {
  if (!fs.existsSync(outputDir)) return null;
  const files = fs.readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith('.ply'))
    .map((name) => {
      const filePath = path.join(outputDir, name);
      const stat = fs.statSync(filePath);
      return { filePath, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

function checkPixal3DStatus() {
  const root = pixal3dRoot();
  const repo = pixal3dRepoPath();
  const py = pixal3dPythonPath();
  const marker = pixal3dInstallMarkerPath();
  return {
    root,
    repo,
    repoExists: fs.existsSync(path.join(repo, 'inference.py')),
    python: py,
    pythonExists: fs.existsSync(py),
    installMarker: marker,
    installMarkerExists: fs.existsSync(marker),
    ready: fs.existsSync(path.join(repo, 'inference.py')) && fs.existsSync(py) && fs.existsSync(marker),
    license: 'Pixal3D academic-only, no commercial/production use, not intended for EU use.',
  };
}

async function installPixal3D(request = {}) {
  if (!request.acceptLicense) throw new Error('Pixal3D license gate not accepted. It is academic-only, non-production, and not intended for EU use.');
  if (process.platform === 'win32') {
    sendLog('Warning: Pixal3D upstream is Linux-first. Windows install uses community CUDA wheels and PyTorch SDPA fallback, isolated from SHARP.');
  }
  const root = pixal3dRoot();
  const repo = pixal3dRepoPath();
  fs.mkdirSync(root, { recursive: true });
  sendJobState({ busy: true, label: 'Installing Pixal3D experimental backend' });
  sendLog('Pixal3D experimental backend is isolated from the bundled SHARP runtime.');
  sendLog('License gate accepted for local academic/research testing only; this is not bundled into the MIT app runtime.');

  if (!fs.existsSync(path.join(repo, '.git'))) {
    await runProcess('git', ['clone', '--depth', '1', 'https://github.com/TencentARC/Pixal3D.git', repo], { cwd: root });
  } else {
    await runProcess('git', ['fetch', '--depth', '1', 'origin', 'master'], { cwd: repo });
    await runProcess('git', ['checkout', 'FETCH_HEAD'], { cwd: repo });
  }

  patchPixal3DWindowsSource(repo);

  const uv = uvPath();
  const env = {
    UV_CACHE_DIR: path.join(root, 'uv-cache'),
    UV_LINK_MODE: 'copy',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };
  if (process.platform === 'win32' && fs.existsSync(pixal3dVenvPath()) && !fs.existsSync(pixal3dInstallMarkerPath())) {
    sendLog('Removing incomplete previous Pixal3D Windows venv before creating the Python 3.11 SDPA runtime.');
    fs.rmSync(pixal3dVenvPath(), { recursive: true, force: true });
  }
  const pythonVersion = process.platform === 'win32' ? '3.11' : '3.10';
  await runProcess(uv, ['venv', pixal3dVenvPath(), '--python', pythonVersion, '--python-preference', 'managed'], { env });
  const py = pixal3dPythonPath();
  const requirements = fs.existsSync(path.join(repo, 'requirements-hfdemo.txt')) && process.platform !== 'win32'
    ? 'requirements-hfdemo.txt'
    : 'requirements.txt';
  const sourceRequirementsPath = path.join(repo, requirements);
  const filteredRequirementsPath = path.join(root, `requirements-${process.platform}-no-natten.txt`);
  const filteredRequirements = fs.readFileSync(sourceRequirementsPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim().toLowerCase();
      if (!trimmed || trimmed.startsWith('#')) return true;
      if (trimmed.startsWith('natten')) return false;
      if (trimmed.startsWith('torch==') || trimmed.startsWith('torchvision==')) return false;
      if (trimmed.startsWith('triton==') && process.platform === 'win32') return false;
      return true;
    })
    .join('\n');
  fs.writeFileSync(filteredRequirementsPath, filteredRequirements);

  sendLog('Pre-installing CUDA PyTorch for Pixal3D. This is large.');
  if (process.platform === 'win32') {
    await runProcess(uv, ['pip', 'install', '--python', py, '--index-url', 'https://download.pytorch.org/whl/cu128', 'torch==2.7.0', 'torchvision==0.22.0'], { cwd: repo, env });
    sendLog('Skipping NATTEN on Windows: Pixal3D does not import it directly, and official 0.21.0 wheels are Linux-only. Using PyTorch SDPA attention fallback instead.');
    sendLog('Installing pinned community Windows CUDA wheels for Pixal3D mesh/texturing extensions (cumesh, flex_gemm, nvdiffrast, nvdiffrec_render, o_voxel).');
    await runProcess(uv, ['pip', 'install', '--python', py, ...pixal3dWindowsWheelRequirements()], { cwd: repo, env });
  } else {
    await runProcess(uv, ['pip', 'install', '--python', py, '--extra-index-url', 'https://download.pytorch.org/whl/cu126', 'torch==2.7.0', 'torchvision==0.22.0'], { cwd: repo, env });
    await runProcess(uv, ['pip', 'install', '--python', py, 'natten==0.21.0+torch270cu126', '-f', 'https://whl.natten.org'], { cwd: repo, env });
  }

  sendLog(`Installing remaining Pixal3D dependencies from filtered ${requirements}. This can still be large and CUDA-specific.`);
  await runProcess(uv, ['pip', 'install', '--python', py, '--no-build-isolation', '-r', filteredRequirementsPath], { cwd: repo, env });
  await runProcess(uv, ['pip', 'install', '--python', py, 'https://github.com/LDYang694/Storages/releases/download/20260430/utils3d-0.0.2-py3-none-any.whl'], { cwd: repo, env });
  fs.writeFileSync(pixal3dInstallMarkerPath(), JSON.stringify({
    platform: process.platform,
    pythonVersion,
    attentionBackend: process.platform === 'win32' ? 'sdpa' : 'flash_attn',
    installedAt: new Date().toISOString(),
  }, null, 2));
  sendLog('Pixal3D experimental install complete.');
  sendJobState({ busy: false, label: 'Pixal3D ready' });
  return checkPixal3DStatus();
}

async function runPixal3D(request = {}) {
  if (!request.acceptLicense) throw new Error('Pixal3D license gate not accepted.');
  if (!request.inputPath || !fs.existsSync(request.inputPath)) throw new Error('Input file does not exist.');
  if (!request.outputFolder) throw new Error('Choose an output folder first.');
  const status = checkPixal3DStatus();
  if (!status.ready) await installPixal3D(request);
  fs.mkdirSync(request.outputFolder, { recursive: true });
  sendJobState({ busy: true, label: 'Running Pixal3D experimental GLB' });
  sendLog('Running Pixal3D as an external experimental provider: image → GLB mesh/material output.');
  const outputGlb = path.join(request.outputFolder, `${sanitizeStem(request.inputPath)}_pixal3d.glb`);
  const args = ['inference.py', '--image', request.inputPath, '--output', outputGlb, '--seed', String(request.seed || 42)];
  await runProcess(pixal3dPythonPath(), args, { cwd: pixal3dRepoPath(), env: pixal3dExecutionEnv() });
  const newest = fs.existsSync(outputGlb) ? { filePath: outputGlb, size: fs.statSync(outputGlb).size } : findNewestGlb(request.outputFolder);
  if (!newest) throw new Error('Pixal3D finished but no .glb was found in the output folder.');
  sendLog(`GLB written: ${newest.filePath}`);
  sendJobState({ busy: false, label: 'Pixal3D complete' });
  return { outputGlb: newest.filePath, sizeBytes: newest.size, provider: 'pixal3d-experimental' };
}

function sigmoid(v) {
  if (!Number.isFinite(v)) return 0.5;
  return 1 / (1 + Math.exp(-v));
}

function clampByte(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function propertyByteSize(type) {
  return ({
    char: 1, uchar: 1, int8: 1, uint8: 1,
    short: 2, ushort: 2, int16: 2, uint16: 2,
    int: 4, uint: 4, int32: 4, uint32: 4,
    float: 4, float32: 4, double: 8, float64: 8,
  })[type] || 4;
}

function readProperty(buffer, offset, type, littleEndian) {
  switch (type) {
    case 'char': case 'int8': return buffer.readInt8(offset);
    case 'uchar': case 'uint8': return buffer.readUInt8(offset);
    case 'short': case 'int16': return littleEndian ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
    case 'ushort': case 'uint16': return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 'int': case 'int32': return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    case 'uint': case 'uint32': return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    case 'double': case 'float64': return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
    case 'float': case 'float32': default: return littleEndian ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset);
  }
}

function parsePlyHeader(buffer) {
  const marker = Buffer.from('end_header');
  const markerAt = buffer.indexOf(marker);
  if (markerAt < 0) throw new Error('Invalid PLY: missing end_header.');
  let dataOffset = markerAt + marker.length;
  if (buffer[dataOffset] === 13 && buffer[dataOffset + 1] === 10) dataOffset += 2;
  else if (buffer[dataOffset] === 10) dataOffset += 1;
  const headerText = buffer.slice(0, markerAt + marker.length).toString('utf8');
  const lines = headerText.split(/\r?\n/);
  let format = 'ascii';
  let vertexCount = 0;
  const props = [];
  let inVertex = false;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'format') format = parts[1];
    else if (parts[0] === 'element') {
      inVertex = parts[1] === 'vertex';
      if (inVertex) vertexCount = Number(parts[2] || 0);
    } else if (inVertex && parts[0] === 'property' && parts[1] !== 'list') {
      props.push({ type: parts[1], name: parts[2], size: propertyByteSize(parts[1]) });
    }
  }
  if (!vertexCount || !props.length) throw new Error('Invalid PLY: no vertex properties found.');
  return { format, vertexCount, props, dataOffset };
}

function colorFromProperties(values) {
  if ('red' in values && 'green' in values && 'blue' in values) {
    return [clampByte(values.red), clampByte(values.green), clampByte(values.blue)];
  }
  if ('r' in values && 'g' in values && 'b' in values) {
    return [clampByte(values.r), clampByte(values.g), clampByte(values.b)];
  }
  if ('f_dc_0' in values && 'f_dc_1' in values && 'f_dc_2' in values) {
    const shC0 = 0.28209479177387814;
    return [
      clampByte((0.5 + shC0 * values.f_dc_0) * 255),
      clampByte((0.5 + shC0 * values.f_dc_1) * 255),
      clampByte((0.5 + shC0 * values.f_dc_2) * 255),
    ];
  }
  const a = 'opacity' in values ? sigmoid(values.opacity) : 1;
  const shade = clampByte(150 + 105 * a);
  return [shade, shade, shade];
}

function loadPlyPreview(filePath, maxPoints = 140000) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('PLY file does not exist.');
  const buffer = fs.readFileSync(filePath);
  const header = parsePlyHeader(buffer);
  const stride = header.props.reduce((sum, prop) => sum + prop.size, 0);
  const sampleStep = Math.max(1, Math.ceil(header.vertexCount / maxPoints));
  const count = Math.ceil(header.vertexCount / sampleStep);
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  let written = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  if (header.format === 'ascii') {
    const text = buffer.slice(header.dataOffset).toString('utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < header.vertexCount && i < lines.length; i += sampleStep) {
      const fields = lines[i].trim().split(/\s+/).map(Number);
      if (fields.length < header.props.length) continue;
      const values = {};
      header.props.forEach((prop, idx) => { values[prop.name] = fields[idx]; });
      const x = Number(values.x), y = Number(values.y), z = Number(values.z);
      if (![x, y, z].every(Number.isFinite)) continue;
      const p = written * 3;
      positions[p] = x; positions[p + 1] = y; positions[p + 2] = z;
      colors.set(colorFromProperties(values), p);
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
      written++;
    }
  } else if (header.format === 'binary_little_endian' || header.format === 'binary_big_endian') {
    const littleEndian = header.format === 'binary_little_endian';
    for (let i = 0; i < header.vertexCount; i += sampleStep) {
      let offset = header.dataOffset + i * stride;
      if (offset + stride > buffer.length) break;
      const values = {};
      for (const prop of header.props) {
        values[prop.name] = readProperty(buffer, offset, prop.type, littleEndian);
        offset += prop.size;
      }
      const x = Number(values.x), y = Number(values.y), z = Number(values.z);
      if (![x, y, z].every(Number.isFinite)) continue;
      const p = written * 3;
      positions[p] = x; positions[p + 1] = y; positions[p + 2] = z;
      colors.set(colorFromProperties(values), p);
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
      written++;
    }
  } else {
    throw new Error(`Unsupported PLY format '${header.format}'.`);
  }

  if (!written) throw new Error('PLY contained no readable vertices.');
  return {
    vertexCount: header.vertexCount,
    shownCount: written,
    positions: Array.from(positions.slice(0, written * 3)),
    colors: Array.from(colors.slice(0, written * 3)),
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  };
}


ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { ok: false, status: 'dev', message: 'Updates are only available in the installed Windows build.' };
  }
  const result = await autoUpdater.checkForUpdates();
  return { ok: true, status: 'checking', result: !!result };
});

ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) {
    return { ok: false, status: 'dev', message: 'Updates are only available in the installed Windows build.' };
  }
  await autoUpdater.downloadUpdate();
  return { ok: true, status: 'downloading' };
});

ipcMain.handle('restart-and-install-update', async () => {
  if (!updateDownloaded) return { ok: false, message: 'No downloaded update is ready yet.' };
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle('select-input', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose one frame for SHARP',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['exr', 'png', 'jpg', 'jpeg'] },
      { name: 'OpenEXR', extensions: ['exr'] },
      { name: 'PNG/JPEG', extensions: ['png', 'jpg', 'jpeg'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const inputPath = result.filePaths[0];
  if (!isImagePath(inputPath)) throw new Error('Use EXR, PNG, JPG, or JPEG.');
  return { inputPath, defaultColorSpace: defaultColorSpaceFor(inputPath) };
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose SHARP output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('inspect-input', async (_event, inputPath, opts) => {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Input file does not exist.');
  const image = await loadImage(inputPath, opts || {});
  const previewDataUrl = makePreviewPngDataUrl(image, 1400);
  return {
    width: image.width,
    height: image.height,
    source: image.source,
    sourceColorSpace: image.sourceColorSpace,
    previewDataUrl,
  };
});

ipcMain.handle('check-runtime', checkRuntimeStatus);
ipcMain.handle('check-pixal3d', async () => checkPixal3DStatus());
ipcMain.handle('install-pixal3d', async (_event, request) => {
  try {
    return await installPixal3D(request || {});
  } catch (err) {
    sendJobState({ busy: false, label: 'Pixal3D install failed' });
    throw err;
  }
});
ipcMain.handle('run-pixal3d', async (_event, request) => {
  try {
    return await runPixal3D(request || {});
  } catch (err) {
    sendJobState({ busy: false, label: 'Pixal3D failed' });
    throw err;
  }
});

ipcMain.handle('install-runtime', async () => {
  try {
    return await installRuntime();
  } catch (err) {
    sendJobState({ busy: false, label: 'Install failed' });
    throw err;
  }
});

ipcMain.handle('run-sharp', async (_event, request) => {
  if (!request || !request.inputPath || !fs.existsSync(request.inputPath)) throw new Error('Input file does not exist.');
  if (!request.outputFolder) throw new Error('Choose an output folder first.');
  ensureDirs();
  fs.mkdirSync(request.outputFolder, { recursive: true });

  sendJobState({ busy: true, label: 'Running SHARP' });
  try {
    const status = await checkRuntimeStatus();
    if (!status.ready) await installRuntime();

    const prepared = await prepareInferenceInput(request.inputPath, request);
    const sharp = sharpExePath();
    const args = ['predict', '-i', prepared.inferencePath, '-o', request.outputFolder, '--device', request.device || 'default'];
    if (request.verbose) args.push('-v');
    await runProcess(sharp, args, { cwd: mlSharpSourcePath() });
    const newest = findNewestPly(request.outputFolder);
    if (!newest) throw new Error('SHARP finished but no .ply was found in the output folder.');
    sendLog(`PLY written: ${newest.filePath}`);
    sendJobState({ busy: false, label: 'Done' });
    return { ok: true, outputPly: newest.filePath, outputFolder: request.outputFolder, converted: prepared.converted, convertedPath: prepared.convertedPath || null, sizeBytes: newest.size };
  } catch (err) {
    sendJobState({ busy: false, label: 'Failed' });
    throw err;
  }
});

ipcMain.handle('cancel-job', async () => {
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
    sendLog('Cancelled active process.');
    sendJobState({ busy: false, label: 'Cancelled' });
    return true;
  }
  return false;
});

ipcMain.handle('show-in-folder', async (_event, filePath) => {
  if (!filePath) return false;
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('open-path', async (_event, filePath) => {
  if (!filePath) return false;
  await shell.openPath(filePath);
  return true;
});

ipcMain.handle('load-ply-preview', async (_event, filePath) => loadPlyPreview(filePath));

ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});
