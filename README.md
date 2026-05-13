# SharpSplat SHARP Wrapper

Windows GUI wrapper for Apple `ml-sharp`: one frame in, standard 3D Gaussian Splat `.ply` out.

## What this does

- GUI input picker for `.exr`, `.png`, `.jpg`, `.jpeg`
- Output folder picker
- Fixed-size input preview
- EXR path: converts ACEScg/linear EXR to tone-mapped sRGB PNG for SHARP inference while preserving the original EXR
- Runs Apple SHARP via `sharp predict -i <input> -o <folder>`
- Streams the runtime log into its own scrollable pane
- Shows a coarse progress bar for install/conversion/inference activity
- Opens/shows the output `.ply`
- Loads the generated `.ply` into a built-in point-cloud preview with drag-rotate and wheel-zoom controls

## Why portable folder, not a single-file exe?

SHARP depends on Python, PyTorch, torchvision, gsplat, and a model checkpoint. A true single EXE is brittle and huge. For tonight, the reliable build is a portable Windows folder with `SharpSplatSHARP.exe`; on first run it installs the Python runtime into `sharp-runtime/` next to the EXE.

## First run on Windows

1. Unzip the build.
2. Run `SharpSplatSHARP.exe`.
3. Click **Install/check runtime** or just **Run SHARP**.
4. The first runtime install may take a while and needs internet; PyTorch and the SHARP model are large.
5. Choose an input frame and output folder, then run.

Apple SHARP source is bundled under the app's `resources/ml-sharp` folder. The Python environment installs into `sharp-runtime/venv` next to the EXE.

## Notes

- SHARP can run prediction on CPU, CUDA, or MPS, but Windows will usually be CPU or CUDA.
- Rendering preview trajectories from Apple SHARP requires CUDA; this wrapper only runs prediction/export for now.
- The built-in `.ply` viewer is a lightweight point-cloud preview, not a full Gaussian splat renderer yet.
- The output `.ply` is Apple SHARP's own 3DGS PLY, not the fallback textured-card approximation.
