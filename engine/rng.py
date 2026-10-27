"""Keyed random streams.

Every concern gets its own generator, derived from the master seed and a key such as ("car", "GAN", "pass"), so a change
in one place never shifts a draw somewhere else (design section 4). The key is hashed with blake2b: Python's `hash()` is
randomised per process and would pass a same-process determinism test while breaking replay between runs.
"""
import hashlib

import numpy as np


def stream(seed: int, *key) -> np.random.Generator:
    digest = hashlib.blake2b(repr((int(seed), *key)).encode(), digest_size=16).digest()
    words = [int.from_bytes(digest[i:i + 4], "little") for i in range(0, 16, 4)]
    return np.random.Generator(np.random.PCG64(np.random.SeedSequence(words)))
