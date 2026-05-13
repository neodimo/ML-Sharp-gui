# Experimental Pixal3D Provider

Pixal3D is **not** part of the bundled/default ML-Sharp GUI runtime.

It is wired only as an explicit experimental provider for local research testing:

- License gate required in the UI before install/run.
- Runtime installs separately under the app user-data folder: `pixal3d-experimental/`.
- SHARP remains the bundled/default provider.
- Pixal3D output is `.glb`; SHARP output remains `.ply` Gaussian splat.
- Do not ship Pixal3D as a normal public app feature unless the license changes or explicit permission is granted.

## License blocker

Pixal3D's license is academic/research-only, forbids commercial/production use, and says it is not intended for use within the EU.

That means this branch is for testing only.

## Operational notes

Pixal3D is CUDA-heavy and upstream's easiest path is Linux/Python 3.10 with downloaded wheels and Hugging Face models. Windows support is not clean yet.

The app installer does not include Pixal3D, its weights, or its dependencies. The experimental installer path clones `TencentARC/Pixal3D` and creates a separate `uv` venv.

Known risk points:

- dynamic Hugging Face model downloads
- direct GitHub wheel URLs
- Linux/CUDA-specific wheels in `requirements-hfdemo.txt`
- very new upstream repo, no release/security policy yet
- no Gradio `share=True` path is used by this integration

## Test flow

1. Switch to branch `experimental/pixal3d-provider`.
2. Run the app with `npm start` or build a dev installer.
3. Choose input image and output folder.
4. Open **Experimental Pixal3D GLB provider**.
5. Check the license acceptance box.
6. Click **Install Pixal3D**.
7. Click **Run Pixal3D → GLB**.
8. Inspect the `.glb` in Blender, Windows 3D Viewer, or another GLB viewer.

If there is no visible CUDA GPU, inference is expected to fail or be unusably slow.
