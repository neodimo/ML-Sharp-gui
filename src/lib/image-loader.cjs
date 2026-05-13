'use strict';

const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { convertInputRgbToDisplaySrgb, clamp01 } = require('./color.cjs');

const EXR_FLOAT_TYPE = 1015;

function extLower(filePath) {
  return path.extname(filePath || '').toLowerCase();
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function defaultColorSpaceFor(filePath) {
  const ext = extLower(filePath);
  if (ext === '.exr') return 'acescg';
  return 'display-srgb';
}

async function decodeExr(filePath, opts = {}) {
  const parseExr = (await import('parse-exr')).default;
  const buffer = fs.readFileSync(filePath);
  const exr = parseExr(bufferToArrayBuffer(buffer), EXR_FLOAT_TYPE);
  const width = exr.width;
  const height = exr.height;
  const count = width * height;
  const sourceColorSpace = opts.sourceColorSpace || defaultColorSpaceFor(filePath);
  const data = exr.data;
  const channels = data.length >= count * 4 ? 4 : 1;
  const rgba = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    let r;
    let g;
    let b;
    let a = 1;
    if (channels === 4) {
      const j = i * 4;
      r = data[j];
      g = data[j + 1];
      b = data[j + 2];
      a = data[j + 3];
    } else {
      r = g = b = data[i];
    }
    const out = convertInputRgbToDisplaySrgb(r, g, b, {
      sourceColorSpace,
      toneMap: opts.toneMap,
      exposureStops: opts.exposureStops,
    });
    const k = i * 4;
    rgba[k] = out[0];
    rgba[k + 1] = out[1];
    rgba[k + 2] = out[2];
    rgba[k + 3] = clamp01(Number.isFinite(a) ? a : 1);
  }

  return { width, height, rgba, source: 'exr', sourceColorSpace };
}

function decodePng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const width = png.width;
  const height = png.height;
  const count = width * height;
  const rgba = new Float32Array(count * 4);
  const bytesPerPixel = png.data.length / count;

  for (let i = 0; i < count; i++) {
    const j = i * bytesPerPixel;
    let r;
    let g;
    let b;
    let a = 1;
    if (bytesPerPixel >= 8) {
      // 16-bit RGBA-like data: two bytes per sample.
      const read16 = (offset) => png.data.readUInt16BE(offset) / 65535;
      r = read16(j);
      g = read16(j + 2);
      b = read16(j + 4);
      a = read16(j + 6);
    } else if (bytesPerPixel >= 4) {
      r = png.data[j] / 255;
      g = png.data[j + 1] / 255;
      b = png.data[j + 2] / 255;
      a = png.data[j + 3] / 255;
    } else if (bytesPerPixel === 3) {
      r = png.data[j] / 255;
      g = png.data[j + 1] / 255;
      b = png.data[j + 2] / 255;
    } else if (bytesPerPixel === 2) {
      r = g = b = png.data[j] / 255;
      a = png.data[j + 1] / 255;
    } else {
      r = g = b = png.data[j] / 255;
    }
    const k = i * 4;
    rgba[k] = clamp01(r);
    rgba[k + 1] = clamp01(g);
    rgba[k + 2] = clamp01(b);
    rgba[k + 3] = clamp01(a);
  }
  return { width, height, rgba, source: 'png', sourceColorSpace: 'display-srgb' };
}

function decodeJpeg(filePath) {
  const img = jpeg.decode(fs.readFileSync(filePath), { useTArray: true, colorTransform: true });
  const width = img.width;
  const height = img.height;
  const count = width * height;
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    rgba[j] = img.data[j] / 255;
    rgba[j + 1] = img.data[j + 1] / 255;
    rgba[j + 2] = img.data[j + 2] / 255;
    rgba[j + 3] = 1;
  }
  return { width, height, rgba, source: 'jpeg', sourceColorSpace: 'display-srgb' };
}

async function loadImage(filePath, opts = {}) {
  const ext = extLower(filePath);
  if (ext === '.exr') return decodeExr(filePath, opts);
  if (ext === '.png') return decodePng(filePath);
  if (ext === '.jpg' || ext === '.jpeg') return decodeJpeg(filePath);
  throw new Error(`Unsupported input type '${ext}'. Use EXR, PNG, JPG, or JPEG.`);
}

function makePreviewPngDataUrl(image, maxEdge = 1200) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const png = new PNG({ width, height, colorType: 6 });

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      png.data[dst] = Math.round(clamp01(image.rgba[src]) * 255);
      png.data[dst + 1] = Math.round(clamp01(image.rgba[src + 1]) * 255);
      png.data[dst + 2] = Math.round(clamp01(image.rgba[src + 2]) * 255);
      png.data[dst + 3] = Math.round(clamp01(image.rgba[src + 3]) * 255);
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

module.exports = {
  defaultColorSpaceFor,
  loadImage,
  makePreviewPngDataUrl,
};
