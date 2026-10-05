"""Run with: python -m unittest video/test/test_detect_beats.py (not part of CI)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import detect_beats  # noqa: E402

SAMPLE_RATE = detect_beats.SAMPLE_RATE
KICK_HZ = 70
KICK_SECONDS = 0.08
TRUE_PERIOD = 0.6
TRUE_PHASE = 0.25
DURATION = 14.0


def kick_track(period, phase, duration):
    """Silence with a short low thump on every beat."""
    samples = np.zeros(int(duration * SAMPLE_RATE), dtype=np.float32)
    thump_length = int(KICK_SECONDS * SAMPLE_RATE)
    time = np.arange(thump_length) / SAMPLE_RATE
    thump = np.sin(2 * np.pi * KICK_HZ * time) * np.exp(-time * 40)
    for beat in np.arange(phase, duration - KICK_SECONDS, period):
        start = int(beat * SAMPLE_RATE)
        samples[start:start + thump_length] += thump.astype(np.float32)
    return samples


class DetectBeatsTest(unittest.TestCase):
    def setUp(self):
        samples = kick_track(TRUE_PERIOD, TRUE_PHASE, DURATION)
        flux = detect_beats.low_band_flux(samples, SAMPLE_RATE)
        self.period, self.phase = detect_beats.fit_grid(flux, SAMPLE_RATE)

    def test_finds_the_tempo_without_drifting(self):
        self.assertAlmostEqual(self.period, TRUE_PERIOD, delta=0.002)

    def test_finds_where_the_beats_sit(self):
        offset = (self.phase - TRUE_PHASE) % TRUE_PERIOD
        offset = min(offset, TRUE_PERIOD - offset)
        self.assertLess(offset, 0.03)

    def test_beat_times_are_evenly_spaced_and_inside_the_clip(self):
        beats = detect_beats.beat_times(self.period, self.phase, DURATION)
        gaps = np.diff(beats)
        self.assertLess(np.ptp(gaps), 0.002)
        self.assertLess(beats[-1], DURATION)


if __name__ == "__main__":
    unittest.main()
