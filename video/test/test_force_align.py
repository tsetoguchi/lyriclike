"""Run with: python -m unittest video/test/test_force_align.py (not part of CI)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import force_align  # noqa: E402

VOCAB = {"<pad>": 0, "|": 4, "'": 5, "A": 6, "B": 7, "C": 8, "I": 9, "T": 10, "S": 11}
FLOOR = np.log(1e-4)


def emission_with_spikes(frames, spikes):
    """Blank everywhere except the given (frame, token) spikes."""
    emission = np.full((frames, 12), FLOOR)
    emission[:, force_align.BLANK_ID] = np.log(0.9)
    for frame, token in spikes:
        emission[frame, force_align.BLANK_ID] = FLOOR
        emission[frame, token] = np.log(0.9)
    return emission


class LyricWordsTest(unittest.TestCase):
    def test_keeps_words_in_order_and_curly_apostrophes(self):
        self.assertEqual(force_align.lyric_words("it’s okay\nI’ll go"),
                         ["it’s", "okay", "I’ll", "go"])

    def test_skips_things_with_no_letters(self):
        self.assertEqual(force_align.lyric_words("go ' - ' now"), ["go", "now"])


class TokensTest(unittest.TestCase):
    def test_words_are_joined_by_the_delimiter_and_spans_point_at_their_letters(self):
        tokens, spans = force_align.to_tokens(["it's", "a"], VOCAB)
        self.assertEqual(tokens, [9, 10, 5, 11, 4, 6])
        self.assertEqual(spans, [(0, 3), (5, 5)])


class AlignmentTest(unittest.TestCase):
    def test_words_are_timed_where_their_letters_are_spiked(self):
        words = ["a", "bat"]
        tokens, spans = force_align.to_tokens(words, VOCAB)
        spikes = [(10, VOCAB["A"]), (20, VOCAB["|"]), (30, VOCAB["B"]),
                  (40, VOCAB["A"]), (50, VOCAB["T"])]
        emission = emission_with_spikes(60, spikes)
        trellis = force_align.build_trellis(emission, tokens)
        starts = force_align.token_start_frames(trellis, emission, tokens)
        times = force_align.word_times(starts, spans, 0.02, 60)
        self.assertAlmostEqual(times[0][0], 10 * 0.02, places=6)
        self.assertAlmostEqual(times[1][0], 30 * 0.02, places=6)
        self.assertAlmostEqual(times[0][1], 20 * 0.02, places=6)
        self.assertLess(times[0][1], times[1][0])

    def test_too_short_audio_is_refused(self):
        tokens, _ = force_align.to_tokens(["bat"], VOCAB)
        with self.assertRaises(ValueError):
            force_align.build_trellis(np.zeros((2, 12)), tokens)


if __name__ == "__main__":
    unittest.main()
