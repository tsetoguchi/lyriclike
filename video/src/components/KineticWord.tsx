import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { markColor, theme } from '../theme';
import type { TimedWord } from '../types';

const UNSUNG_OPACITY = 0.28;
const MIN_FILL_SECONDS = 0.12;
// The hit takes ~80 ms to land, so it starts that much early to land on the onset.
export const IMPACT_LEAD_SECONDS = 0.07;
const POP_SCALE = 0.12;
const POP_BLUR_PX = 3;
const POP_FRAMES = 20;
const POP_SPRING = { damping: 11, stiffness: 260, mass: 0.7 };
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type KineticWordProps = {
  word: TimedWord;
};

// Every word gets the same small pop; a rhyme word differs only in its colour.
function popEnergy(frame: number, fps: number, word: TimedWord): number {
  const sinceHit = frame - (word.start - IMPACT_LEAD_SECONDS) * fps;
  if (sinceHit < 0) return 0;
  const settle = spring({ frame: sinceHit, fps, durationInFrames: POP_FRAMES, config: POP_SPRING });
  return 1 - settle;
}

export const KineticWord: React.FC<KineticWordProps> = ({ word }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fillEnd = Math.max(word.end, word.start + MIN_FILL_SECONDS);
  const progress = interpolate(frame / fps, [word.start, fillEnd], [0, 1], CLAMP);
  const energy = popEnergy(frame, fps, word);
  const litColor = markColor(word.family) ?? theme.colors.ink;
  const blur = POP_BLUR_PX * Math.pow(Math.max(0, energy), 2);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          transform: `scale(${1 + POP_SCALE * energy})`,
          transformOrigin: '50% 70%',
          filter: blur > 0.2 ? `blur(${blur}px)` : undefined
        }}
      >
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
    </span>
  );
};
