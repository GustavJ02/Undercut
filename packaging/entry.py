"""Entry point of the packaged app (PyInstaller). Worker processes of the debrief re-run this file, hence freeze_support."""
import multiprocessing

from server.launcher import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
