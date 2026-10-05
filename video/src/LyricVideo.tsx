import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';

import { censorDisplay } from './censor';
import { LyricStack } from './components/LyricStack';
import { Stage } from './components/Stage';
import { UrlMark } from './components/UrlMark';
import { useAppFonts } from './fonts';
import { lineAppearAt, songFontSize } from './stack';
import { STAGE_HEIGHT, STAGE_WIDTH } from './theme';
import type { SongTimeline, TimedWord } from './types';

export type SongSetup = {
  timeline: SongTimeline;
  beats: number[];
  audioFile: string;
  // Nudge every word's fill: negative is earlier, positive is later.
  syncOffsetSeconds?: number;
  // Nudge when new lines cut in: negative is earlier, positive is later.
  lineOffsetSeconds?: number;
  // Words to censor on screen, lower case, e.g. { bitches: 'b*tches' }.
  censored?: Record<string, string>;
};

type PreparedSong = { lines: TimedWord[][]; appearTimes: number[]; fontSize: number };

function prepareSong(setup: SongSetup): PreparedSong {
  const syncOffset = setup.syncOffsetSeconds ?? 0;
  const lineOffset = setup.lineOffsetSeconds ?? 0;
  const censored = setup.censored ?? {};
  const lines = setup.timeline.timeline.map((line) =>
    line.map((word) => ({
      ...word,
      raw: censorDisplay(word.raw, censored),
      start: word.start + syncOffset,
      end: word.end + syncOffset
    }))
  );
  const appearTimes = lines.map(
    (line, index) => lineAppearAt(line[0].start, index, setup.beats) + lineOffset
  );
  const texts = lines.map((line) => line.map((word) => word.raw).join(' '));
  return { lines, appearTimes, fontSize: songFontSize(texts, STAGE_WIDTH, STAGE_HEIGHT) };
}

// One song's video: the stage, the lyric stack and the address, over the song's audio.
export function makeLyricVideo(setup: SongSetup): React.FC {
  const song = prepareSong(setup);
  const LyricVideo: React.FC = () => {
    const areFontsReady = useAppFonts();
    return (
      <AbsoluteFill>
        <Audio src={staticFile(setup.audioFile)} />
        <Stage />
        <LyricStack
          lines={song.lines}
          appearTimes={song.appearTimes}
          fontSize={song.fontSize}
          areFontsReady={areFontsReady}
        />
        <UrlMark />
      </AbsoluteFill>
    );
  };
  return LyricVideo;
}
