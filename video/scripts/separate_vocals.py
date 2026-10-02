"""Isolate the vocals of a song so Whisper hears word onsets without the music.

Usage: python video/scripts/separate_vocals.py <slug> <audio file>

Writes video/songs/<slug>/vocals.wav; pass that file to transcribe.py.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEMUCS_MODEL = "htdemucs"
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def run_demucs(audio_path, output_dir):
    command = [
        sys.executable, "-m", "demucs",
        "--two-stems", "vocals",
        "-n", DEMUCS_MODEL,
        "-o", str(output_dir),
        str(audio_path),
    ]
    subprocess.run(command, check=True)
    return output_dir / DEMUCS_MODEL / audio_path.stem / "vocals.wav"


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: separate_vocals.py <slug> <audio file>")
    slug, audio_path = sys.argv[1], Path(sys.argv[2])
    song_dir = SONGS_DIR / slug
    song_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as work_dir:
        vocals_path = run_demucs(audio_path, Path(work_dir))
        destination = song_dir / "vocals.wav"
        shutil.copyfile(vocals_path, destination)
    print(f"vocals -> {destination}")


if __name__ == "__main__":
    main()
