"""Tighten word times in video/songs/<slug>/words.json using the vocal stem.

Usage: python video/scripts/trim_to_voice.py <slug> <vocals file>

Whisper stretches the first word after a pause backward across the silence
(e.g. "it's" 3.5-5.9 s when it is sung at 5.2 s). The isolated vocal stem has
real silence, so each word is cut to the voiced stretch that ends it.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
HOP_SECONDS = 0.01
SILENCE_DB = -50.0
MIN_PAUSE_SECONDS = 0.2
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def load_level_db(audio_path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(audio_path), "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    samples = np.frombuffer(raw, dtype=np.float32)
    hop = int(SAMPLE_RATE * HOP_SECONDS)
    count = len(samples) // hop
    frames = samples[: count * hop].reshape(count, hop)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-6))


def last_pause_end(is_silent, first, last):
    """Index just after the final pause inside [first, last), or first."""
    min_frames = int(MIN_PAUSE_SECONDS / HOP_SECONDS)
    run_length = 0
    pause_end = first
    for index in range(first, last):
        run_length = run_length + 1 if is_silent[index] else 0
        if run_length >= min_frames and index + 1 < last and not is_silent[index + 1]:
            pause_end = index + 1
    return pause_end


def trim_word(word, is_silent):
    first = int(word["start"] / HOP_SECONDS)
    last = min(int(word["end"] / HOP_SECONDS), len(is_silent))
    first = last_pause_end(is_silent, first, last)
    while first < last and is_silent[first]:
        first += 1
    while last > first and is_silent[last - 1]:
        last -= 1
    if first >= last:
        return word
    return {**word, "start": first * HOP_SECONDS, "end": last * HOP_SECONDS}


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: trim_to_voice.py <slug> <vocals file>")
    words_path = SONGS_DIR / sys.argv[1] / "words.json"
    is_silent = load_level_db(Path(sys.argv[2])) < SILENCE_DB
    words = json.loads(words_path.read_text(encoding="utf-8"))
    trimmed = [trim_word(word, is_silent) for word in words]
    words_path.write_text(json.dumps(trimmed, indent=2), encoding="utf-8")
    for before, after in zip(words, trimmed):
        print(f"{after['word']:<10} {before['start']:5.2f}-{before['end']:5.2f}"
              f" -> {after['start']:5.2f}-{after['end']:5.2f}")


if __name__ == "__main__":
    main()
