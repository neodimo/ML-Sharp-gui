# Sharp-Splat-Sharp Wrapper — PySide6 GUI Blueprint

**Target:** Windows portable GUI around `apple/ml-sharp` (PyTorch GS splatting → rasterized novel-view inference).  
**Goal:** Input picker (EXR/PNG/JPG) → output folder picker → worker-thread `sharp predict` → live log/status → input preview → EXR ACEScg→sRGB/PNG conversion → open output folder → PyInstaller portable build.

---

## 1. File Layout

```
sharp-splat-sharp-wrapper/
├── src/
│   ├── __init__.py
│   ├── main.py                  # QApplication entry point, window setup
│   ├── main_window.py           # QMainWindow subclass, full UI layout
│   ├── worker.py                # QThread subclass — sharp predict execution
│   ├── converter.py             # EXR ACEScg→sRGB / format-conversion helpers
│   └── styles.py                # Dark theme QSS string
├── assets/
│   └── icon.ico
├── requirements.txt
├── build.spec                   # PyInstaller spec (onedir + console-less)
├── run.py                       # Launcher (sets DLL search path for CUDA/cuDNN)
├── README.md
└── docs/
    └── BUILD.md                 # Portable Python + PyInstaller instructions
```

---

## 2. `src/worker.py` — Predict Thread

```python
import subprocess, sys, os
from PySide6.QtCore import QThread, Signal

class SharpPredictWorker(QThread):
    log = Signal(str)
    progress = Signal(int)      # 0–100
    finished = Signal(bool, str) # success, output_path_or_error

    def __init__(self, input_path, output_dir, parent=None):
        super().__init__(parent)
        self.input_path = input_path
        self.output_dir = output_dir

    def run(self):
        out_name = os.path.splitext(os.path.basename(self.input_path))[0] + "_sharp.png"
        out_path = os.path.join(self.output_dir, out_name)
        cmd = [
            sys.executable, "-m", "sharp", "predict",
            "--input", self.input_path,
            "--output", out_path,
        ]
        self.log.emit(f"> {' '.join(cmd)}")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, errors="replace")
            for line in proc.stdout:
                self.log.emit(line.rstrip())
                # Parse progress lines (example; adapt to actual sharp output)
                if "%" in line:
                    try:
                        pct = int(line.strip().split("%")[0].split()[-1])
                        self.progress.emit(pct)
                    except ValueError:
                        pass
            proc.wait()
            success = proc.returncode == 0
            self.finished.emit(success, out_path if success else "Prediction failed")
        except FileNotFoundError:
            self.finished.emit(False, f"sharp not found — run: pip install ml-sharp")
```

---

## 3. `src/converter.py` — EXR ACEScg → sRGB + PNG Save

```python
"""
Requires: OpenEXR (Python), imageio, numpy.
On Windows portable:  pip install OpenEXR-imageio numpy
"""
import os, numpy as np

def convert_exr_acescg_to_srgb_png(exr_path: str, out_png_path: str):
    """
    Reads an EXR with ACEScg (AP1) primaries + linear tone,
    converts to scene-referred sRGB, writes PNG.
    Falls back to naive linear conversion if OpenEXR is unavailable.
    """
    try:
        import OpenEXR, Imath
        import numpy as np

        pt = OpenEXR.InputFile(exr_path)
        dw = pt.header()["dataWindow"]
        w, h = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1

        channels = pt.channels(["R", "G", "B"], Imath.PixelType.FLOAT)
        R = np.frombuffer(channels[0], dtype=np.float32).reshape(h, w)
        G = np.frombuffer(channels[1], dtype=np.float32).reshape(h, w)
        B = np.frombuffer(channels[2], dtype=np.float32).reshape(h, w)
        img = np.stack([R, G, B], axis=-1)

        # ACEScg → sRGB (IDT + RRT)
        # AP1 primaries: (0.713, 0.293), (0.293, 0.765), (0.143, 0.110)
        AP1_TO_XYZ = np.array([
            [ 0.662454, 0.134004, 0.156187],
            [ 0.272228, 0.674082, 0.053689],
            [-0.005574, 0.004060, 1.010339],
        ])
        D65_XYZ_TO_SRGB = np.array([
            [ 3.2404542, -1.5371385, -0.4985314],
            [-0.9692660,  1.8760108,  0.0415560],
            [ 0.0556434, -0.2040259,  1.0572252],
        ])
        M = D65_XYZ_TO_SRGB @ AP1_TO_XYZ
        rgb = img.reshape(-1, 3) @ M.T
        # Apply sRGB OETF (linear → gamma)
        c = np.clip(rgb, 0, None)
        srgb = np.where(c > 0.0031308, 1.055 * c**(1/2.4) - 0.055, 12.92 * c)
        srgb = srgb.reshape(h, w, 3)
        srgb = np.clip(srgb, 0, 1)
        import imageio
        imageio.imwrite(out_png_path, (srgb * 65535).astype(np.uint16))
    except ImportError:
        # Fallback: imageio v3 EXR read (expects sRGB EXR)
        import imageio.v3 as iio
        img = iio.imread(exr_path)
        img = np.power(np.clip(img, 0, None), 1/2.2)
        import imageio
        imageio.imwrite(out_png_path, (img * 255).astype(np.uint8))
```

