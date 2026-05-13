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

## Packaging / updates

Starting with v0.4, the preferred Windows build is an installer build (`ML-Sharp-GUI-Setup-<version>.exe`) instead of a manually managed portable ZIP folder.

The app includes **Check updates** and **Restart to update** controls. Updates are downloaded through GitHub Releases and applied on restart by Electron's standard updater.

SHARP depends on Python, PyTorch, torchvision, gsplat, and a model checkpoint, so that heavy runtime is kept outside the app install in Electron's stable user-data folder:

```text
%APPDATA%/ML-Sharp GUI/sharp-runtime/
```

That keeps app updates from reinstalling the Python/PyTorch/model runtime every time.

## First run on Windows

1. Run `ML-Sharp-GUI-Setup-<version>.exe`.
2. Launch **ML-Sharp GUI** from the installer shortcut.
3. Click **Install/check runtime** or just **Run SHARP**.
4. The first runtime install may take a while and needs internet; PyTorch and the SHARP model are large.
5. Choose an input frame and output folder, then run.

Apple SHARP source is bundled under the app's `resources/ml-sharp` folder. The Python environment installs into the user-data `sharp-runtime/venv` folder.

## Notes

- SHARP can run prediction on CPU, CUDA, or MPS, but Windows will usually be CPU or CUDA.
- Rendering preview trajectories from Apple SHARP requires CUDA; this wrapper only runs prediction/export for now.
- The built-in `.ply` viewer is a lightweight point-cloud preview, not a full Gaussian splat renderer yet.
- The output `.ply` is Apple SHARP's own 3DGS PLY, not the fallback textured-card approximation.
- GitHub auto-updates require the published update assets (`latest.yml`, installer, blockmap) to be reachable by the installed app. Do not embed a private GitHub token in the app.
