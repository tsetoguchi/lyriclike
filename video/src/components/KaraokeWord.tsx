import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { outroPulseAt } from '../outro';
import { markColor, theme } from '../theme';
import type { TimedWord } from '../types';
import { wordKey } from '../useSheetLayout';

import { RhymeMark } from './RhymeMark';

const MIN_FILL_SECONDS = 0.12;
const POP_FRAMES = 24;
const PLAIN_POP = { scale: 0.1, rise: 10, blur: 3 };
const RHYME_POP = { scale: 0.18, rise: 24, blur: 6 };
const GLOW_BLUR = 18;
const GLOW_OPACITY = 0.7;
const OUTRO_GLOW_BOOST = 0.5;
const OUTRO_SCALE_BOOST = 0.06;
const UNSUNG_OPACITY = 0.62;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type KaraokeWordProps = {
  word: TimedWord;
  lineIndex: number;
  wordIndex: number;
  outroDelay?: number;
};

type WordMotion = { scale: number; rise: number; blur: number };

function useFillProgress(word: TimedWord): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fillEnd = Math.max(word.end, word.start + MIN_FILL_SECONDS);
  return interpolate(frame / fps, [word.start, fillEnd], [0, 1], CLAMP);
}

// A word is punched up as it is sung and settles back; rhyme words hit harder.
function useWordMotion(word: TimedWord): WordMotion {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sinceStart = frame - word.start * fps;
  if (sinceStart < 0) return { scale: 1, rise: 0, blur: 0 };
  const settle = spring({
    frame: sinceStart,
    fps,
    durationInFrames: POP_FRAMES,
    config: { damping: 9, stiffness: 160 }
  });
  const energy = 1 - settle;
  const pop = word.family === null ? PLAIN_POP : RHYME_POP;
  return {
    scale: 1 + pop.scale * energy,
    rise: -pop.rise * energy,
    blur: pop.blur * Math.max(0, energy)
  };
}

function useOutroPulse(outroDelay: number | undefined): number {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (outroDelay === undefined) return 0;
  return outroPulseAt(frame / fps, durationInFrames / fps, outroDelay);
}

export const KaraokeWord: React.FC<KaraokeWordProps> = ({
  word,
  lineIndex,
  wordIndex,
  outroDelay
}) => {
  const progress = useFillProgress(word);
  const motion = useWordMotion(word);
  const pulse = useOutroPulse(outroDelay);
  const color = markColor(word.family);
  const litColor = color ?? theme.colors.ink;
  const glow = Math.min(1, GLOW_OPACITY * progress + OUTRO_GLOW_BOOST * pulse);
  const scale = motion.scale + OUTRO_SCALE_BOOST * pulse;

  return (
    <span
      data-word={wordKey(lineIndex, wordIndex)}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <span
        style={{
          display: 'inline-block',
          transform: `translateY(${motion.rise}px) scale(${scale})`,
          transformOrigin: '50% 80%'
        }}
      >
        {color && glow > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              color,
              opacity: glow,
              filter: `blur(${GLOW_BLUR}px)`
            }}
          >
            {word.raw}
          </span>
        )}
        <span style={{ color: theme.colors['ink-faded'], opacity: UNSUNG_OPACITY }}>
          {word.raw}
        </span>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            color: litColor,
            clipPath: `inset(-30% ${100 - progress * 100}% -30% 0)`,
            filter: motion.blur > 0 ? `blur(${motion.blur}px)` : undefined
          }}
        >
          {word.raw}
        </span>
        {color && <RhymeMark color={color} progress={progress} isSlant={word.isSlant} />}
      </span>
    </span>
  );
};
