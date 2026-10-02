import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { HEIGHT, SAFE_BOTTOM, theme } from '../theme';

const CTA_HEIGHT = 120;
const CTA_TEXT_SIZE = 46;
const CTA_RISE_PX = 80;

type CtaBarProps = {
  appearAtSecond: number;
  label: string;
};

export const CtaBar: React.FC<CtaBarProps> = ({ appearAtSecond, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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
    </div>
  );
};
