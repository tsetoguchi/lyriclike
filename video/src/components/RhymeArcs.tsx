import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { arcBetween, arcPath, cubicPoint } from '../arcs';
import { outroPulseAt } from '../outro';
import type { RhymeEvent } from '../rhyme-events';
import { lineEmphasis } from '../scroll';
import { markColor, theme } from '../theme';
import { wordKey } from '../useSheetLayout';
import type { SheetLayout } from '../useSheetLayout';

const ARC_SECONDS = 0.45;
// How far inside the card edge the widest part of a margin arc sits.
const MARGIN_PEAK_INSET = 14;
const ARC_WIDTH = 6;
const OUTRO_WIDTH_BOOST = 5;
const PAST_ARC_OPACITY = 0.5;
const TIP_RADIUS = 10;
const GLOW_PX = 10;

type RhymeArcsProps = {
  events: RhymeEvent[];
  layout: SheetLayout;
  lineStarts: number[];
  // 0 to 1: how far the outro overview has relaxed the fade on past lines' arcs.
  relief: number;
};

// Each arc draws itself from the earlier rhyme word to the one that just landed,
// with a bright dot riding the tip, and stays as part of the web of rhymes.
export const RhymeArcs: React.FC<RhymeArcsProps> = ({ events, layout, lineStarts, relief }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const pulse = outroPulseAt(seconds, durationInFrames / fps, 0);

  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}>
      {events.map((event) => {
        const color = markColor(event.family);
        const from = event.previous && layout.wordBoxes[wordKey(event.previous.lineIndex, event.previous.wordIndex)];
        const to = layout.wordBoxes[wordKey(event.lineIndex, event.wordIndex)];
        const progress = Math.min(1, (seconds - event.time) / ARC_SECONDS);
        if (!color || !from || !to || progress <= 0) return null;
        const arc = arcBetween(from, to, layout.width - MARGIN_PEAK_INSET);
        const tip = cubicPoint(arc, progress);
        const past = lineEmphasis(seconds, lineStarts, event.lineIndex).past;
        const opacity = 1 - (1 - PAST_ARC_OPACITY) * past * (1 - relief);
        return (
          <g key={wordKey(event.lineIndex, event.wordIndex)} opacity={opacity} style={{ filter: `drop-shadow(0 0 ${GLOW_PX}px ${color})` }}>
            <path
              d={arcPath(arc)}
              fill="none"
              stroke={color}
              strokeWidth={ARC_WIDTH + OUTRO_WIDTH_BOOST * pulse}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - progress}
            />
            {progress < 1 && <circle cx={tip.x} cy={tip.y} r={TIP_RADIUS} fill={theme.colors.ink} />}
          </g>
        );
      })}
    </svg>
  );
};
