import copy
import json

import pytest

from engine.bundle import BundleError, is_placeholder, load_bundle, validate_bundle
from tests.bundles import minimal_bundle


def test_minimal_bundle_validates():
    assert validate_bundle(minimal_bundle())["bundle_version"] == "0.0.1"


def test_incompatible_schema_version_is_refused_first():
    b = minimal_bundle()
    b["schema_version"] = 2
    del b["compounds"]
    with pytest.raises(BundleError, match="incompatible schema_version"):
        validate_bundle(b)


def test_missing_required_block_is_reported_with_path():
    b = minimal_bundle()
    del b["circuits"]["Test"]["pit_loss_green_s"]
    with pytest.raises(BundleError, match="circuits.Test"):
        validate_bundle(b)


def test_unknown_compound_is_rejected():
    b = minimal_bundle()
    b["compounds"]["GREEN"] = copy.deepcopy(b["compounds"]["HARD"])
    with pytest.raises(BundleError):
        validate_bundle(b)


def test_each_team_needs_two_drivers():
    b = minimal_bundle()
    b["teams"][0]["drivers"].pop()
    with pytest.raises(BundleError, match="teams.0.drivers"):
        validate_bundle(b)


def test_load_bundle_reads_a_file_and_flags_placeholders(tmp_path):
    b = minimal_bundle()
    b["placeholders"] = ["pit_stop"]
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    loaded = load_bundle(path)
    assert is_placeholder(loaded, "pit_stop") and not is_placeholder(loaded, "passing")
