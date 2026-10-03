import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { OUTRO_SECONDS } from '../outro';
import type { WordMaps } from '../rhyme-events';
import { SAFE_SIDE, STAGE_HEIGHT, STAGE_TOP, STAGE_WIDTH } from '../theme';
import type { TimedWord } from '../types';

import { WordRow } from './KineticLine';

const RECAP_SIZE = 60;
const LINE_GAP_PX = 34;
const LINE_STAGGER_SECONDS = 0.14;
const SLIDE_PX = 40;

type RecapProps = {
  lines: TimedWord[][];
  maps: WordMaps;
};

// In the closing moments the whole stanza pops back in, stacked, with every rhyme
// lit, so the viewer sees the full pattern in one frame.
export const Recap: React.FC<RecapProps> = ({ lines, maps }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outroStart = durationInFrames / fps - OUTRO_SECONDS;
  if (frame / fps < outroStart) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: STAGE_TOP,
        left: SAFE_SIDE,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        rowGap: LINE_GAP_PX,
        fontSize: RECAP_SIZE
      }}
    >
      {lines.map((words, lineIndex) => {
        const entrance = spring({
          frame: frame - (outroStart + lineIndex * LINE_STAGGER_SECONDS) * fps,
          fps,
          config: { damping: 14, stiffness: 200 }
        });
        return (
          <div
            key={lineIndex}
            style={{
              opacity: Math.min(1, entrance),
              transform: `translateY(${(1 - entrance) * SLIDE_PX}px)`
            }}
          >
            <WordRow words={words} lineIndex={lineIndex} maps={maps} />
          </div>
        );
      })}
    </div>
  );
};
