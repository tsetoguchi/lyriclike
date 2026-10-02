# Lyric videos

Vertical karaoke videos for TikTok and Instagram. Each word fills as it is sung and
rhyme families are underlined by the app's own `rhyme-core.js`, in the app's colours
(read from `styles.css`). Output: `media/instagram/<slug>.mp4` keeps the audio;
`media/tiktok/<slug>.mp4` is silent, so the sound can be added back in TikTok.

Songs, audio and renders are gitignored (`video/songs/`, `media/`).

## One-time setup

```
pip install faster-whisper demucs soundfile
cd video && npm install
```

## Making a video

Put the audio in `media/audio/` and write the exact sung lyrics to
`video/songs/<slug>/lyrics.txt` (blank line between stanzas). Then:

```
python video/scripts/separate_vocals.py <slug> media/audio/<file>
python video/scripts/transcribe.py <slug> video/songs/<slug>/vocals.wav
python video/scripts/trim_to_voice.py <slug> video/songs/<slug>/vocals.wav
node video/scripts/align.mjs <slug>
node video/scripts/rhyme-marks.mjs <slug>
node video/scripts/sync-assets.mjs <slug> media/audio/<file>
```

Check the timing with `npm run studio` (in `video/`), then register the song in
`src/Root.tsx`, write `src/songs/<slug>.tsx` and render:

```
node video/scripts/render.mjs <slug>
```

`separate_vocals.py` and `trim_to_voice.py` matter for tracks with a music bed:
Whisper stretches the first word after a pause back across the silence, and the
isolated vocal stem is what shows where the voice really starts.

Tests: `node --test "video/test/*.test.mjs"`.
