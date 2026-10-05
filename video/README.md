# Lyric videos

Vertical lyric videos for TikTok and Instagram. Lines appear one at a time as the song
reaches them and stay on screen; each word fills as it is sung, and rhyme words take
the app's rhyme colours (from `rhyme-core.js` and `styles.css`). Output:
`media/instagram/<slug>.mp4` keeps the audio; `media/tiktok/<slug>.mp4` is silent, so
the sound can be added back in TikTok.

Songs, audio and renders are gitignored (`video/songs/`, `media/`).

## One-time setup

```
pip install faster-whisper demucs soundfile transformers
cd video && npm install
```

## Making a video

Put the audio in `media/audio/` and write the exact sung lyrics to
`video/songs/<slug>/lyrics.txt`. Then:

```
python video/scripts/separate_vocals.py <slug> media/audio/<file>
python video/scripts/force_align.py <slug> video/songs/<slug>/vocals.wav
node video/scripts/align.mjs <slug>
node video/scripts/rhyme-marks.mjs <slug>
python video/scripts/detect_beats.py <slug> media/audio/<file>
node video/scripts/sync-assets.mjs <slug> media/audio/<file>
python video/scripts/check_sync.py <slug> video/songs/<slug>/vocals.wav
```

`detect_beats.py` finds the song's steady beat (from the full mix, not the vocals) and
saves it to `beats.json`. Each new line cuts in on the beat nearest its first word,
so the cuts hit the music. The first line is on screen from the first frame.

`force_align.py` times every word of the exact lyrics against the isolated vocals with
a speech model, so no word is skipped or guessed. `check_sync.py` compares each word
with the nearest acoustic onset; aim for a mean error under about 50 ms.

Check the timing with `npm run studio` (in `video/`), then register the song in
`src/Root.tsx`, write `src/songs/<slug>.tsx` and render:

```
node video/scripts/render.mjs <slug>
```

If the highlighting still feels early or late on a phone, change
`SYNC_OFFSET_SECONDS` in the song's file (negative moves it earlier) and re-render.

### Fallback: Whisper timings

If forced alignment struggles on a track, use Whisper instead of `force_align.py`:

```
python video/scripts/transcribe.py <slug> video/songs/<slug>/vocals.wav
python video/scripts/trim_to_voice.py <slug> video/songs/<slug>/vocals.wav
```

Whisper stretches the first word after a pause back across the silence, which
`trim_to_voice.py` repairs using the vocal stem.

Tests: `node --test "video/test/*.test.mjs"` (also in CI) and
`python -m unittest video/test/test_force_align.py video/test/test_detect_beats.py`
(local only).
