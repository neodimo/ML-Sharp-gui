'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with code ${result.status}`);
}

function requireFile(rel) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) fail(`Missing required release artifact: ${rel}`);
  const size = fs.statSync(filePath).size;
  if (size <= 0) fail(`Release artifact is empty: ${rel}`);
  return { rel, size };
}

function prebuild() {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version must be semver, got ${version}`);
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    const expected = `v${version}`;
    if (process.env.GITHUB_REF_NAME !== expected) {
      fail(`Release tag/package mismatch: tag ${process.env.GITHUB_REF_NAME}, package ${expected}`);
    }
  }
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'qa']);
  console.log(JSON.stringify({ ok: true, phase: 'prebuild', version }, null, 2));
}

function postbuild() {
  const artifacts = [
    requireFile(`dist/2D-to-3D-Setup-${version}.exe`),
    requireFile(`dist/2D-to-3D-Setup-${version}.exe.blockmap`),
    requireFile('dist/latest.yml'),
  ];
  const latest = fs.readFileSync(path.join(root, 'dist', 'latest.yml'), 'utf8');
  if (!latest.includes(`version: ${version}`)) fail(`latest.yml does not reference version ${version}`);
  if (!latest.includes(`2D-to-3D-Setup-${version}.exe`)) fail(`latest.yml does not reference installer for ${version}`);
  console.log(JSON.stringify({ ok: true, phase: 'postbuild', version, artifacts }, null, 2));
}

const phase = process.argv[2];
if (phase === 'prebuild') prebuild();
else if (phase === 'postbuild') postbuild();
else fail('Usage: node scripts/release-gate.cjs <prebuild|postbuild>');
