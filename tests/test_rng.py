import numpy as np

from engine.eventlog import EventLog
from engine.rng import stream


def test_same_key_same_draws_and_different_keys_differ():
    a, b = stream(7, "car", "GAN", "pass").random(5), stream(7, "car", "GAN", "pass").random(5)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, stream(7, "car", "DUN", "pass").random(5))
    assert not np.array_equal(a, stream(8, "car", "GAN", "pass").random(5))


def test_stream_values_are_stable_across_processes():
    # a stored value: if this changes, every replay and golden hash in the repo changes with it
    assert stream(1, "incident").random(3).round(6).tolist() == [0.057595, 0.079917, 0.03344]


def test_log_digest_ignores_float_noise_and_changes_with_content():
    def log(x):
        lg = EventLog({"seed": 1})
        lg.add(3, "lap", car="GAN", lap_time=x)
        return lg
    assert log(90.1234561).digest() == log(90.1234564).digest()
    assert log(90.1234561).digest() != log(90.2).digest()
