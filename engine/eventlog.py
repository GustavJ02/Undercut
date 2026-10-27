"""Append-only event log: one JSON object per event, `{tick, type, payload}`, plus a header (design section 16).

The log hash is the determinism check: equal seed, setup, actions and versions give an equal hash. Floats are rounded
before hashing so the hash does not depend on how a value was printed.
"""
import hashlib
import json


def _clean(x):
    if isinstance(x, float):
        return round(x, 6)
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


class EventLog:
    def __init__(self, header: dict | None = None):
        self.header = header or {}
        self.events: list[dict] = []

    def add(self, tick: int, type_: str, **payload):
        self.events.append({"tick": tick, "type": type_, "payload": _clean(payload)})

    def extend(self, events):
        self.events.extend(events)

    def lines(self):
        yield json.dumps({"header": _clean(self.header)}, sort_keys=True)
        for e in self.events:
            yield json.dumps(e, sort_keys=True)

    def digest(self) -> str:
        h = hashlib.sha256()
        for line in self.lines():
            h.update(line.encode() + b"\n")
        return h.hexdigest()

    def write(self, path):
        with open(path, "w") as f:
            f.write("\n".join(self.lines()) + "\n")

    @classmethod
    def read(cls, path):
        """Load a log written by `write`."""
        with open(path) as f:
            first, *rest = [json.loads(line) for line in f if line.strip()]
        log = cls(first["header"])
        log.events = rest
        return log

    def of_type(self, type_):
        return [e for e in self.events if e["type"] == type_]
