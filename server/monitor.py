"""A terminal dashboard for a running Undercut server: games, clients, CPU, memory and network.

    python -m server.monitor            live view (q quits)
    python -m server.monitor --once     print one snapshot and exit

Run it inside the container (`./monitor.sh` does that). Game counts come from the file the server writes (`UNDERCUT_STATS`); CPU, memory
and processes come from the container's cgroup, so they are the numbers Docker limits, not the whole machine's.
"""
import argparse
import curses
import json
import os
import sys
import time
from collections import deque
from pathlib import Path

STATS = Path(os.environ.get("UNDERCUT_STATS", "/data/stats.json"))
STALE_S = 5.0
BARS = " ▁▂▃▄▅▆▇█"


def read(path, default=None):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def cpu_limit() -> float:
    """Cores the container may use: the cgroup limit, else every core."""
    raw = read("/sys/fs/cgroup/cpu.max")
    if raw:
        quota, period = raw.split()
        if quota != "max":
            return int(quota) / int(period)
    return float(os.cpu_count() or 1)


def cpu_usage_s() -> float | None:
    """CPU seconds the container has used so far."""
    raw = read("/sys/fs/cgroup/cpu.stat")
    if raw:
        for line in raw.splitlines():
            if line.startswith("usage_usec"):
                return int(line.split()[1]) / 1e6
    return None


def memory() -> tuple[int, int | None]:
    """(bytes in use without reclaimable cache, limit or None)."""
    cur, lim = read("/sys/fs/cgroup/memory.current"), read("/sys/fs/cgroup/memory.max")
    if cur is None:
        return 0, None
    used = int(cur)
    for line in (read("/sys/fs/cgroup/memory.stat") or "").splitlines():
        if line.startswith("inactive_file "):
            used -= int(line.split()[1])
    limit = None if lim in (None, "max") else int(lim)
    if limit is None:
        total = next((int(ln.split()[1]) * 1024 for ln in (read("/proc/meminfo") or "").splitlines() if ln.startswith("MemTotal")), None)
        limit = total
    return max(used, 0), limit


def processes() -> int:
    return int(read("/sys/fs/cgroup/pids.current", "0") or 0)


def net_bytes() -> tuple[int, int]:
    rx = tx = 0
    for line in (read("/proc/net/dev") or "").splitlines()[2:]:
        name, _, rest = line.partition(":")
        if name.strip() == "lo" or not rest:
            continue
        f = rest.split()
        rx, tx = rx + int(f[0]), tx + int(f[8])
    return rx, tx


def temperature() -> float | None:
    raw = read("/sys/class/thermal/thermal_zone0/temp")
    return int(raw) / 1000 if raw and raw.lstrip("-").isdigit() else None


def load_stats():
    raw = read(STATS)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def size(n) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def duration(s) -> str:
    s = int(s)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def spark(values, top) -> str:
    return "".join(BARS[min(int(max(v, 0) / top * 8), 8)] if top else " " for v in values)


class Sampler:
    """Turns the counters into rates, and keeps a short history for the sparklines."""

    def __init__(self):
        self.cores = cpu_limit()
        self.last = (time.monotonic(), cpu_usage_s(), net_bytes())
        self.cpu, self.rx, self.tx = 0.0, 0.0, 0.0                  # cores in use; bytes per second
        self.history = deque([0.0] * 60, maxlen=60)

    def sample(self):
        now, used, net = time.monotonic(), cpu_usage_s(), net_bytes()
        t0, used0, net0 = self.last
        dt = max(now - t0, 1e-6)
        if used is not None and used0 is not None:
            self.cpu = max(used - used0, 0.0) / dt
        self.rx, self.tx = max(net[0] - net0[0], 0) / dt, max(net[1] - net0[1], 0) / dt
        self.last = (now, used, net)
        self.history.append(self.cpu)


