import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { outroPulseAt } from '../outro';
import { STAGE_BACKGROUND, markColor, theme } from '../theme';
import type { TimedWord } from '../types';

const UNSUNG_OPACITY = 0.28;
const MIN_FILL_SECONDS = 0.12;
const BLOCK_WIPE_SECONDS = 0.16;
const BLOCK_OVERHANG = '-0.04em -0.12em';
const SLANT_TINT = '33';
const BLOCK_RADIUS = '0.2em';
const SLANT_BORDER = '0.055em';
const SLAM_FRAMES = 24;
const SLAM_SPRING = { damping: 10, stiffness: 280, mass: 0.7 };
const PLAIN_SLAM = { scale: 0.45, tilt: 3, drop: 0.2, blur: 10 };
const RHYME_SLAM = { scale: 0.7, tilt: 5, drop: 0.3, blur: 14 };
const OUTRO_SCALE_BOOST = 0.1;
const RING_SECONDS = 0.55;
const RING_START_SCALE = 0.7;
const RING_GROWTH = 2.4;
const RING_WIDTH = '0.05em';
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type KineticWordProps = {
  word: TimedWord;
  wordIndex: number;
  isLanding: boolean;
  outroDelay?: number;
};

type Slam = { scale: number; rotate: number; lift: string; blur: number };

// Each word is hit onto the screen: it starts oversized, tilted and above its place,
// then a stiff spring overshoots and settles. Rhyme words hit harder.
function slamAt(frame: number, fps: number, word: TimedWord, wordIndex: number): Slam {
  const sinceStart = frame - word.start * fps;
  if (sinceStart < 0) return { scale: 1, rotate: 0, lift: '0em', blur: 0 };
  const settle = spring({ frame: sinceStart, fps, durationInFrames: SLAM_FRAMES, config: SLAM_SPRING });
  const energy = 1 - settle;
  const hit = word.family === null ? PLAIN_SLAM : RHYME_SLAM;
  const direction = wordIndex % 2 === 0 ? -1 : 1;
  return {
    scale: 1 + hit.scale * energy,
    rotate: direction * hit.tilt * energy,
    lift: `${-hit.drop * energy}em`,
    blur: hit.blur * Math.pow(Math.max(0, energy), 2)
  };
}

// Plain words fill across their sung span; rhyme words snap their block in fast so
// the colour lands with the hit even when the word is held.
function fillProgress(word: TimedWord, seconds: number, isRhyme: boolean): number {
  const span = isRhyme ? BLOCK_WIPE_SECONDS : Math.max(word.end - word.start, MIN_FILL_SECONDS);
  return interpolate(seconds, [word.start, word.start + span], [0, 1], CLAMP);
}

const Ring: React.FC<{ color: string; age: number }> = ({ color, age }) => {
  const progress = age / RING_SECONDS;
  if (progress < 0 || progress > 1) return null;
  const eased = 1 - Math.pow(1 - progress, 3);
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '1em',
        height: '1em',
        marginLeft: '-0.5em',
        marginTop: '-0.5em',
        borderRadius: '50%',
        border: `${RING_WIDTH} solid ${color}`,
        transform: `scale(${RING_START_SCALE + RING_GROWTH * eased})`,
        opacity: 1 - progress
      }}
    />
  );
};

export const KineticWord: React.FC<KineticWordProps> = ({
  word,
  wordIndex,
  isLanding,
  outroDelay
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const color = markColor(word.family);
  const progress = fillProgress(word, seconds, color !== null);
  const slam = slamAt(frame, fps, word, wordIndex);
  const pulse = outroDelay === undefined ? 0 : outroPulseAt(seconds, durationInFrames / fps, outroDelay);
  const isSolid = color !== null && !word.isSlant;
  const litColor = isSolid ? STAGE_BACKGROUND : (color ?? theme.colors.ink);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {isLanding && color && <Ring color={color} age={seconds - word.start} />}
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          transform: `translateY(${slam.lift}) rotate(${slam.rotate}deg) scale(${slam.scale + OUTRO_SCALE_BOOST * pulse})`,
          filter: slam.blur > 0.2 ? `blur(${slam.blur}px)` : undefined
        }}
      >
        {color && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: BLOCK_OVERHANG,
              borderRadius: BLOCK_RADIUS,
              background: isSolid ? color : `${color}${SLANT_TINT}`,
              border: isSolid ? 'none' : `${SLANT_BORDER} solid ${color}`,
              clipPath: `inset(0 ${100 - progress * 100}% 0 0)`
            }}
          />
        )}
        <span style={{ position: 'relative', opacity: UNSUNG_OPACITY }}>{word.raw}</span>
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
