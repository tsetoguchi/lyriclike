"""Compare each word's start time with the nearest acoustic onset in the vocal stem.

Usage: python video/scripts/check_sync.py <slug> <vocals file>

Prints every word's distance to the nearest onset and the median and mean absolute
error. Onsets come from spectral flux, which is approximate for legato singing, so
treat the numbers as a comparison between alignments rather than as proof.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
FFT_SIZE = 512
HOP_SAMPLES = 160
PEAK_THRESHOLD = 1.2
PEAK_HALF_WIDTH = 2
FLUX_GAIN = 20
MAX_GOOD_MS = 150
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def load_samples(audio_path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(audio_path), "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def spectral_flux(samples):
    window = np.hanning(FFT_SIZE)
    starts = range(0, len(samples) - FFT_SIZE, HOP_SAMPLES)
    magnitudes = np.array([np.abs(np.fft.rfft(samples[i:i + FFT_SIZE] * window)) for i in starts])
    rises = np.maximum(np.log1p(magnitudes * FLUX_GAIN)[1:] - np.log1p(magnitudes * FLUX_GAIN)[:-1], 0)
    flux = rises.sum(axis=1)
    return (flux - flux.mean()) / (flux.std() + 1e-9)


def onset_times(samples):
    flux = spectral_flux(samples)
    width = PEAK_HALF_WIDTH
    peaks = [
        index for index in range(width, len(flux) - width)
        if flux[index] > PEAK_THRESHOLD and flux[index] == flux[index - width:index + width + 1].max()
    ]
    return np.array(peaks) * HOP_SAMPLES / SAMPLE_RATE


def report(words, onsets):
    deltas = []
    for word in words:
        gaps = onsets - word["start"]
        nearest = np.abs(gaps).argmin()
        deltas.append(gaps[nearest] * 1000)
        flag = "  <-- far" if abs(deltas[-1]) > MAX_GOOD_MS else ""
        print(f"{word['raw']:<12} {word['start']:6.2f}s  {deltas[-1]:+5.0f} ms{flag}")
    print(f"median {np.median(deltas):+.0f} ms, mean absolute {np.mean(np.abs(deltas)):.0f} ms, "
          f"{sum(abs(d) > MAX_GOOD_MS for d in deltas)} words beyond {MAX_GOOD_MS} ms")


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: check_sync.py <slug> <vocals file>")
    timeline_path = SONGS_DIR / sys.argv[1] / "timeline.json"
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))["timeline"]
    words = [word for line in timeline for word in line]
    report(words, onset_times(load_samples(Path(sys.argv[2]))))


if __name__ == "__main__":
    main()
