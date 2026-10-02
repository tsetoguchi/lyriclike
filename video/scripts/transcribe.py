"""Write word-level timings for a song to video/songs/<slug>/words.json.

Usage: python video/scripts/transcribe.py <slug> <audio file>

The pasted lyrics are passed as the initial prompt so Whisper leans toward the
real words; align.mjs still snaps the exact lyric text onto these timings.
"""
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel

MODEL_SIZE = "small.en"
COMPUTE_TYPE = "int8"
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def read_lyrics_prompt(song_dir):
    lyrics_path = song_dir / "lyrics.txt"
    if not lyrics_path.exists():
        return None
    return " ".join(lyrics_path.read_text(encoding="utf-8").split())


def transcribe_words(audio_path, prompt):
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type=COMPUTE_TYPE)
    segments, _ = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,
    )
    return [
        {"word": word.word.strip(), "start": word.start, "end": word.end}
        for segment in segments
        for word in segment.words
    ]


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: transcribe.py <slug> <audio file>")
    slug, audio_path = sys.argv[1], Path(sys.argv[2])
    song_dir = SONGS_DIR / slug
    song_dir.mkdir(parents=True, exist_ok=True)
    words = transcribe_words(audio_path, read_lyrics_prompt(song_dir))
    output_path = song_dir / "words.json"
    output_path.write_text(json.dumps(words, indent=2), encoding="utf-8")
    print(f"{len(words)} words -> {output_path}")


if __name__ == "__main__":
    main()
