# 360 Panorama Workflow Notes

Source references:

- Reddit discussion: https://www.reddit.com/r/GaussianSplatting/comments/1sdba0d/creating_a_full_360_gaussian_splat_from_just_one/
- Reference implementation: https://github.com/Enndee/SHARP_360_to_Splat

## Goal

Add an optional 360 panorama path without making the main SHARP frame-to-PLY workflow feel crowded.

The app should stay mode-driven:

- Standard frame mode: current default, one image to SHARP PLY.
- 360 panorama mode: only reveal panorama-specific controls after the user selects a 2:1 equirectangular image or chooses the mode explicitly.
- Experimental Pixal3D mode: remains separate from SHARP and panorama controls.

## Useful upstream findings

- Input is a stitched 2:1 equirectangular panorama, not raw camera files such as Insta360 .insp.
- Recommended starting point is 4 extracted perspective views. The OP notes that more views rarely improve detail and can introduce alignment problems.
- Default alignment should be overlap-based. DA360 is useful as a fallback when overlap alignment fails.
- InfiniDepth may be a stronger depth prior than DA360, but needs a tiled 360-specific path because feeding a full equirectangular image directly can fail.
- Optional SeedVR2 upscaling and motion deblur are useful, but should stay advanced toggles because they add setup/runtime weight.
- CPU-only torch setup is valuable as a beginner/last-case path when no Nvidia GPU is available.
- Expected baseline processing can be about a minute without upscaling, but heavy options will be much slower.
- Splat sequences from video are not a good near-term target; 4DGS approaches fit that problem better.

## Candidate product shape

Keep the default app simple:

1. Select input.
2. If image aspect ratio is close to 2:1, show a compact 360 badge/action: "Use as 360 panorama".
3. When enabled, reveal a 360 settings panel near the SHARP controls.
4. Keep advanced processing collapsed by default.

Suggested visible 360 controls:

- View count: default 4.
- Overlap alignment: default on.
- Output format: start with PLY; later add SPZ/SPX/SOG if we bundle or locate a converter.
- Device: default/CUDA/CPU, with CPU marked as slow fallback.
- Keep intermediate faces: default off.

Suggested advanced controls:

- Cut top/bottom poles.
- Face overlap percentage.
- InfiniDepth tiled depth reference.
- DA360 depth alignment fallback.
- Motion deblur strength.
- SeedVR2 face upscaling.
- ImageMagick blur-safe preprocessing.
- Custom intermediate workspace.

## Implementation notes

Do not blindly vendor the reference GUI. The useful part is the pipeline shape:

1. Validate a stitched 2:1 equirectangular input.
2. Slice the panorama into perspective faces with overlap.
3. Run SHARP prediction per face.
4. Align per-face splats, preferably by overlap first.
5. Merge to one 360 Gaussian splat.
6. Export PLY first, then optional compressed formats.

The first implementation keeps the panorama runtime isolated, similar to the Pixal3D isolation. InfiniDepth is also isolated because it has its own CUDA-heavy Python stack and checkpoints.

InfiniDepth path:

1. Split the stitched panorama into two horizontal tiles.
2. Run InfiniDepth on each tile.
3. Stitch the tile depth outputs back into one panorama-wide inverse-depth reference.
4. Feed that external reference into the SHARP_360 alignment path instead of running DA360.
5. Keep overlap alignment as the default lightweight path.

## Open questions

- Whether to adapt Enndee's pipeline code directly, shell out to it, or reimplement only the minimal slicing/alignment path around our existing SHARP runtime.
- Whether compressed exports require bundling gsbox.exe or asking the user to locate it.
- Whether CPU-only should be a separate setup profile for SHARP runtime, or a per-run device choice that reuses the current venv.
- How much of SeedVR2/DA360/ImageMagick belongs in v1 versus later advanced options.
