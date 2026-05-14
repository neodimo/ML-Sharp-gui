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

Pixal3D is CUDA-heavy and upstream's easiest path is Linux/Python 3.10 with downloaded wheels and Hugging Face models. Windows support is not clean upstream, but this branch now has a Windows-native experimental path so a WSL2 Ubuntu runtime is not the first thing to try.

The app installer does not include Pixal3D, its weights, or its dependencies. The experimental installer path clones `TencentARC/Pixal3D` and creates a separate `uv` venv.

Known risk points:

- dynamic Hugging Face / torch hub model downloads
- direct GitHub wheel URLs
- Linux/CUDA-specific wheels in `requirements-hfdemo.txt`
- Windows uses community CUDA wheels from `visualbruno/ComfyUI-Trellis2`, pinned to a specific commit and SHA-256 hashes
- Windows skips NATTEN because Pixal3D does not import it directly and official NATTEN `0.21.0` wheels are Linux-only
- Windows patches Pixal3D sparse attention to use PyTorch SDPA instead of `flash_attn`/`xformers`; this should be slower but avoids WSL2-only wheels
- Pixal3D's Hugging Face config currently asks for gated `briaai/RMBG-2.0`; the Windows experiment overrides the background-removal model to public `briaai/RMBG-1.4` by default. Set `PIXAL3D_REMBG_MODEL` before launching the app if you need a different compatible model.
- Pixal3D preloads NAF via `torch.hub` from `valeoai/NAF`; Windows installs `einops` explicitly because that torch hub repo imports it but Pixal3D's own requirements do not list it.
- NAF imports NATTEN for neighborhood attention; because official NATTEN wheels are Linux-only here, Windows patches the cached NAF torch-hub source to use a pure PyTorch local-attention fallback. This is expected to be slower.
- very new upstream repo, no release/security policy yet
- no Gradio `share=True` path is used by this integration

## Windows-native experiment

The Windows route is intentionally isolated and license-gated:

1. Create a separate Pixal3D `uv` venv under app user-data with Python 3.11.
2. Install PyTorch `2.7.0` / CUDA `12.8` wheels.
3. Install pinned community Windows wheels for the mesh/texturing CUDA extensions: `cumesh`, `flex_gemm`, `nvdiffrast`, `nvdiffrec_render`, and `o_voxel`.
4. Skip NATTEN on Windows. Upstream lists `natten==0.21.0`, but static inspection found no direct `import natten`/`from natten` in Pixal3D or MoGe. The actual attention paths use `flash_attn`, `xformers`, `sdpa`, or `naive` for dense attention, and sparse attention is patched to accept `sdpa`.
5. Run Pixal3D with `ATTN_BACKEND=sdpa`, `SPARSE_ATTN_BACKEND=sdpa`, patched NAF local attention, and `PIXAL3D_REMBG_MODEL=briaai/RMBG-1.4` unless overridden.

This is the best current bet for keeping the workflow inside the Windows application. It still needs a real RTX Windows smoke test because this Linux dev host cannot validate CUDA/Windows wheels.

Fallback if it fails: install Visual Studio 2022 C++ Build Tools + NVIDIA CUDA Toolkit and build the missing CUDA packages natively. WSL2/Linux remains the reliability fallback, not the preferred app path.

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
