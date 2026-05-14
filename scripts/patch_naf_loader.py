#!/usr/bin/env python3
"""
Patch Pixal3D's _load_naf to bypass torch.hub.load and load NAF directly.
torch.hub.load checks hubconf dependencies (including 'natten') before running,
which fails on Windows where natten has no CUDA wheels.
Instead, we download the NAF checkpoint from GitHub releases directly and
load it using torch.load, bypassing hubconf entirely.
"""
import sys
import os
from pathlib import Path

def patch_load_naf(file_path: Path) -> bool:
    text = file_path.read_text(encoding="utf-8").replace("\r\n", "\n")

    old_load_naf = '''    def _load_naf(self):
        """Lazy-load pretrained NAF model."""
        if self.naf_model is None:
            import torch.hub
            device = next(self.model.parameters()).device
            self.naf_model = torch.hub.load(
                "valeoai/NAF", "naf", pretrained=True, device=device, trust_repo=True
            )
            self.naf_model.eval()
            self.naf_model.requires_grad_(False)'''

    new_load_naf = '''    def _load_naf(self):
        """Lazy-load pretrained NAF model without torch.hub dependency preflight.

        Downloads the NAF checkpoint from GitHub releases directly and loads it
        without using torch.hub.load, which requires 'natten' to be importable.
        """
        if self.naf_model is None:
            from pathlib import Path
            import os
            import torch

            device = next(self.model.parameters()).device
            naf_checkpoint_url = "https://github.com/valeoai/NAF/releases/download/model/naf_release.pth"
            naf_cache_dir = Path(os.path.expanduser("~/.cache/torch/hub/valeoai_NAF_main"))
            naf_cache_dir.mkdir(parents=True, exist_ok=True)
            local_ckpt = naf_cache_dir / "naf_release.pth"
            if not local_ckpt.exists():
                torch.hub.download_url_to_file(naf_checkpoint_url, str(local_ckpt), progress=True)
            from src.model.naf import NAF
            self.naf_model = NAF().to(device)
            self.naf_model.load_state_dict(torch.load(str(local_ckpt), map_location=device))
            self.naf_model.eval()
            self.naf_model.requires_grad_(False)'''

    if old_load_naf not in text:
        print(f"[patch_naf] _load_naf marker not found in {file_path}", file=sys.stderr)
        return False

    text = text.replace(old_load_naf, new_load_naf)
    file_path.write_text(text, encoding="utf-8")
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