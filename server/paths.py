"""Where things live, in development and in the packaged app.

In development the repository is the root and races are logged to `logs/` beside it. In the packaged app (PyInstaller) the
read-only resources (parameter bundle, schema, built client) sit in the bundle's temporary folder and everything the player
creates goes to a per-user data folder, so the executable can be deleted and replaced without losing race logs.
"""
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    """Folder holding `params/` and `client/dist`: the repository, or the unpacked bundle of a frozen app."""
    return Path(getattr(sys, "_MEIPASS", REPO)) if frozen() else REPO


def data_dir() -> Path:
    """Per-user folder for race logs and debriefs of the packaged app (override with UNDERCUT_DATA)."""
    if os.environ.get("UNDERCUT_DATA"):
        return Path(os.environ["UNDERCUT_DATA"])
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Undercut"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Undercut"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "undercut"


def default_log_dir() -> Path:
    return data_dir() / "logs" if frozen() or os.environ.get("UNDERCUT_DATA") else REPO / "logs"


def default_bundle() -> Path:
    return resource_root() / "params" / "bundles" / "1.0.0.json"
