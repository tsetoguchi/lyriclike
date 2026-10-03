import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

import type { RhymeEvent } from '../rhyme-events';
import { markColor, theme } from '../theme';
import { wordKey } from '../useSheetLayout';
import type { SheetLayout } from '../useSheetLayout';

const CALLOUT_SECONDS = 0.9;
const FADE_START_SECONDS = 0.5;
const SINK_PX = 14;
const GAP_BELOW_WORD = 4;
const CHIP_TEXT_SIZE = 24;

type RhymeCalloutProps = {
  events: RhymeEvent[];
  layout: SheetLayout;
};

// A pill that pops over the word saying how many words now share the sound.
export const RhymeCallout: React.FC<RhymeCalloutProps> = ({ events, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  return (
    <>
      {events.filter((event) => event.countInFamily >= 2).map((event) => {
        const box = layout.wordBoxes[wordKey(event.lineIndex, event.wordIndex)];
        const color = markColor(event.family);
        const age = seconds - event.time;
        if (!box || !color || age < 0 || age > CALLOUT_SECONDS) return null;
        const entrance = spring({ frame: age * fps, fps, config: { damping: 10, stiffness: 200 } });
        const fade = 1 - Math.max(0, (age - FADE_START_SECONDS) / (CALLOUT_SECONDS - FADE_START_SECONDS));
        const sink = SINK_PX * (age / CALLOUT_SECONDS);
        return (
          <div
            key={wordKey(event.lineIndex, event.wordIndex)}
            style={{
              position: 'absolute',
              left: box.x + box.width / 2,
              top: box.y + box.height + GAP_BELOW_WORD + sink,
              transform: `translate(-50%, 0) scale(${entrance})`,
              padding: '4px 16px',
              borderRadius: 999,
              background: color,
              color: theme.colors.paper,
              fontFamily: theme.fontFamily,
              fontWeight: 700,
              fontSize: CHIP_TEXT_SIZE,
              whiteSpace: 'nowrap',
              opacity: fade
            }}
          >
            {`rhyme ×${event.countInFamily}`}
          </div>
        );
      })}
    </>
  );
};
