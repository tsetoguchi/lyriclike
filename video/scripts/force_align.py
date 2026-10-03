"""Time every word of the exact lyrics against the vocal stem (forced alignment).

Usage: python video/scripts/force_align.py <slug> <vocals file>

Runs a CTC speech model over the vocals and finds the best path through its output
for the pasted lyrics, so each word gets a start and end at about 20 ms resolution
and none is skipped or guessed. Writes video/songs/<slug>/words.json in the shape
align.mjs expects. Needs: pip install transformers
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

MODEL_NAME = "facebook/wav2vec2-base-960h"
SAMPLE_RATE = 16000
BLANK_ID = 0
WORD_DELIMITER = "|"
LYRIC_WORD = re.compile("[A-Za-z‘’']+")
SONGS_DIR = Path(__file__).resolve().parent.parent / "songs"


def lyric_words(lyrics):
    """The words align.mjs will see, in order, as written."""
    return [match for match in LYRIC_WORD.findall(lyrics) if re.search("[A-Za-z]", match)]


def normalise(word):
    return word.upper().replace("‘", "'").replace("’", "'")


def to_tokens(words, vocab):
    """Token ids for the lyrics, with the delimiter between words, plus each word's
    first and last token index."""
    tokens, spans = [], []
    for position, word in enumerate(words):
        if position > 0:
            tokens.append(vocab[WORD_DELIMITER])
        first = len(tokens)
        tokens.extend(vocab[char] for char in normalise(word))
        spans.append((first, len(tokens) - 1))
    return tokens, spans


def with_start_state(tokens):
    """A state is scored when the path moves into it, so a dummy first state keeps
    the real first letter from being skipped."""
    return [BLANK_ID] + list(tokens)


def build_trellis(emission, tokens):
    states = with_start_state(tokens)
    frames, count = emission.shape[0], len(states)
    if frames < count:
        raise ValueError("audio is too short for these lyrics")
    trellis = np.zeros((frames, count))
    trellis[1:, 0] = np.cumsum(emission[1:, BLANK_ID])
    trellis[0, 1:] = -np.inf
    trellis[-count + 1:, 0] = np.inf
    for frame in range(frames - 1):
        stay = trellis[frame, 1:] + emission[frame, BLANK_ID]
        move = trellis[frame, :-1] + emission[frame, states[1:]]
        trellis[frame + 1, 1:] = np.maximum(stay, move)
    return trellis


def token_start_frames(trellis, emission, tokens):
    """For each real token, the frame at which the best path emits it."""
    states = with_start_state(tokens)
    frame, index = trellis.shape[0] - 1, trellis.shape[1] - 1
    starts = [0] * len(states)
    while index > 0:
        stayed = trellis[frame - 1, index] + emission[frame - 1, BLANK_ID]
        changed = trellis[frame - 1, index - 1] + emission[frame - 1, states[index]]
        frame -= 1
        if changed > stayed:
            starts[index] = frame
            index -= 1
    return starts[1:]


def word_times(starts, spans, frame_seconds, total_frames):
    """A word starts when its first token does and ends when the next token does."""
    times = []
    for first, last in spans:
        end_frame = starts[last + 1] if last + 1 < len(starts) else total_frames
        times.append((starts[first] * frame_seconds, end_frame * frame_seconds))
    return times


def load_samples(audio_path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(audio_path), "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def compute_emission(samples):
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    processor = Wav2Vec2Processor.from_pretrained(MODEL_NAME)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL_NAME).eval()
    inputs = processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    with torch.inference_mode():
        logits = model(inputs.input_values).logits
    emission = torch.log_softmax(logits, dim=-1)[0].numpy()
    return emission, processor.tokenizer.get_vocab()


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: force_align.py <slug> <vocals file>")
    song_dir = SONGS_DIR / sys.argv[1]
    words = lyric_words((song_dir / "lyrics.txt").read_text(encoding="utf-8"))
    samples = load_samples(Path(sys.argv[2]))
    emission, vocab = compute_emission(samples)
    tokens, spans = to_tokens(words, vocab)
    trellis = build_trellis(emission, tokens)
    starts = token_start_frames(trellis, emission, tokens)
    frame_seconds = len(samples) / SAMPLE_RATE / emission.shape[0]
    times = word_times(starts, spans, frame_seconds, emission.shape[0])
    result = [{"word": word, "start": round(start, 3), "end": round(end, 3)}
              for word, (start, end) in zip(words, times)]
    (song_dir / "words.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    for entry in result:
        print(f"{entry['word']:<12} {entry['start']:6.2f} - {entry['end']:6.2f}")


if __name__ == "__main__":
    main()
