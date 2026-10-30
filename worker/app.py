"""The debrief worker: runs batches of simulated futures for a game server (see `scoring/remote.py`). It is what the Cloud Run service runs.

    UNDERCUT_WORKER_SECRET=<at least 16 characters> uvicorn worker.app:create_app_from_env --factory --port 8080

It unpickles what it is sent, so it answers `POST /batch` only for a body signed with the shared secret, and only from a server whose engine
code matches its own. Anyone who learns the secret can run code here: keep it out of the image and out of the repository.
"""
import asyncio
import os
import pickle

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from scoring.debrief import simulate_batch
from scoring.remote import CODE_HEADER, MIN_SECRET_LENGTH, SIGNATURE_HEADER, check_signature, code_version, encode_results


def create_app(secret: str) -> FastAPI:
    app = FastAPI(title="Undercut debrief worker")

    @app.get("/health")
    def health():
        return {"ok": True, "code": code_version()}

    @app.post("/batch")
    async def batch(request: Request):
        body = await request.body()
        if not check_signature(secret, body, request.headers.get(SIGNATURE_HEADER)):
            return JSONResponse({"error": "the signature does not match: is UNDERCUT_WORKER_SECRET the same here and on the game server?"}, 401)
        theirs = request.headers.get(CODE_HEADER)
        if theirs != code_version():
            return JSONResponse({"error": f"the game server runs other engine code ({theirs}) than this worker ({code_version()}): "
                                          "deploy both from the same commit"}, 409)
        try:
            task = pickle.loads(body)
            blob, extra, seeds, cars, hand_over = task
        except Exception as e:  # noqa: BLE001  a signed body that is not a task is a bug on the caller's side
            return JSONResponse({"error": f"not a task: {type(e).__name__}: {e}"}, 400)
        try:
            results = await asyncio.to_thread(simulate_batch, task)        # off the event loop, so health checks answer while it runs
        except Exception as e:  # noqa: BLE001  the same task would fail again: 422, which the server does not retry
            return JSONResponse({"error": f"the simulation failed: {type(e).__name__}: {e}"}, 422)
        return Response(encode_results(results), media_type="application/json")

    return app


def create_app_from_env() -> FastAPI:
    secret = os.environ.get("UNDERCUT_WORKER_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise SystemExit(f"UNDERCUT_WORKER_SECRET must be set to at least {MIN_SECRET_LENGTH} characters: the worker unpickles what it is "
                         "sent, so it only accepts requests signed with it")
    return create_app(secret)
