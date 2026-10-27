"""Start the game on this machine: the server on localhost, and your browser pointed at it.

    python -m server.launcher [--port 8000] [--no-browser] [--lan]

This is what the packaged app runs. By default it only listens on 127.0.0.1, so nothing on the network can reach it. With
`--lan` it listens on every network interface so friends can open the printed address and join a multiplayer game with its
code; there are no accounts, so keep that to a network you trust (or a firewall that lets only your friends in). If a game
server is already running on the port it just opens the browser on that one instead of starting a second.
"""
import argparse
import json
import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn

HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def lan_address() -> str | None:
    """This machine's address on the local network, or None when it has none."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))                 # no packet is sent: it only picks the outgoing interface
            return s.getsockname()[0]
    except OSError:
        return None


def running_here(port: int) -> bool:
    """Is an Undercut server already answering on this port?"""
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/options", timeout=1.5) as r:
            return "bundle_version" in json.loads(r.read())
    except (OSError, ValueError):
        return False


def free_port(preferred: int) -> int:
    """The preferred port if nothing is using it, else any free one."""
    for candidate in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind((HOST, candidate))
            except OSError:
                continue
            return s.getsockname()[1]
    raise OSError("no free port on 127.0.0.1")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--lan", action="store_true", help="listen on the local network so friends can join with an address and a game code")
    ap.add_argument("--no-browser", action="store_true", help="start the server without opening a browser (used by tests)")
    a = ap.parse_args(argv)
    if running_here(a.port):
        print(f"Undercut is already running on http://{HOST}:{a.port}")
        if not a.no_browser:
            webbrowser.open(f"http://{HOST}:{a.port}")
        return 0
    port = free_port(a.port)
    from server.app import (
        app,  # imported late: it loads the parameter bundle, and a failure should say so clearly
    )
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0" if a.lan else HOST, port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    else:
        print("the server did not start")
        return 1
    url = f"http://{HOST}:{port}"
    print(f"Undercut is running on {url}  (Ctrl+C to stop)")
    if a.lan:
        ip = lan_address()
        print(f"Friends on your network open http://{ip or 'THIS-MACHINES-ADDRESS'}:{port} and use Join game with your code")
    if not a.no_browser:
        webbrowser.open(url)
    try:
        while thread.is_alive():
            thread.join(0.5)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
