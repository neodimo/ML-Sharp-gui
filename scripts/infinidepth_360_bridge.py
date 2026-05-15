#!/usr/bin/env python
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a tiled InfiniDepth panorama depth reference.")
    parser.add_argument("--repo", required=True, type=Path, help="InfiniDepth checkout path.")
    parser.add_argument("--input", required=True, type=Path, help="Input stitched 2:1 panorama.")
    parser.add_argument("--output", required=True, type=Path, help="Output .npy panorama depth/disparity reference.")
    parser.add_argument("--depth-model", required=True, type=Path, help="InfiniDepth depth checkpoint.")
    parser.add_argument("--moge-model", required=True, type=Path, help="MoGe-2 checkpoint used by InfiniDepth for metric scale.")
    return parser.parse_args()


def run_tile(repo: Path, image_path: Path, depth_model: Path, moge_model: Path) -> np.ndarray:
    sys.path.insert(0, str(repo))
    from inference_depth import DepthInferenceArgs, load_depth_model, run_depth_inference

    args = DepthInferenceArgs(
        input_image_path=str(image_path),
        model_type="InfiniDepth",
        depth_model_path=str(depth_model),
        moge2_pretrained=str(moge_model),
        output_resolution_mode="original",
        save_pcd=False,
    )
    model, device = load_depth_model(args)
    result = run_depth_inference(args, model=model, device=device)
    depth = result.pred_depthmap.squeeze().detach().cpu().numpy().astype(np.float32)
    if not np.isfinite(depth).any():
        raise RuntimeError(f"InfiniDepth produced no finite depth values for {image_path}")
    return depth


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    if not (repo / "inference_depth.py").exists():
        raise FileNotFoundError(f"InfiniDepth repo not found: {repo}")
    if not args.depth_model.exists():
        raise FileNotFoundError(f"InfiniDepth depth checkpoint not found: {args.depth_model}")
    if not args.moge_model.exists():
        raise FileNotFoundError(f"MoGe-2 checkpoint not found: {args.moge_model}")

    image = Image.open(args.input).convert("RGB")
    width, height = image.size
    if height <= 0 or abs((width / height) - 2.0) > 0.08:
        raise ValueError("InfiniDepth 360 bridge expects a stitched 2:1 equirectangular panorama.")

    work_dir = args.output.parent / f"{args.output.stem}_tiles"
    work_dir.mkdir(parents=True, exist_ok=True)
    left_path = work_dir / "tile_left.png"
    right_path = work_dir / "tile_right.png"
    mid = width // 2
    image.crop((0, 0, mid, height)).save(left_path)
    image.crop((mid, 0, width, height)).save(right_path)

    left_depth = run_tile(repo, left_path, args.depth_model, args.moge_model)
    right_depth = run_tile(repo, right_path, args.depth_model, args.moge_model)
    if left_depth.shape[0] != right_depth.shape[0]:
        raise RuntimeError(f"InfiniDepth tile heights differ: {left_depth.shape} vs {right_depth.shape}")

    # InfiniDepth returns metric-ish depth; SHARP_360's DA360 path aligns against
    # a scalar reference sampled per view. Using inverse depth keeps the value
    # behavior close to DA360's disparity reference.
    pano_depth = np.concatenate([left_depth, right_depth], axis=1)
    finite = np.isfinite(pano_depth) & (pano_depth > 1e-6)
    if not finite.any():
        raise RuntimeError("InfiniDepth tiled panorama depth contains no valid pixels.")
    disparity = np.zeros_like(pano_depth, dtype=np.float32)
    disparity[finite] = 1.0 / pano_depth[finite]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.save(args.output, disparity.astype(np.float32))
    print(f"Wrote tiled InfiniDepth panorama reference: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
