'use strict';

// Approximate ACEScg (AP1, D60) linear RGB to sRGB/Rec.709 (D65) linear RGB.
// Matrix commonly used in CG pipelines with chromatic adaptation baked in.
const ACESCG_TO_LINEAR_SRGB = [
  [1.704887331, -0.624157274, -0.080886773],
  [-0.129520972, 1.138399326, -0.008779598],
  [-0.024127060, -0.124620685, 1.148822108],
];

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function linearToSrgb(v) {
  v = clamp01(v);
  if (v <= 0.0031308) return 12.92 * v;
  return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function srgbToLinear(v) {
  v = clamp01(v);
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

function acescgToLinearSrgb(r, g, b) {
  const m = ACESCG_TO_LINEAR_SRGB;
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

function toneMapLinear(v, mode) {
  if (!Number.isFinite(v)) return 0;
  v = Math.max(0, v);
  if (mode === 'reinhard') return v / (1 + v);
  if (mode === 'filmic') {
    // Lightweight ACES-ish fit for nicer HDR EXR preview/output.
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;
    return clamp01((v * (a * v + b)) / (v * (c * v + d) + e));
  }
  return clamp01(v);
}

function convertInputRgbToDisplaySrgb(r, g, b, opts = {}) {
  const sourceColorSpace = opts.sourceColorSpace || 'acescg';
  const toneMap = opts.toneMap || 'filmic';
  const exposureStops = Number(opts.exposureStops ?? 0);
  const exposure = Math.pow(2, exposureStops);

  if (sourceColorSpace === 'display-srgb') {
    // Already display-referred bytes/values.
    return [clamp01(r), clamp01(g), clamp01(b)];
  }

  let lr = r;
  let lg = g;
  let lb = b;

  if (sourceColorSpace === 'acescg') {
    [lr, lg, lb] = acescgToLinearSrgb(r, g, b);
  } else if (sourceColorSpace === 'srgb-linear') {
    // no-op
  } else if (sourceColorSpace === 'srgb-encoded') {
    lr = srgbToLinear(r);
    lg = srgbToLinear(g);
    lb = srgbToLinear(b);
  }

  lr = toneMapLinear(lr * exposure, toneMap);
  lg = toneMapLinear(lg * exposure, toneMap);
  lb = toneMapLinear(lb * exposure, toneMap);

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

function luminanceSrgb(r, g, b) {
  // Rec.709 luma on display RGB; good enough for depth-proxy generation.
  return clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function logit(alpha) {
  alpha = Math.min(0.999, Math.max(0.001, alpha));
  return Math.log(alpha / (1 - alpha));
}

module.exports = {
  clamp01,
  linearToSrgb,
  srgbToLinear,
  acescgToLinearSrgb,
  convertInputRgbToDisplaySrgb,
  luminanceSrgb,
  logit,
};
