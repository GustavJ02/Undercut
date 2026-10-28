"""The live debrief starts simulations as soon as a race starts: the many short races of the app tests do not need it, and the tests of it
ask for it by name (`create_app(live_debrief=True)` or `Room.live`)."""
import os

os.environ.setdefault("UNDERCUT_LIVE_DEBRIEF", "0")
