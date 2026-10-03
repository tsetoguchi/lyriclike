import React, { useRef } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { appearProgress, LINE_GAP_EM, LINE_HEIGHT_EM, pastDimAt, stackOffsetAt } from '../stack';
import { SAFE_SIDE, STAGE_HEIGHT, STAGE_TOP, STAGE_WIDTH, theme } from '../theme';
import type { TimedWord } from '../types';
import { useLineBottoms } from '../useLineBottoms';

import { KineticWord } from './KineticWord';

const WORD_GAP_EM = 0.3;
const ROW_GAP_EM = 0.1;
const ENTER_RISE_PX = 28;
const ENTER_BLUR_PX = 10;
const TOP_FADE_PX = 70;
const TOP_FADE_AFTER_PX = 40;

type LyricStackProps = {
  lines: TimedWord[][];
  appearTimes: number[];
  fontSize: number;
  areFontsReady: boolean;
};

function lineStyle(seconds: number, appearAt: number, nextAppearAt: number | undefined): React.CSSProperties {
  const progress = appearProgress(seconds, appearAt);
  const eased = 1 - Math.pow(1 - progress, 3);
  return {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: `${WORD_GAP_EM}em`,
    rowGap: `${ROW_GAP_EM}em`,
    lineHeight: LINE_HEIGHT_EM,
    visibility: progress > 0 ? 'visible' : 'hidden',
    opacity: eased * pastDimAt(seconds, nextAppearAt),
    transform: `translateY(${ENTER_RISE_PX * (1 - eased)}px)`,
    filter: eased < 1 ? `blur(${ENTER_BLUR_PX * (1 - eased)}px)` : undefined
  };
}

// The lyrics as one left-aligned column. Every line is laid out from the start but
// hidden until the song reaches it, then it stays; if the column outgrows the screen
// it scrolls up so the newest line stays in view.
export const LyricStack: React.FC<LyricStackProps> = ({
  lines,
  appearTimes,
  fontSize,
  areFontsReady
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sheetRef = useRef<HTMLDivElement>(null);
  const lineBottoms = useLineBottoms(sheetRef, areFontsReady);
  const offset = stackOffsetAt(seconds, appearTimes, lineBottoms, STAGE_HEIGHT);
  const fade = Math.min(1, offset / TOP_FADE_AFTER_PX);
  const mask = `linear-gradient(to bottom, rgba(0,0,0,${1 - fade}) 0px, black ${TOP_FADE_PX}px)`;

  return (
    <div
      style={{
        position: 'absolute',
        top: STAGE_TOP,
        left: SAFE_SIDE,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        overflow: 'hidden',
        maskImage: mask,
        WebkitMaskImage: mask
      }}
    >
      <div
        ref={sheetRef}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          rowGap: `${LINE_GAP_EM}em`,
          fontFamily: 'Montserrat',
          fontWeight: 700,
          fontSize,
          color: theme.colors.ink,
          transform: `translateY(${-offset}px)`
        }}
      >
        {lines.map((words, lineIndex) => (
          <div
            key={lineIndex}
            data-line={lineIndex}
            style={lineStyle(seconds, appearTimes[lineIndex], appearTimes[lineIndex + 1])}
          >
            {words.map((word, wordIndex) => (
              <KineticWord key={wordIndex} word={word} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
