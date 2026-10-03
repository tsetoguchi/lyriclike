import React from 'react';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { KineticLine } from '../components/KineticLine';
import { Recap } from '../components/Recap';
import { Stage } from '../components/Stage';
import { UrlMark } from '../components/UrlMark';
import { useAppFonts } from '../fonts';
import { shakeAt } from '../impact';
import { lineWindows } from '../lines';
import { OUTRO_SECONDS } from '../outro';
import { buildWordMaps, rhymeEvents } from '../rhyme-events';
import timelineJson from '../../songs/sound-2/timeline.json';
import type { SongTimeline } from '../types';

export const SOUND_2_AUDIO = 'audio/sound-2.wav';

const SONG = timelineJson as unknown as SongTimeline;
const EVENTS = rhymeEvents(SONG.timeline);
const MAPS = buildWordMaps(EVENTS);
const SPANS = SONG.timeline.map((line) => ({
  start: line[0].start,
  end: line[line.length - 1].end
}));

export const Sound2: React.FC = () => {
  useAppFonts();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const windows = lineWindows(SPANS, durationInFrames / fps - OUTRO_SECONDS);
  const shake = shakeAt(frame / fps, EVENTS);

  return (
    <AbsoluteFill>
      <Audio src={staticFile(SOUND_2_AUDIO)} />
      <Stage events={EVENTS} />
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
        {SONG.timeline.map((words, lineIndex) => (
          <KineticLine
            key={lineIndex}
            words={words}
            lineIndex={lineIndex}
            maps={MAPS}
            window={windows[lineIndex]}
          />
        ))}
        <Recap lines={SONG.timeline} maps={MAPS} />
      </AbsoluteFill>
      <UrlMark />
    </AbsoluteFill>
  );
};
