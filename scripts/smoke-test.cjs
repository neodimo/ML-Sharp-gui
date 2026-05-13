'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { loadImage, makePreviewPngDataUrl } = require('../src/lib/image-loader.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'test-output');
  fs.mkdirSync(outDir, { recursive: true });
  const inputPath = path.join(outDir, 'smoke-gradient.png');
  const png = new PNG({ width: 64, height: 48, colorType: 6 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = Math.round((x / (png.width - 1)) * 255);
      png.data[i + 1] = Math.round((y / (png.height - 1)) * 255);
      png.data[i + 2] = 128;
      png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(inputPath, PNG.sync.write(png));
  const img = await loadImage(inputPath, { sourceColorSpace: 'display-srgb' });
  const dataUrl = makePreviewPngDataUrl(img, 256);
  if (img.width !== 64 || img.height !== 48) throw new Error('Bad decode dimensions');
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('Bad preview data URL');
  const required = [
    'src/main.cjs',
    'src/preload.cjs',
    'src/renderer/index.html',
    'vendor/ml-sharp/requirements.txt',
    'vendor/ml-sharp/src/sharp/cli/predict.py',
  ];
  for (const rel of required) {
    if (!fs.existsSync(path.join(root, rel))) throw new Error(`Missing ${rel}`);
  }
  console.log(JSON.stringify({ ok: true, inputPath, width: img.width, height: img.height, previewBytes: dataUrl.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
