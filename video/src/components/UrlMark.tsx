import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { outroBlendAt } from '../outro';
import { SITE_URL, URL_TOP, theme } from '../theme';

const URL_SIZE = 44;
const RESTING_OPACITY = 0.72;
const FADE_IN_START_SECONDS = 0.4;
const FADE_IN_END_SECONDS = 1;
const UNDERLINE_HEIGHT = 3;
const UNDERLINE_GAP = 10;
const OUTRO_GLOW_PX = 22;

// Only the address. It sits quietly from the start and, in the closing moments,
// brightens and draws a thin underline once, so it is noticed rather than pushed.
export const UrlMark: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const blend = outroBlendAt(seconds, durationInFrames / fps);
  const fadeIn = interpolate(seconds, [FADE_IN_START_SECONDS, FADE_IN_END_SECONDS], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });

  return (
    <div style={{ position: 'absolute', top: URL_TOP, left: 0, right: 0, textAlign: 'center' }}>
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          fontFamily: theme.fontFamily,
          fontSize: URL_SIZE,
          letterSpacing: '0.1em',
          color: theme.colors.accent,
          opacity: fadeIn * (RESTING_OPACITY + (1 - RESTING_OPACITY) * blend),
          textShadow: `0 0 ${OUTRO_GLOW_PX * blend}px ${theme.colors.accent}88`
        }}
      >
        {SITE_URL}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            bottom: -UNDERLINE_GAP,
            height: UNDERLINE_HEIGHT,
            width: '100%',
            background: theme.colors.accent,
            transformOrigin: 'left',
            transform: `scaleX(${blend})`
          }}
        />
      </span>
    </div>
  );
};
