#!/usr/bin/env python3
from pathlib import Path
import subprocess, sys
root = Path(__file__).resolve().parents[1]
raise SystemExit(subprocess.call([sys.executable, str(root / "run_tests.py"), "--only", "dom_video"], cwd=root.parent))
