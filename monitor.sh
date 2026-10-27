#!/bin/sh
# Terminal dashboard for the Undercut container: games, browsers, CPU, memory, network. q quits.
cd "$(dirname "$0")" && exec docker compose exec undercut python -m server.monitor "$@"
