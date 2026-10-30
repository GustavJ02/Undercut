"""A debrief played on a remote worker is the debrief played here: the same numbers, from a worker that is a separate process (with its
own hash seed, as each Cloud Run instance has) and that refuses anything it cannot trust."""
import http.client
import json
import os
import pickle
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from scoring import remote
from scoring.debrief import DebriefError, evaluate, run_debrief_all, simulate_batch
from scoring.live import LiveDebrief
from scoring.remote import RemoteExecutor, check_signature, code_version, executor_from_env, sign
from server.room import Room
from tests.helpers import make_bundle
from tests.test_debrief import arms_for, sc_world

SECRET = "test-secret-0123456789"
CARS = ["T0A", "T0B"]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def worker_url():
    port = free_port()
    env = {**os.environ, "UNDERCUT_WORKER_SECRET": SECRET, "PYTHONHASHSEED": "4242"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "worker.app:create_app_from_env", "--factory", "--port", str(port), "--log-level", "warning"],
                            env=env)
    try:
        for _ in range(100):
            try:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
                conn.request("GET", "/healthz")
                if conn.getresponse().status == 200:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("the worker did not start")
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()
        proc.wait(10)


@pytest.fixture
def executor(worker_url):
    ex = RemoteExecutor(worker_url, SECRET, concurrency=3, timeout_s=60, backoff_s=0.01)
    yield ex
    ex.shutdown()


def post(url, body, headers):
    conn = http.client.HTTPConnection(url.removeprefix("http://"), timeout=30)
    conn.request("POST", "/batch", body, headers)
    r = conn.getresponse()
    return r.status, r.read()


def test_the_remote_worker_gives_exactly_the_numbers_of_a_local_run(executor):
    r = sc_world(0.05, 0.45, 12, 3)
    local = evaluate(arms_for(r), 6, 4, CARS)
    assert evaluate(arms_for(r), 6, 4, CARS, executor=executor) == local


def test_identical_alternatives_still_differ_by_exactly_zero_on_a_worker_with_another_hash_seed(executor):
    blob = pickle.dumps(sc_world(0.05, 0.45, 12, 3).copy())
    res = evaluate({"a": (blob, []), "b": (blob, [])}, 6, 4, CARS, executor=executor)
    assert res["b"]["delta_points"] == 0 and res["b"]["delta_position"] == 0


