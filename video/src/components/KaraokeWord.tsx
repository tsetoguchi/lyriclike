import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { markColor, theme } from '../theme';
import type { TimedWord } from '../types';

import { RhymeMark } from './RhymeMark';

const MIN_FILL_SECONDS = 0.12;
const POP_SCALE = 0.1;
const POP_FRAMES = 24;
const GLOW_BLUR = 18;
const GLOW_OPACITY = 0.7;
const UNSUNG_OPACITY = 0.62;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type KaraokeWordProps = {
  word: TimedWord;
};

function useFillProgress(word: TimedWord): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fillEnd = Math.max(word.end, word.start + MIN_FILL_SECONDS);
  return interpolate(frame / fps, [word.start, fillEnd], [0, 1], CLAMP);
}

function usePopScale(word: TimedWord): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sinceStart = frame - word.start * fps;
  if (sinceStart < 0) return 1;
  const settle = spring({
    frame: sinceStart,
    fps,
    durationInFrames: POP_FRAMES,
    config: { damping: 9, stiffness: 160 }
  });
  return 1 + POP_SCALE * (1 - settle);
}

export const KaraokeWord: React.FC<KaraokeWordProps> = ({ word }) => {
  const progress = useFillProgress(word);
  const scale = usePopScale(word);
  const color = markColor(word.family);
  const litColor = color ?? theme.colors.ink;
  const hasStarted = progress > 0;

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: `scale(${scale})`,
        transformOrigin: '50% 80%'
      }}
    >
      {color && hasStarted && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            color,
            opacity: GLOW_OPACITY * progress,
            filter: `blur(${GLOW_BLUR}px)`
          }}
        >
          {word.raw}
        </span>
      )}
      <span style={{ color: theme.colors['ink-faded'], opacity: UNSUNG_OPACITY }}>{word.raw}</span>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          color: litColor,
          clipPath: `inset(-30% ${100 - progress * 100}% -30% 0)`
        }}
      >
        {word.raw}
      </span>
      {color && <RhymeMark color={color} progress={progress} isSlant={word.isSlant} />}
    </span>
  );
};
