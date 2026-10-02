import React from 'react';

import { SAFE_SIDE, WIDTH, theme } from '../theme';
import type { TimedWord } from '../types';

import { LyricLine } from './LyricLine';

const CARD_WIDTH = WIDTH - 2 * SAFE_SIDE;
const CARD_PADDING = 56;
const CARD_RADIUS = 44;
const LYRIC_SIZE = 64;
const LINE_GAP = 44;
const CARD_BORDER = 'rgba(226, 231, 239, 0.10)';

type LyricCardProps = {
  lines: TimedWord[][];
};

// Echoes the app's memo card: slate surface, Quattro lyrics, rhyme underlines.
export const LyricCard: React.FC<LyricCardProps> = ({ lines }) => (
  <div
    style={{
      width: CARD_WIDTH,
      boxSizing: 'border-box',
      padding: CARD_PADDING,
      borderRadius: CARD_RADIUS,
      background: theme.colors['paper-card'],
      border: `2px solid ${CARD_BORDER}`,
      boxShadow: '0 40px 120px rgba(0, 0, 0, 0.45)',
      fontFamily: theme.fontFamily,
      fontSize: LYRIC_SIZE,
      lineHeight: 1.15,
      display: 'flex',
      flexDirection: 'column',
      rowGap: LINE_GAP
    }}
  >
    {lines.map((words) => (
      <LyricLine key={words[0].charStart + words[0].text} words={words} />
    ))}
  </div>
);
