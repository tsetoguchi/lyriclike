import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import type { RhymeEvent } from '../rhyme-events';
import { HEIGHT, WIDTH, markColor, theme } from '../theme';

const BLOB_SIZE = 1100;
const BLOB_OPACITY = 0.16;
const DRIFT_PX = 120;
const FLASH_SECONDS = 0.8;
const FLASH_OPACITY = 0.34;
const FLASH_SIZE = 1700;

type Blob = { schemeIndex: number; x: number; y: number; period: number; phase: number };

const BLOBS: Blob[] = [
  { schemeIndex: 5, x: 0.1, y: 0.2, period: 9, phase: 0 },
  { schemeIndex: 1, x: 0.95, y: 0.55, period: 11, phase: 2 },
  { schemeIndex: 0, x: 0.3, y: 0.95, period: 13, phase: 4 }
];

type AmbientBackdropProps = {
  events: RhymeEvent[];
};

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

function latestLanding(events: RhymeEvent[], seconds: number): RhymeEvent | null {
  let latest: RhymeEvent | null = null;
  for (const event of events) {
    if (event.countInFamily >= 2 && event.time <= seconds) latest = event;
  }
  return latest;
}

// The whole backdrop washes toward a rhyme's colour the moment that rhyme lands.
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

export const AmbientBackdrop: React.FC<AmbientBackdropProps> = ({ events }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const flash = flashStyle(events, seconds);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.paper, overflow: 'hidden' }}>
      {BLOBS.map((blob) => (
        <div key={blob.schemeIndex} style={blobStyle(blob, seconds)} />
      ))}
      {flash && <div style={flash} />}
    </AbsoluteFill>
  );
};
