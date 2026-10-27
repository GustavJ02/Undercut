#!/usr/bin/env bash
# Build the offline desktop app: the web client, then one executable with everything inside (dist/undercut).
# Usage: packaging/build.sh        (run from anywhere; needs node/npm and the repository's venv)
set -euo pipefail
cd "$(dirname "$0")/.."
# PyInstaller bundles Python itself and needs its shared library, which some distributions ship as a separate package.
venv/bin/python - <<'PY' || { echo "libpython shared library not found. On Debian/Ubuntu: sudo apt install libpython3.13"; exit 1; }
import ctypes.util, os, sys, sysconfig
name = sysconfig.get_config_var("LDLIBRARY") or ""
libdir = sysconfig.get_config_var("LIBDIR") or ""
ok = os.path.exists(os.path.join(libdir, name + ".1.0")) or os.path.exists(os.path.join(libdir, name)) or ctypes.util.find_library("python%d.%d" % sys.version_info[:2])
sys.exit(0 if ok else 1)
PY
(cd client && npm install --no-audit --no-fund && npm run build)
venv/bin/pip install -q -r requirements.txt pyinstaller
venv/bin/pyinstaller --noconfirm --clean --distpath packaging/dist --workpath packaging/build packaging/undercut.spec
echo "built: packaging/dist/undercut"
