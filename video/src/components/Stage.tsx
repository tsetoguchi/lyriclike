import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import { FLASH_SECONDS, latestLanding } from '../impact';
import type { RhymeEvent } from '../rhyme-events';
import { HEIGHT, STAGE_BACKGROUND, WIDTH, markColor, theme } from '../theme';

const GLOW_OPACITY = 0.2;
const GLOW_BREATH = 0.05;
const GLOW_PERIOD_SECONDS = 8;
const FLASH_OPACITY = 0.28;
const FLASH_SIZE = 1700;
const GRAIN_OPACITY = 0.07;
const GRAIN_TILE = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;
const VIGNETTE = 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.55) 100%)';

type StageProps = {
  events: RhymeEvent[];
};

// A slow amber glow rising from the bottom, on its own fixed rhythm.
function glowOpacity(seconds: number): number {
  return GLOW_OPACITY + GLOW_BREATH * Math.sin((seconds / GLOW_PERIOD_SECONDS) * 2 * Math.PI);
}

// The backdrop floods with a rhyme's colour the moment that rhyme lands.
function flashStyle(events: RhymeEvent[], seconds: number): React.CSSProperties | null {
  const landing = latestLanding(events, seconds);
  const color = landing && markColor(landing.family);
  if (!landing || !color) return null;
  const decay = 1 - (seconds - landing.time) / FLASH_SECONDS;
  if (decay <= 0) return null;
  return {
    position: 'absolute',
    width: FLASH_SIZE,
    height: FLASH_SIZE,
    left: WIDTH / 2 - FLASH_SIZE / 2,
    top: HEIGHT * 0.42 - FLASH_SIZE / 2,
    background: `radial-gradient(circle, ${color} 0%, transparent 62%)`,
    opacity: FLASH_OPACITY * decay * decay
  };
}

export const Stage: React.FC<StageProps> = ({ events }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const flash = flashStyle(events, seconds);
  return (
    <AbsoluteFill style={{ backgroundColor: STAGE_BACKGROUND, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: -HEIGHT * 0.25,
          height: HEIGHT * 0.7,
          background: `radial-gradient(ellipse at 50% 100%, ${theme.colors.accent} 0%, transparent 65%)`,
          opacity: glowOpacity(seconds)
        }}
      />
      {flash && <div style={flash} />}
      <AbsoluteFill style={{ background: VIGNETTE }} />
      <AbsoluteFill
        style={{ backgroundImage: GRAIN_TILE, opacity: GRAIN_OPACITY, mixBlendMode: 'soft-light' }}
      />
    </AbsoluteFill>
  );
};
