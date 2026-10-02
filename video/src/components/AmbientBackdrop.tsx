import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import { HEIGHT, WIDTH, theme } from '../theme';

const BLOB_SIZE = 1100;
const BLOB_OPACITY = 0.16;
const DRIFT_PX = 120;

type Blob = { schemeIndex: number; x: number; y: number; period: number; phase: number };

const BLOBS: Blob[] = [
  { schemeIndex: 5, x: 0.1, y: 0.2, period: 9, phase: 0 },
  { schemeIndex: 1, x: 0.95, y: 0.55, period: 11, phase: 2 },
  { schemeIndex: 0, x: 0.3, y: 0.95, period: 13, phase: 4 }
];

function blobStyle(blob: Blob, seconds: number): React.CSSProperties {
  const angle = (seconds / blob.period) * 2 * Math.PI + blob.phase;
  const color = theme.scheme[blob.schemeIndex];
  return {
    position: 'absolute',
    width: BLOB_SIZE,
    height: BLOB_SIZE,
    left: blob.x * WIDTH - BLOB_SIZE / 2 + Math.cos(angle) * DRIFT_PX,
    top: blob.y * HEIGHT - BLOB_SIZE / 2 + Math.sin(angle) * DRIFT_PX,
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
    opacity: BLOB_OPACITY
  };
}

// Slow-drifting colour washes in the rhyme palette keep the slate from feeling static.
export const AmbientBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.paper, overflow: 'hidden' }}>
      {BLOBS.map((blob) => (
        <div key={blob.schemeIndex} style={blobStyle(blob, frame / fps)} />
      ))}
    </AbsoluteFill>
  );
};
