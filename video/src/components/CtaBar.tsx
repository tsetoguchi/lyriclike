import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { CTA_HEIGHT, HEIGHT, SAFE_BOTTOM, theme } from '../theme';

const CTA_TEXT_SIZE = 42;
const CTA_RISE_PX = 80;
const SHINE_DELAY_SECONDS = 0.4;
const SHINE_SECONDS = 0.9;
const SHINE_WIDTH_PERCENT = 40;

type CtaBarProps = {
  appearAtSecond: number;
  label: string;
};

// A diagonal glint that crosses the pill once after it lands.
function useShineOffsetPercent(appearAtSecond: number): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = appearAtSecond + SHINE_DELAY_SECONDS;
  return interpolate(frame / fps, [start, start + SHINE_SECONDS], [-SHINE_WIDTH_PERCENT, 140], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
}

export const CtaBar: React.FC<CtaBarProps> = ({ appearAtSecond, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shineOffset = useShineOffsetPercent(appearAtSecond);
  const entrance = spring({
    frame: frame - appearAtSecond * fps,
    fps,
    config: { damping: 14, stiffness: 120 }
  });
  return (
    <div
      style={{
        position: 'absolute',
        top: HEIGHT - SAFE_BOTTOM - CTA_HEIGHT,
        left: '50%',
        transform: `translate(-50%, ${(1 - entrance) * CTA_RISE_PX}px)`,
        opacity: entrance,
        padding: '0 56px',
        height: CTA_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        borderRadius: CTA_HEIGHT / 2,
        background: theme.colors.accent,
        color: theme.colors.paper,
        fontFamily: theme.fontFamily,
        fontWeight: 700,
        fontSize: CTA_TEXT_SIZE,
        whiteSpace: 'nowrap'
      }}
    >
      {label}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${shineOffset}%`,
          width: `${SHINE_WIDTH_PERCENT}%`,
          background:
            'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)'
        }}
      />
    </div>
  );
};