def lines(s: Sampler, stats, width=100) -> list[str]:
    out = []
    mem, mem_limit = memory()
    pct = s.cpu / s.cores * 100
    temp = temperature()
    out.append(f"UNDERCUT MONITOR   {time.strftime('%H:%M:%S')}")
    out.append("")
    out.append(f"CPU      {s.cpu:5.2f} of {s.cores:.1f} cores ({pct:3.0f} %)   {spark(s.history, s.cores)}")
    out.append(f"Memory   {size(mem)}" + (f" of {size(mem_limit)} ({mem / mem_limit * 100:.0f} %)" if mem_limit else ""))
    out.append(f"Network  in {size(s.rx)}/s   out {size(s.tx)}/s")
    out.append(f"Threads {processes()}" + (f"   Temperature {temp:.0f} °C" if temp is not None else "") + f"   Host load {os.getloadavg()[0]:.2f}")
    out.append("")
    if stats is None:
        out.append(f"No stats yet: waiting for {STATS} (is UNDERCUT_STATS set and the server running?)")
        return out
    age = time.time() - stats["time"]
    if age > STALE_S:
        out.append(f"The server has not reported for {age:.0f} s: it may be stopped or stuck.")
        return out
    rooms = stats["rooms"]
    solo, multi = [r for r in rooms if r["kind"] == "solo"], [r for r in rooms if r["kind"] == "multi"]
    live = lambda rs: sum(1 for r in rs if r["session"] not in ("GRID", "FINISHED"))
    out.append(f"Server up {duration(time.time() - stats['started'])}   Games {len(rooms)} of {stats['max_rooms']}   "
               f"Browsers connected {sum(r['clients'] for r in rooms)}   Debriefs running {sum(1 for r in rooms if r['debrief'] == 'running')} "
               f"(up to {stats['debrief_workers']} cores)")
    out.append(f"Singleplayer {len(solo)} ({live(solo)} racing)    Multiplayer {len(multi)} ({live(multi)} racing, "
               f"{sum(r['players_connected'] for r in multi)} players connected)")
    out.append("")
    out.append(f"{'CODE/ID':9}{'MODE':7}{'CIRCUIT':16}{'STATE':10}{'LAP':>8}{'SPEED':>6}{'BROWSERS':>9}{'PLAYERS':>8}{'AGE':>9}{'LOAD':>7}")
    for r in sorted(rooms, key=lambda r: -r["age_s"]):
        state = "paused" if r["paused"] and r["session"] == "RACING" else r["session"].lower()
        players = f"{r['players_connected']}/{r['players']}" if r["kind"] == "multi" else "-"
        cover = f" AI×{r['ai_cover']}" if r["ai_cover"] else ""
        out.append(f"{r['id'][:8]:9}{r['kind']:7}{r['circuit'][:15]:16}{state[:9]:10}{str(r['lap']) + '/' + str(r['laps']):>8}{str(r['speed']) + 'x':>6}"
                   f"{r['clients']:>9}{players:>8}{duration(r['age_s']):>9}{r['busy'] * 100:>6.1f}%{cover}")
    if not rooms:
        out.append("(no games)")
    return [ln[:width] for ln in out]


def run(screen, interval):
    curses.curs_set(0)
    screen.timeout(int(interval * 1000))
    s = Sampler()
    while True:
        s.sample()
        screen.erase()
        h, w = screen.getmaxyx()
        for i, line in enumerate(lines(s, load_stats(), w - 1)[:h - 1]):
            try:
                screen.addstr(i, 0, line, curses.A_BOLD if i == 0 else 0)
            except curses.error:
                pass
        try:
            screen.addstr(h - 1, 0, "q quits"[:w - 1], curses.A_DIM)
        except curses.error:
            pass
        screen.refresh()
        if screen.getch() in (ord("q"), ord("Q"), 27):
            return


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true", help="print one snapshot and exit")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between updates")
    a = ap.parse_args(argv)
    if a.once or not sys.stdout.isatty():
        s = Sampler()
        time.sleep(1.0)
        s.sample()
        print("\n".join(lines(s, load_stats())))
        return 0
    try:
        curses.wrapper(run, a.interval)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
