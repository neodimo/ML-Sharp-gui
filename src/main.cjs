'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { PNG } = require('pngjs');
const { defaultColorSpaceFor, loadImage, makePreviewPngDataUrl } = require('./lib/image-loader.cjs');
const { clamp01 } = require('./lib/color.cjs');

let mainWindow;
let activeProcess = null;

const APP_VERSION = require('../package.json').version;
const UPDATE_OWNER = 'neodimo';
const UPDATE_REPO = 'ML-Sharp-gui';
const UPDATE_ASSET_RE = /SharpSplatSHARP.*win.*x64.*\.zip$/i;

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

app.whenReady().then(() => {
  if (hasPendingUpdate() && launchPendingUpdateInstaller()) {
    app.quit();
    return;
  }
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
  return path.join(appRoot(), 'sharp-runtime');
}

function updateRoot() {
  return path.join(appRoot(), 'updates');
}

function stagedUpdatePath() {
  return path.join(updateRoot(), 'pending-update.json');
}

function compareVersions(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || '0').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function githubApi(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: pathname,
      method: 'GET',
      headers: {
        'User-Agent': `ML-Sharp-gui/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub update check failed (${res.statusCode}). If the repo is private, publish public release assets or configure an updater token.`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function expectedSha256FromBody(body, assetName) {
  const text = String(body || '');
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nearAsset = new RegExp(`([a-fA-F0-9]{64}).{0,160}${escaped}|${escaped}.{0,160}([a-fA-F0-9]{64})`, 's');
  const nearMatch = text.match(nearAsset);
  if (nearMatch) return (nearMatch[1] || nearMatch[2]).toLowerCase();
  const anyMatch = text.match(/\b[a-fA-F0-9]{64}\b/);
  return anyMatch ? anyMatch[0].toLowerCase() : null;
}

async function checkForUpdates() {
  const release = await githubApi(`/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`);
  const tag = String(release.tag_name || '').replace(/^v/i, '');
  const asset = (release.assets || []).find((item) => UPDATE_ASSET_RE.test(item.name || ''));
  if (!asset) throw new Error('Latest release does not include a Windows x64 ZIP asset.');
  return {
    currentVersion: APP_VERSION,
    latestVersion: tag || release.tag_name,
    tagName: release.tag_name,
    releaseName: release.name || release.tag_name,
    releaseUrl: release.html_url,
    assetName: asset.name,
    assetSize: asset.size,
    downloadUrl: asset.browser_download_url,
    expectedSha256: expectedSha256FromBody(release.body, asset.name),
    updateAvailable: compareVersions(tag || release.tag_name, APP_VERSION) > 0,
  };
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const file = fs.createWriteStream(outputPath);
    function request(nextUrl) {
      https.get(nextUrl, { headers: { 'User-Agent': `ML-Sharp-gui/${APP_VERSION}` } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Download failed (${res.statusCode}).`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    }
    request(url);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}


function hasPendingUpdate() {
  return fs.existsSync(stagedUpdatePath());
}

function launchPendingUpdateInstaller() {
  const pendingPath = stagedUpdatePath();
  if (!fs.existsSync(pendingPath)) return false;
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  const scriptPath = path.join(updateRoot(), 'apply-pending-update.ps1');
  const extractDir = path.join(updateRoot(), 'extracted');
  const backupDir = path.join(updateRoot(), 'backup-before-update');
  const exePath = process.execPath;
  const script = `
$ErrorActionPreference = 'Stop'
$pidToWait = ${process.pid}
$zip = ${JSON.stringify(pending.zipPath)}
$appDir = ${JSON.stringify(appRoot())}
$extractDir = ${JSON.stringify(extractDir)}
$backupDir = ${JSON.stringify(backupDir)}
$pendingPath = ${JSON.stringify(pendingPath)}
$exePath = ${JSON.stringify(exePath)}
Wait-Process -Id $pidToWait -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 450
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $extractDir -Force
$payload = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
if ($null -eq $payload) { throw 'Update ZIP did not contain an app folder.' }
Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Get-ChildItem -LiteralPath $appDir -Force | Where-Object { $_.Name -notin @('sharp-runtime','updates') } | ForEach-Object {
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $backupDir $_.Name) -Force
}
Copy-Item -LiteralPath (Join-Path $payload.FullName '*') -Destination $appDir -Recurse -Force
Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $exePath -WorkingDirectory $appDir
`;
  fs.mkdirSync(updateRoot(), { recursive: true });
  fs.writeFileSync(scriptPath, script, 'utf8');
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  return true;
}

async function stageUpdate(updateInfo) {
  if (!updateInfo || !updateInfo.downloadUrl) updateInfo = await checkForUpdates();
  if (!updateInfo.updateAvailable) return { ...updateInfo, staged: false, message: 'Already up to date.' };
  const zipPath = path.join(updateRoot(), `${updateInfo.tagName || updateInfo.latestVersion}-${updateInfo.assetName}`.replace(/[^a-zA-Z0-9._-]+/g, '_'));
  sendLog(`Downloading update ${updateInfo.tagName || updateInfo.latestVersion}: ${updateInfo.assetName}`);
  await downloadFile(updateInfo.downloadUrl, zipPath);
  const actualSha256 = await sha256File(zipPath);
  if (updateInfo.expectedSha256 && actualSha256 !== updateInfo.expectedSha256) {
    fs.rmSync(zipPath, { force: true });
    throw new Error(`Downloaded update checksum mismatch. Expected ${updateInfo.expectedSha256}, got ${actualSha256}.`);
  }
  const pending = {
    ...updateInfo,
    zipPath,
    actualSha256,
    appRoot: appRoot(),
    runtimeRoot: runtimeRoot(),
    stagedAt: new Date().toISOString(),
  };
  fs.writeFileSync(stagedUpdatePath(), JSON.stringify(pending, null, 2));
  return { ...pending, staged: true, message: 'Update downloaded. Restart the app to finish installing.' };
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

function ensureDirs() {
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
    sendLog(`> ${[command, ...args].map(quoteForLog).join(' ')}`);
    child.stdout.on('data', (data) => sendLog(data.toString().trimEnd()));
    child.stderr.on('data', (data) => sendLog(data.toString().trimEnd()));
    child.on('error', (err) => {
      activeProcess = null;
      reject(err);
    });
    child.on('close', (code) => {
      activeProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}`));
    });
  });
}

async function checkRuntimeStatus() {
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

function findNewestPly(outputDir) {
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


ipcMain.handle('get-app-version', async () => APP_VERSION);
ipcMain.handle('check-for-updates', async () => checkForUpdates());
ipcMain.handle('stage-update', async (_event, updateInfo) => stageUpdate(updateInfo));

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
