"""Loading and validating the parameter bundle.

The bundle is the only source of fitted numbers for the engine (design section 14). It is validated against
`params/bundle.schema.json`, and an incompatible `schema_version` is refused before anything else is read. Values the
exporter could not fit are listed in `placeholders`; the engine may use them but must never report them as fitted.
"""
import json
import os
from pathlib import Path

import jsonschema

SCHEMA_VERSION = 1
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "params" / "bundle.schema.json"
CIRCUITS_DIR = Path(os.environ.get("UNDERCUT_CIRCUITS", Path(__file__).resolve().parent.parent / "circuits"))


class BundleError(ValueError):
    pass


def validate_bundle(bundle: dict) -> dict:
    """Return the bundle if it matches the schema, else raise BundleError with the first problem found."""
    version = bundle.get("schema_version")
    if version != SCHEMA_VERSION:
        raise BundleError(f"incompatible schema_version {version!r}, engine reads {SCHEMA_VERSION}")
    schema = json.loads(SCHEMA_PATH.read_text())
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(bundle), key=lambda e: list(e.path))
    if errors:
        e = errors[0]
        where = ".".join(str(p) for p in e.path) or "<root>"
        raise BundleError(f"bundle invalid at {where}: {e.message}")
    return bundle


def load_circuits(circuits_dir=None) -> dict:
    """Every `<dir>/<id>/circuit.json`, by id. A circuit is one self-contained entry: its display data, its outline, the numbers the
    engine uses and the list of those numbers that are placeholders. Deleting the folder removes the circuit."""
    base = Path(circuits_dir or CIRCUITS_DIR)
    return {p.parent.name: json.loads(p.read_text()) for p in sorted(base.glob("*/circuit.json"))}


def load_bundle(path, circuits_dir=None) -> dict:
    """Read a bundle file. A bundle without a `circuits` section takes its circuits from the circuit folders; one that has the
    section is complete as it stands (a bundle of another dataset brings its own)."""
    bundle = json.loads(Path(path).read_text())
    if "circuits" not in bundle:
        docs = load_circuits(circuits_dir)
        bundle["circuits"] = {cid: doc["parameters"] for cid, doc in docs.items()}
        bundle["stints"] = {**bundle["stints"], "circuits": {**bundle["stints"].get("circuits", {}), **{cid: doc["stints"] for cid, doc in docs.items() if "stints" in doc}}}
        bundle["placeholders"] = list(bundle["placeholders"]) + [f"circuits.{cid}.{name}" for cid, doc in docs.items() for name in doc.get("placeholders", [])]
    return validate_bundle(bundle)


def is_placeholder(bundle: dict, dotted_path: str) -> bool:
    return dotted_path in bundle["placeholders"]
