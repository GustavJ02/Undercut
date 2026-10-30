"""Debrief branches on a remote worker (Google Cloud Run) instead of the local process pool.

The debrief sends every branch of the race to an executor as `executor.submit(simulate_batch, task)` and reads `.result()`. `RemoteExecutor`
has the same two calls but posts the task to `worker/app.py`, so the server needs no other change: it uses one when `UNDERCUT_WORKER_URL`
is set (see `executor_from_env`) and the local pool otherwise.

A task is pickled, and a worker that unpickles what it is sent runs whatever it is sent. So the body is signed with a shared secret
(HMAC-SHA256, `UNDERCUT_WORKER_SECRET` on both sides) and the worker looks at nothing before the signature has checked out. The worker also
refuses a task from a server whose engine code differs from its own (`code_version`): a pickled race only means the same thing to the code
that made it. A failed branch is an error, never a quiet local re-run: the branches of one decision must all be played on the same machine.
"""
import hashlib
import hmac
import http.client
import json
import os
import pickle
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import numpy

from scoring.debrief import DebriefError, simulate_batch

SIGNATURE_HEADER = "X-Undercut-Signature"
CODE_HEADER = "X-Undercut-Code"
RETRY_STATUSES = {429, 500, 502, 503, 504}        # Cloud Run answers 429 or 503 while it has no instance to spare, and 5xx when one was lost
MIN_SECRET_LENGTH = 16


@lru_cache(maxsize=1)
def code_version() -> str:
    """A fingerprint of everything a pickled race depends on: the engine and debrief sources, the one server module the engine imports,
    the Python version and numpy. The server and the worker must agree on it."""
    root = Path(__file__).resolve().parent.parent
    files = sorted([*root.glob("engine/**/*.py"), *root.glob("scoring/**/*.py"), root / "server" / "visibility.py"])
    h = hashlib.sha256(f"python{sys.version_info.major}.{sys.version_info.minor} numpy{numpy.__version__}".encode())
    for path in files:
        h.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    return h.hexdigest()[:16]


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def check_signature(secret: str, body: bytes, signature: str | None) -> bool:
    return bool(signature) and hmac.compare_digest(sign(secret, body), signature)


def _plain(value):
    """JSON for a result: numpy numbers become the Python number they hold."""
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"cannot encode {type(value).__name__}")


def encode_results(results) -> bytes:
    return json.dumps(results, default=_plain).encode()


def decode_results(data: bytes):
    """What `simulate_batch` returns: (points, mean position, each car's position, each car's points) per future."""
    return [(points, mean, tuple(places), tuple(car_points)) for points, mean, places, car_points in json.loads(data)]


class RemoteExecutor:
    """`submit(simulate_batch, task)` runs the task on the worker and returns a `concurrent.futures.Future`.

    `concurrency` requests are in flight at most; the rest wait their turn here, so it should match what the service can take
    (its maximum instances times its concurrency per instance). A request that fails for a reason that may pass (no instance free, a lost
    connection, a timeout) is sent again after a pause, `attempts` times in all; any other answer is final and becomes a `DebriefError`."""

    def __init__(self, url, secret, concurrency=16, timeout_s=120.0, attempts=4, backoff_s=0.5):
        parts = urlsplit(url.strip().rstrip("/"))
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError(f"the worker address {url!r} must start with https:// (or http:// for a worker on this network)")
        if len(secret) < MIN_SECRET_LENGTH:
            raise ValueError(f"the worker secret must be at least {MIN_SECRET_LENGTH} characters")
        self.scheme, self.host, self.port, self.path = parts.scheme, parts.hostname, parts.port, parts.path
        self.secret, self.timeout_s, self.attempts, self.backoff_s = secret, timeout_s, max(1, attempts), backoff_s
        self.concurrency = concurrency
        self._pool = ThreadPoolExecutor(max_workers=max(1, concurrency), thread_name_prefix="debrief-remote")
        self._local = threading.local()

    def submit(self, fn, *args):
        if fn is not simulate_batch or len(args) != 1:
            raise ValueError("a remote worker only runs simulate_batch(task)")
        return self._pool.submit(self._run, args[0])

    def shutdown(self, wait=True, cancel_futures=False):
        self._pool.shutdown(wait=wait, cancel_futures=cancel_futures)

    # -- one task ------------------------------------------------------------------------------------------------------------
    def _run(self, task):
        body = pickle.dumps(task, protocol=pickle.HIGHEST_PROTOCOL)
        headers = {"Content-Type": "application/octet-stream", SIGNATURE_HEADER: sign(self.secret, body), CODE_HEADER: code_version()}
        problem = "no answer"
        for attempt in range(self.attempts):
            if attempt:
                time.sleep(self.backoff_s * 2 ** (attempt - 1) * (0.5 + random.random()))
            try:
                status, data = self._post(body, headers)
            except (OSError, http.client.HTTPException) as e:
                problem = f"{type(e).__name__}: {e}"
                continue
            if status == 200:
                return decode_results(data)
            problem = f"HTTP {status}: {data[:200].decode(errors='replace')}"
            if status not in RETRY_STATUSES:
                break
        raise DebriefError(f"the debrief worker at {self.host} failed ({problem})")

    def _connection(self):
        conn = getattr(self._local, "conn", None)
        if conn is None:
            cls = http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection
            conn = self._local.conn = cls(self.host, self.port, timeout=self.timeout_s)
        return conn

    def _drop(self):
        conn, self._local.conn = getattr(self._local, "conn", None), None
        if conn is not None:
            conn.close()

    def _post(self, body, headers):
        """One request on this thread's connection, which is kept for the next. A connection the service closed while it sat idle is
        replaced once without counting as a failed attempt."""
        for fresh in (False, True):
            reused = getattr(self._local, "conn", None) is not None
            try:
                conn = self._connection()
                conn.request("POST", f"{self.path}/batch", body, headers)
                response = conn.getresponse()
                data = response.read()
            except (OSError, http.client.HTTPException):
                self._drop()
                if reused and not fresh:
                    continue
                raise
            if response.will_close:
                self._drop()
            return response.status, data


def executor_from_env(env=None):
    """A `RemoteExecutor` when `UNDERCUT_WORKER_URL` is set, else None (the debrief then runs on this machine)."""
    env = os.environ if env is None else env
    url = env.get("UNDERCUT_WORKER_URL", "").strip()
    if not url:
        return None
    secret = env.get("UNDERCUT_WORKER_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise SystemExit(f"UNDERCUT_WORKER_URL is set, so UNDERCUT_WORKER_SECRET must be too (at least {MIN_SECRET_LENGTH} characters, "
                         "the same value as on the worker)")
    try:
        return RemoteExecutor(url, secret, int(env.get("UNDERCUT_WORKER_CONCURRENCY", 16)), float(env.get("UNDERCUT_WORKER_TIMEOUT_S", 120)))
    except ValueError as e:
        raise SystemExit(f"UNDERCUT_WORKER_URL: {e}") from e
