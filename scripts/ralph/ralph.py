"""入口：复用完整 Ralph runner，兼容原有 scripts/ralph 命令。"""

import runpy
import sys
from pathlib import Path


TARGET_DIR = Path(__file__).resolve().parents[2] / "scripts copy" / "ralph"
TARGET = TARGET_DIR / "ralph.py"
sys.path.insert(0, str(TARGET_DIR))
runpy.run_path(str(TARGET), run_name="__main__")
