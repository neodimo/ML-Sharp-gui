'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const html = read('src/renderer/index.html');
const css = read('src/renderer/styles.css');
const renderer = read('src/renderer/renderer.js');
const preload = read('src/preload.cjs');
const main = read('src/main.cjs');
const workflow = read('.github/workflows/windows-release.yml');

const failures = [];

function check(name, condition, detail = '') {
  if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
}

function includesAll(label, text, needles) {
  for (const needle of needles) {
    check(label, text.includes(needle), `missing ${JSON.stringify(needle)}`);
  }
}

check('package version is semver', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);

includesAll('header version badge contract', html, [
  'id="appVersion"',
]);
check('header version badge has visible semver fallback', /id="appVersion"[^>]*>v\d+\.\d+\.\d+</.test(html));
includesAll('collapsible full log rail contract', html, [
  '<aside class="rightRail">',
  '<details class="panel logPanel">',
  '<pre id="log"></pre>',
]);
includesAll('viewer canvas contract', html, [
  'id="plyCanvas"',
  'id="plyCanvas2D"',
  'id="glbCanvas"',
]);

includesAll('layout style contract', css, [
  '.appVersion',
  '.rightRail',
  '.logPanel',
  '#plyCanvas, #plyCanvas2D, #glbCanvas',
]);
check('workbench keeps right rail column', /\.workbench\s*\{[^}]*grid-template-columns:[^;}]*minmax\(220px,\s*300px\)/s.test(css));

includesAll('renderer element map contract', renderer, [
  "appVersion: $('appVersion')",
  "plyCanvas: $('plyCanvas')",
  "plyCanvas2D: $('plyCanvas2D')",
  'sharpSplat.getAppVersion()',
]);
includesAll('PLY fallback visibility contract', renderer, [
  "el.plyCanvas.classList.add('hidden')",
  "el.plyCanvas2D.classList.remove('hidden')",
  'resetViewerCamera();',
]);
check('Babylon Y-flip tolerates Scene.meshes fallback', /typeof scene\.getMeshes === 'function' \? scene\.getMeshes\(\) : scene\.meshes/.test(renderer));
check('PLY fallback avoids requiring both canvases visible for keyboard handling', renderer.includes("el.plyCanvas.classList.contains('hidden') && el.plyCanvas2D.classList.contains('hidden')"));

includesAll('preload app version bridge', preload, [
  'getAppVersion',
  "ipcRenderer.invoke('get-app-version')",
]);
includesAll('silent updater contract', main, [
  "ipcMain.handle('get-app-version'",
  'autoUpdater.quitAndInstall(true, true)',
]);
check('installer UI updater regression stays blocked', !main.includes('autoUpdater.quitAndInstall(false, true)'));

includesAll('CI release gate contract', workflow, [
  'npm run qa',
  'Build and publish Windows installer',
]);

if (failures.length) {
  console.error('Regression gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  version: pkg.version,
  checks: [
    'version badge',
    'right log rail',
    'split PLY canvases',
    'PLY fallback',
    'silent updater',
    'CI qa gate',
  ],
}, null, 2));