---

## 4. `src/main_window.py` — Full UI (PySide6)

```python
import os, subprocess
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QLineEdit, QFileDialog, QTextEdit, QProgressBar, QGroupBox,
    QMessageBox, QCheckBox,
)
from PySide6.QtCore import Qt, QThread
from PySide6.QtGui import QPixmap, QImage

from .worker import SharpPredictWorker
from .styles import DARK_STYLE

class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Sharp Splat → PNG")
        self.setMinimumSize(900, 700)
        self.setStyleSheet(DARK_STYLE)
        self.worker = None
        self._setup_ui()

    def _setup_ui(self):
        # --- Input group ---
        input_grp = QGroupBox("Input")
        input_layout = QHBoxLayout()
        self.input_edit = QLineEdit()
        self.input_edit.setPlaceholderText("Select EXR / PNG / JPG …")
        self.btn_input = QPushButton("Browse…")
        self.btn_input.clicked.connect(self._pick_input)
        self.chk_preview = QCheckBox("Preview input")
        self.chk_preview.setChecked(True)
        input_layout.addWidget(QLabel("File:"))
        input_layout.addWidget(self.input_edit, 1)
        input_layout.addWidget(self.btn_input)
        input_layout.addWidget(self.chk_preview)
        input_grp.setLayout(input_layout)

        # --- Preview ---
        self.preview_label = QLabel("<i>No input</i>")
        self.preview_label.setAlignment(Qt.AlignCenter)
        self.preview_label.setMinimumHeight(300)
        self.preview_label.setStyleSheet("border: 1px solid #444; background:#1e1e1e;")

        # --- Output group ---
        out_grp = QGroupBox("Output")
        out_layout = QHBoxLayout()
        self.out_edit = QLineEdit()
        self.btn_out = QPushButton("Browse…")
        self.btn_out.clicked.connect(self._pick_output)
        out_layout.addWidget(QLabel("Folder:"))
        out_layout.addWidget(self.out_edit, 1)
        out_layout.addWidget(self.btn_out)
        out_grp.setLayout(out_layout)

        # --- Controls ---
        self.btn_run = QPushButton("▶  Run sharp predict")
        self.btn_run.setEnabled(False)
        self.btn_run.clicked.connect(self._run)
        self.btn_open = QPushButton("📂  Open output folder")
        self.btn_open.setEnabled(False)

        # --- Status ---
        self.log = QTextEdit(readOnly=True)
        self.log.setMaximumHeight(180)
        self.progress = QProgressBar()

        # --- Layout ---
        lay = QVBoxLayout(self)
        lay.addWidget(input_grp)
        lay.addWidget(self.preview_label, 1)
        lay.addWidget(out_grp)
        lay.addWidget(self.btn_run)
        lay.addWidget(self.progress)
        lay.addWidget(self.log)
        lay.addWidget(self.btn_open)
        self.btn_open.clicked.connect(self._open_output_folder)

    # ── file pickers ──────────────────────────────────────────────────

    def _pick_input(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Select input", "",
            "Images (*.exr *.EXR *.png *.PNG *.jpg *.JPG);;All files (*)")
        if path:
            self.input_edit.setText(path)
            self._update_preview(path)
            self.btn_run.setEnabled(bool(self.out_edit.text()))

    def _pick_output(self):
        path = QFileDialog.getExistingDirectory(self, "Select output folder", "")
        if path:
            self.out_edit.setText(path)
            self.btn_run.setEnabled(bool(self.input_edit.text()))

    def _update_preview(self, path):
        if not self.chk_preview.isChecked():
            self.preview_label.setText("<i>Preview disabled</i>")
            return
        ext = os.path.splitext(path)[1].lower()
        if ext == ".exr":
            # Generate 256-wide thumbnail via converter
            import tempfile, numpy as np
            try:
                from .converter import convert_exr_acescg_to_srgb_png
                tmp = tempfile.NamedTemporaryFile(suffix="_thumb.png", delete=False)
                convert_exr_acescg_to_srgb_png(path, tmp.name)
                pix = QPixmap(tmp.name).scaledToWidth(512, Qt.SmoothTransformation)
                self.preview_label.setPixmap(pix)
                os.unlink(tmp.name)
            except Exception as e:
                self.preview_label.setText(f"<i>Preview error: {e}</i>")
        else:
            pix = QPixmap(path).scaledToWidth(512, Qt.SmoothTransformation)
            self.preview_label.setPixmap(pix)

    # ── run ───────────────────────────────────────────────────────────

    def _run(self):
        inp = self.input_edit.text()
        out_dir = self.out_edit.text()
        self.log.clear()
        self.progress.setValue(0)
        self.btn_run.setEnabled(False)
        self._log(f"Starting sharp predict …")

        self.worker = SharpPredictWorker(inp, out_dir)
        self.worker.log.connect(self._log)
        self.worker.progress.connect(self.progress.setValue)
        self.worker.finished.connect(self._on_finished)
        self.worker.start()

    def _on_finished(self, success, path_or_err):
        self.btn_run.setEnabled(True)
        self.progress.setValue(100 if success else 0)
        if success:
            self._log(f"✓ Done → {path_or_err}")
            # Auto-convert EXR → sRGB PNG if needed
            ext = os.path.splitext(self.input_edit.text())[1].lower()
            if ext == ".exr":
                try:
                    from .converter import convert_exr_acescg_to_srgb_png
                    base = os.path.splitext(os.path.basename(path_or_err))[0]
                    png_out = os.path.join(self.out_edit.text(), base + "_sRGB.png")
                    self._log(f"Converting EXR → sRGB PNG …")
                    convert_exr_acescg_to_srgb_png(self.input_edit.text(), png_out)
                    self._log(f"✓ sRGB PNG → {png_out}")
                    path_or_err = png_out
                except Exception as e:
                    self._log(f"⚠ Conversion error: {e}")
            self.btn_open.setEnabled(True)
        else:
            self._log(f"✗ {path_or_err}")

    def _open_output_folder(self):
        path = self.out_edit.text()
        if path:
            subprocess.Popen(["explorer", path])

    def _log(self, msg):
        self.log.append(msg)
```

