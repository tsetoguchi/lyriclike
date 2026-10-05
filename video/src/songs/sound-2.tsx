import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';

import { LyricStack } from '../components/LyricStack';
import { Stage } from '../components/Stage';
import { UrlMark } from '../components/UrlMark';
import { useAppFonts } from '../fonts';
import { lineAppearAt, songFontSize } from '../stack';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../theme';
import beatsJson from '../../songs/sound-2/beats.json';
import timelineJson from '../../songs/sound-2/timeline.json';
import type { SongTimeline } from '../types';

export const SOUND_2_AUDIO = 'audio/sound-2.wav';

// Nudge every word if the highlighting still feels early (negative) or late (positive).
const SYNC_OFFSET_SECONDS = 0;

const SONG = timelineJson as unknown as SongTimeline;
const LINES = SONG.timeline.map((line) =>
  line.map((word) => ({
    ...word,
    start: word.start + SYNC_OFFSET_SECONDS,
    end: word.end + SYNC_OFFSET_SECONDS
  }))
);
const BEATS = (beatsJson as { beats: number[] }).beats;
const APPEAR_TIMES = LINES.map((line, index) => lineAppearAt(line[0].start, index, BEATS));
const FONT_SIZE = songFontSize(
  LINES.map((line) => line.map((word) => word.raw).join(' ')),
  STAGE_WIDTH,
  STAGE_HEIGHT
);

export const Sound2: React.FC = () => {
  const areFontsReady = useAppFonts();
  return (
    <AbsoluteFill>
      <Audio src={staticFile(SOUND_2_AUDIO)} />
      <Stage />
      <LyricStack
        lines={LINES}
        appearTimes={APPEAR_TIMES}
        fontSize={FONT_SIZE}
        areFontsReady={areFontsReady}
      />
      <UrlMark />
    </AbsoluteFill>
  );
};
