import React from 'react';

import type { LineEmphasis } from '../scroll';
import type { TimedWord } from '../types';
import { wordKey } from '../useSheetLayout';

import { KaraokeWord } from './KaraokeWord';

const WORD_GAP_EM = 0.3;
const ROW_GAP_EM = 0.4;
const ACTIVE_SCALE = 0.03;
const PAST_DIM = 0.4;
const PAST_BLUR_PX = 1.5;

type LyricLineProps = {
  words: TimedWord[];
  lineIndex: number;
  emphasis: LineEmphasis;
  outroDelays: Record<string, number>;
};

export const LyricLine: React.FC<LyricLineProps> = ({
  words,
  lineIndex,
  emphasis,
  outroDelays
}) => (
  <div
    data-line={lineIndex}
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      columnGap: `${WORD_GAP_EM}em`,
      rowGap: `${ROW_GAP_EM}em`,
      transformOrigin: 'left center',
      transform: `scale(${1 + ACTIVE_SCALE * emphasis.active})`,
      opacity: 1 - PAST_DIM * emphasis.past,
      filter: emphasis.past > 0 ? `blur(${PAST_BLUR_PX * emphasis.past}px)` : undefined
    }}
  >
    {words.map((word, wordIndex) => (
      <KaraokeWord
        key={wordKey(lineIndex, wordIndex)}
        word={word}
        lineIndex={lineIndex}
        wordIndex={wordIndex}
        outroDelay={outroDelays[wordKey(lineIndex, wordIndex)]}
      />
    ))}
  </div>
);