---

## 5. `src/styles.py` — Dark Theme

```python
DARK_STYLE = """
QWidget { background:#1e1e1e; color:#d0d0d0; font-family:Segoe UI, sans-serif; font-size:10pt; }
QGroupBox { border:1px solid #444; border-radius:4px; margin-top:6px; padding-top:6px; }
QGroupBox::title { subcontrol-origin:margin; left:8px; padding:0 4px; color:#aaa; }
QLineEdit { border:1px solid #333; border-radius:3px; padding:4px; background:#2a2a2a; }
QPushButton { background:#0d7acc; color:#fff; border:none; border-radius:4px; padding:6px 16px; }
QPushButton:hover { background:#1990d8; }
QPushButton:disabled { background:#444; color:#777; }
QTextEdit { background:#111; color:#bbf; border:1px solid #333; font-family:Consolas, monospace; }
QProgressBar { border:1px solid #333; border-radius:3px; text-align:center; background:#111; }
QProgressBar::chunk { background:#0d7acc; }
"""
```

---

## 6. `run.py` — DLL Search Path Helper (Windows portable)

```python
"""
Launcher for portable builds. Adds CUDA/cuDNN DLL search paths
before the PySide6 app starts, so subprocess calls in worker.py
find the right libraries without PATH pollution.
"""
import os, sys, subprocess

base = os.path.dirname(os.path.abspath(__file__))
cuda_bins = [
    os.path.join(base, "Lib", "site-packages", "nvidia", "cuda_runtime", "lib"),
    os.path.join(base, "Lib", "site-packages", "nvidia", "cudnn", "lib"),
]
for p in cuda_bins:
    if os.path.exists(p):
        os.add_dll_directory(p)

sys.exit(subprocess.run([sys.executable, "src/main.py"] + sys.argv[1:]).returncode)
```

---

## 7. `src/main.py` — Entry Point

```python
import sys
from PySide6.QtWidgets import QApplication
from .main_window import MainWindow

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Sharp Splat → PNG")
    w = MainWindow()
    w.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
```

---

## 8. `build.spec` — PyInstaller

```python
# build.spec
import sys
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

datas = [
    ("./src", "src"),
    ("./assets", "assets"),
]
hiddenimports = [
    "torch", "numpy", "imageio", "OpenEXR", "Imath",
]
a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="SharpSplat", icon="assets/icon.ico")
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="SharpSplat", strip=False)
```

---

## 9. Portable Build Walkthrough (`docs/BUILD.md`)

```
# Portable Python env
> python -m venv .venv
> .venv\Scripts\activate
> pip install torch --index-url https://download.pytorch.org/whl/cu118
> pip install ml-sharp OpenEXR-imageio imageio numpy PySide6 pyinstaller

# Local dev
> python run.py

# Build
> pyinstaller build.spec
# Output: dist/SharpSplat/SharpSplat.exe  (+ Lib/ + src/)

# Package as .zip
> powershell Compress-Archive -Path dist\SharpSplat -DestinationPath SharpSplat-portable.zip
```

**Key notes:**
- `sharp predict` must be in `PATH` or discoverable via `sys.executable -m sharp` — add a startup check and friendly error if missing.
- Keep subprocess calls inside the worker thread; never block the GUI thread.
- EXR preview thumbnail is generated on-the-fly from the converter — avoid caching for simplicity.
- Explorer open via `subprocess.Popen(["explorer", path])` works on all Windows versions.