"""Find the beat grid of a song and save it to video/songs/<slug>/beats.json.

Usage: python video/scripts/detect_beats.py <slug> <audio file>

Looks for the steady pulse in the low end (kick and bass), then fits one tempo and
one starting point to the whole clip, so every beat comes from the same grid and
none drifts. Lines snap to these beats.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 22050
FFT_SIZE = 1024
HOP_SAMPLES = 128
LOW_BAND_HZ = (30, 200)
# 80 to 180 BPM. A slower pulse is reported as its double, which still lands on beats.
MIN_PERIOD_SECONDS = 0.33
MAX_PERIOD_SECONDS = 0.75
PERIOD_SEARCH = 0.04
PERIOD_STEP_SECONDS = 0.0005
PHASE_STEPS = 120
FLUX_GAIN = 10
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def load_samples(audio_path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(audio_path), "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def low_band_flux(samples, sample_rate):
    """How sharply the low end rises, per hop; the pulse of kick and bass."""
    window = np.hanning(FFT_SIZE)
    starts = range(0, len(samples) - FFT_SIZE, HOP_SAMPLES)
    spectra = np.array([np.abs(np.fft.rfft(samples[i:i + FFT_SIZE] * window)) for i in starts])
    freqs = np.fft.rfftfreq(FFT_SIZE, 1 / sample_rate)
    band = (freqs >= LOW_BAND_HZ[0]) & (freqs < LOW_BAND_HZ[1])
    energy = np.log1p(spectra[:, band] * FLUX_GAIN).sum(axis=1)
    rises = np.maximum(energy[1:] - energy[:-1], 0)
    return (rises - rises.mean()) / (rises.std() + 1e-9)


def rough_period(flux, frames_per_second):
    autocorrelation = np.correlate(flux, flux, "full")[len(flux) - 1:]
    low = int(frames_per_second * MIN_PERIOD_SECONDS)
    high = int(frames_per_second * MAX_PERIOD_SECONDS)
    return (low + int(np.argmax(autocorrelation[low:high]))) / frames_per_second


def flux_times(flux, sample_rate):
    """When each flux value happened. A value is the rise into the next window, and a
    window's action is at its middle, so both shifts are added."""
    return (np.arange(len(flux)) + 1) * HOP_SAMPLES / sample_rate + FFT_SIZE / 2 / sample_rate


def grid_score(flux, frame_times, period, phase):
    beats = np.arange(phase, frame_times[-1], period)
    return float(np.interp(beats, frame_times, flux).sum())


def fit_grid(flux, sample_rate):
    """The period and starting point whose evenly spaced beats sit on the most flux."""
    frames_per_second = sample_rate / HOP_SAMPLES
    frame_times = flux_times(flux, sample_rate)
    rough = rough_period(flux, frames_per_second)
    periods = np.arange(rough * (1 - PERIOD_SEARCH), rough * (1 + PERIOD_SEARCH), PERIOD_STEP_SECONDS)
    best = (-np.inf, rough, 0.0)
    for period in periods:
        for phase in np.linspace(0, period, PHASE_STEPS, endpoint=False):
            score = grid_score(flux, frame_times, period, phase)
            if score > best[0]:
                best = (score, float(period), float(phase))
    return best[1], best[2]


def beat_times(period, phase, duration_seconds):
    return [round(float(t), 3) for t in np.arange(phase, duration_seconds, period)]


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: detect_beats.py <slug> <audio file>")
    song_dir = SONGS_DIR / sys.argv[1]
    song_dir.mkdir(parents=True, exist_ok=True)
    samples = load_samples(Path(sys.argv[2]))
    flux = low_band_flux(samples, SAMPLE_RATE)
    period, phase = fit_grid(flux, SAMPLE_RATE)
    beats = beat_times(period, phase, len(samples) / SAMPLE_RATE)
    result = {"bpm": round(60 / period, 2), "beats": beats}
    (song_dir / "beats.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"{result['bpm']} BPM, {len(beats)} beats, first at {beats[0]} s")


if __name__ == "__main__":
    main()
