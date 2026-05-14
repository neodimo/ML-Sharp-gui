#!/usr/bin/env python3
"""
Patch Pixal3D's _load_naf for the Windows experimental provider.

Upstream NAF depends on NATTEN. Official NATTEN wheels for the Pixal3D stack
are Linux-only, so Windows cannot reliably load valeoai/NAF through torch.hub.
This patch preserves the tensor shape contract by replacing NAF with a simple
interpolation module. It is lower quality than true NAF, but it keeps the GLB
path runnable inside the Windows app without WSL2.
"""
import re
import sys
from pathlib import Path


def patch_load_naf(file_path: Path) -> bool:
    text = file_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if "Windows interpolation fallback" in text:
        print(f"[patch_naf] Already patched: {file_path}")
        return True

    new_load_naf = '''    def _load_naf(self):
        """Lazy-load a Windows-safe NAF replacement.

        Upstream NAF depends on NATTEN. Official NATTEN wheels are Linux-only
        for the versions Pixal3D wants, and torch.hub refuses to load NAF when
        natten is absent. For the Windows experimental provider, preserve the
        tensor contract by using deterministic interpolation for the high-res
        feature branch. This is lower quality than true NAF, but keeps Pixal3D
        runnable inside the Windows app without WSL2.
        """
        if self.naf_model is None:
            import torch
            import torch.nn.functional as F
            device = next(self.model.parameters()).device

            class _WindowsInterpolationNAF(torch.nn.Module):
                def forward(self, image, lr_features, output_size):
                    return F.interpolate(
                        lr_features,
                        size=output_size,
                        mode="bilinear",
                        align_corners=False,
                    )

            print("[NAF] Using Windows interpolation fallback instead of NATTEN-backed NAF", flush=True)
            self.naf_model = _WindowsInterpolationNAF().to(device)
            self.naf_model.eval()
            self.naf_model.requires_grad_(False)
'''

    pattern = r"    def _load_naf\(self\):\n[\s\S]*?(?=\n    def to\(self, device\):)"
    patched, count = re.subn(pattern, new_load_naf, text, count=1)
    if count != 1:
        print(f"[patch_naf] _load_naf function boundary not found in {file_path}", file=sys.stderr)
        return False

    file_path.write_text(patched, encoding="utf-8")
    print(f"[patch_naf] Patched _load_naf in {file_path}")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: patch_naf_loader.py <path_to_image_conditioned_proj.py>", file=sys.stderr)
        sys.exit(1)

    file_path = Path(sys.argv[1])
    if not file_path.exists():
        print(f"[patch_naf] File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    ok = patch_load_naf(file_path)
    sys.exit(0 if ok else 1)