def test_a_whole_debrief_on_the_worker_equals_the_local_debrief(executor):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 10
    room = Room("s1", b, {"seed": 4, "circuit": "Test"}, human_team="T0")
    room.live = LiveDebrief(b, executor, 3)
    room.handle("T0", {"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "SOFT"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.handle("T0", {"type": "control", "op": "start"})
    room.advance(15.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    while room.race.session != "FINISHED":
        room.advance(1.0)

    def same(a, c):
        return json.dumps(a, sort_keys=True, default=float) == json.dumps(c, sort_keys=True, default=float)
    live = room.live.reports()
    assert len(live["T0"]["decisions"]) >= 3
    assert same(live, run_debrief_all(b, room.log, 3)) and same(live, run_debrief_all(b, room.log, 3, pool=executor))


def test_the_worker_refuses_a_body_that_is_not_signed_with_its_secret_and_never_unpickles_it(worker_url):
    marker = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"undercut-pwned-{os.getpid()}")

    class Evil:
        def __reduce__(self):
            return (os.system, (f"touch {marker}",))
    body = pickle.dumps(Evil())
    for headers in ({}, {remote.SIGNATURE_HEADER: sign("another-secret-0123456789", body), remote.CODE_HEADER: code_version()}):
        status, _ = post(worker_url, body, headers)
        assert status == 401
    assert not os.path.exists(marker)


def test_a_signed_body_that_is_not_a_task_is_a_bad_request_and_other_engine_code_a_conflict(worker_url):
    ok = {remote.SIGNATURE_HEADER: None, remote.CODE_HEADER: code_version()}
    body = pickle.dumps("not a task")
    assert post(worker_url, body, {**ok, remote.SIGNATURE_HEADER: sign(SECRET, body)})[0] == 400
    status, data = post(worker_url, body, {remote.SIGNATURE_HEADER: sign(SECRET, body), remote.CODE_HEADER: "0" * 16})
    assert status == 409 and b"same commit" in data


def test_a_wrong_secret_and_other_engine_code_become_a_debrief_error_without_retries(worker_url, monkeypatch):
    task = (pickle.dumps(sc_world(0.05, 0.45, 12, 3).copy()), [], (1,), ("T0A",), False)
    bad = RemoteExecutor(worker_url, "another-secret-0123456789", backoff_s=0.01)
    with pytest.raises(DebriefError, match="signature"):
        bad.submit(simulate_batch, task).result()
    bad.shutdown()
    monkeypatch.setattr(remote, "code_version", lambda: "f" * 16)
    skewed = RemoteExecutor(worker_url, SECRET, backoff_s=0.01)
    with pytest.raises(DebriefError, match="other engine code"):
        skewed.submit(simulate_batch, task).result()
    skewed.shutdown()


def test_a_worker_that_cannot_be_reached_is_a_debrief_error_and_does_not_hang():
    ex = RemoteExecutor(f"http://127.0.0.1:{free_port()}", SECRET, attempts=3, backoff_s=0.01)
    started = time.time()
    with pytest.raises(DebriefError, match="failed"):
        ex.submit(simulate_batch, (b"", [], (1,), ("T0A",), False)).result()
    assert time.time() - started < 10
    ex.shutdown()


def test_a_busy_service_is_asked_again_and_the_answer_is_decoded_to_the_shape_simulate_batch_returns():
    answers = [503, 429, 200]

    class Stub(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            status = answers.pop(0)
            body = b"[[8.0, 2.5, [2, 3], [4, 4]]]" if status == 200 else b"busy"
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass
    server = HTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    ex = RemoteExecutor(f"http://127.0.0.1:{server.server_port}", SECRET, attempts=4, backoff_s=0.01)
    assert ex.submit(simulate_batch, (b"", [], (1,), ("T0A", "T0B"), False)).result() == [(8.0, 2.5, (2, 3), (4, 4))]
    assert not answers
    ex.shutdown()
    server.shutdown()


def test_only_simulate_batch_can_be_sent(executor):
    with pytest.raises(ValueError):
        executor.submit(print, 1)


def test_the_remote_worker_is_used_only_when_its_address_is_set():
    assert executor_from_env({}) is None and executor_from_env({"UNDERCUT_WORKER_URL": "  "}) is None
    with pytest.raises(SystemExit, match="UNDERCUT_WORKER_SECRET"):
        executor_from_env({"UNDERCUT_WORKER_URL": "https://w.example"})
    with pytest.raises(SystemExit, match="https://"):
        executor_from_env({"UNDERCUT_WORKER_URL": "w.example", "UNDERCUT_WORKER_SECRET": SECRET})
    ex = executor_from_env({"UNDERCUT_WORKER_URL": "https://w.example/", "UNDERCUT_WORKER_SECRET": SECRET, "UNDERCUT_WORKER_CONCURRENCY": "5"})
    assert isinstance(ex, RemoteExecutor) and ex.concurrency == 5 and ex.host == "w.example" and ex.path == ""
    ex.shutdown()


def test_the_server_sends_its_debriefs_to_the_worker_only_when_the_address_is_set(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    import server.app as srv
    seen = []
    real = srv.LiveDebrief
    monkeypatch.setattr(srv, "LiveDebrief", lambda bundle, ex, futures: seen.append(ex) or real(bundle, ex, futures))

    def start_race():
        with TestClient(srv.create_app(log_dir=tmp_path, live_debrief=True)) as client:
            team = client.get("/api/options").json()["teams"][0]["id"]
            assert client.post("/api/races", json={"team": team}).status_code == 200
    monkeypatch.setenv("UNDERCUT_WORKER_URL", "https://w.example")
    monkeypatch.setenv("UNDERCUT_WORKER_SECRET", SECRET)
    start_race()
    assert len(seen) == 1 and isinstance(seen[0], RemoteExecutor)
    monkeypatch.delenv("UNDERCUT_WORKER_URL")
    start_race()
    assert len(seen) == 2 and not isinstance(seen[1], RemoteExecutor)


def test_a_signature_checks_only_against_the_same_secret_and_body():
    assert check_signature(SECRET, b"x", sign(SECRET, b"x"))
    assert not check_signature(SECRET, b"x", None) and not check_signature(SECRET, b"y", sign(SECRET, b"x"))
