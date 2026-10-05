import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { markColor, theme } from '../theme';
import type { TimedWord } from '../types';

const UNSUNG_OPACITY = 0.28;
const MIN_FILL_SECONDS = 0.12;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type KineticWordProps = {
  word: TimedWord;
};

// A word sits dim until it is sung, then fills left to right across the time it
// takes to sing it: full ink, or its rhyme colour for a rhyme word. Nothing else moves.
export const KineticWord: React.FC<KineticWordProps> = ({ word }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fillEnd = Math.max(word.end, word.start + MIN_FILL_SECONDS);
  const progress = interpolate(frame / fps, [word.start, fillEnd], [0, 1], CLAMP);
  const litColor = markColor(word.family) ?? theme.colors.ink;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ opacity: UNSUNG_OPACITY }}>{word.raw}</span>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          color: litColor,
          clipPath: `inset(-40% ${100 - progress * 100}% -40% -40%)`
        }}
      >
        {word.raw}
      </span>
    </span>
  );
};
