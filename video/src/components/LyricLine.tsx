import React from 'react';

import type { TimedWord } from '../types';

import { KaraokeWord } from './KaraokeWord';

const WORD_GAP_EM = 0.3;
const ROW_GAP_EM = 0.45;

type LyricLineProps = {
  words: TimedWord[];
};

export const LyricLine: React.FC<LyricLineProps> = ({ words }) => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      columnGap: `${WORD_GAP_EM}em`,
      rowGap: `${ROW_GAP_EM}em`
    }}
  >
    {words.map((word) => (
      <KaraokeWord key={`${word.charStart}-${word.text}`} word={word} />
    ))}
  </div>
);
