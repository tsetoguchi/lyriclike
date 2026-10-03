import React, { useRef } from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { OUTRO_STAGGER_SECONDS, outroBlendAt } from '../outro';
import type { RhymeEvent } from '../rhyme-events';
import { ANCHOR_RATIO, lineEmphasis, scrollOffsetAt } from '../scroll';
import type { LineEmphasis } from '../scroll';
import { BOX_HEIGHT, BOX_TOP, BOX_WIDTH, SAFE_SIDE, theme } from '../theme';
import type { TimedWord } from '../types';
import { useSheetLayout, wordKey } from '../useSheetLayout';
import type { SheetLayout } from '../useSheetLayout';

import { LyricLine } from './LyricLine';
import { RhymeArcs } from './RhymeArcs';
import { RhymeBurst } from './RhymeBurst';
import { RhymeCallout } from './RhymeCallout';

const CARD_RADIUS = 44;
const SHEET_PADDING_X = 56;
const LYRIC_SIZE = 68;
const LINE_GAP = 52;
const CARD_BORDER = 'rgba(226, 231, 239, 0.10)';
const EDGE_FADE =
  'linear-gradient(to bottom, transparent 0%, black 12%, black 84%, transparent 100%)';
const INTRO_SECONDS = 0.35;
const INTRO_START_REVEAL = 0.4;

type ScrollingLyricsProps = {
  lines: TimedWord[][];
  events: RhymeEvent[];
  areFontsReady: boolean;
};

function buildOutroDelays(events: RhymeEvent[]): Record<string, number> {
  const delays: Record<string, number> = {};
  events.forEach((event, order) => {
    delays[wordKey(event.lineIndex, event.wordIndex)] = order * OUTRO_STAGGER_SECONDS;
  });
  return delays;
}

// The card wipes down into view, but never starts empty: line one is readable at once.
function useIntroReveal(): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = interpolate(frame / fps, [0, INTRO_SECONDS], [INTRO_START_REVEAL, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
  return 1 - Math.pow(1 - progress, 3);
}

// In the outro the sheet glides back to centre the whole stanza, so the full web of
// rhymes is on screen for the closing wave.
function sheetTranslateY(offset: number, layout: SheetLayout, blend: number): number {
  const anchoredY = BOX_HEIGHT * ANCHOR_RATIO - offset;
  const overviewY = (BOX_HEIGHT - layout.height) / 2;
  return anchoredY + (overviewY - anchoredY) * blend;
}

function relaxEmphasis(emphasis: LineEmphasis, blend: number): LineEmphasis {
  return { active: emphasis.active * (1 - blend), past: emphasis.past * (1 - blend) };
}

export const ScrollingLyrics: React.FC<ScrollingLyricsProps> = ({
  lines,
  events,
  areFontsReady
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const sheetRef = useRef<HTMLDivElement>(null);
  const layout = useSheetLayout(sheetRef, areFontsReady);
  const reveal = useIntroReveal();
  const lineStarts = lines.map((line) => line[0].start);
  const offset = scrollOffsetAt(seconds, lineStarts, layout.lineTops);
  const blend = outroBlendAt(seconds, durationInFrames / fps);
  const outroDelays = buildOutroDelays(events);

  return (
    <div
      style={{
        position: 'absolute',
        top: BOX_TOP,
        left: SAFE_SIDE,
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
        overflow: 'hidden',
        borderRadius: CARD_RADIUS,
        background: theme.colors['paper-card'],
        border: `2px solid ${CARD_BORDER}`,
        boxShadow: '0 40px 120px rgba(0, 0, 0, 0.45)',
        clipPath: `inset(0 0 ${(1 - reveal) * 100}% 0 round ${CARD_RADIUS}px)`
      }}
    >
      <div style={{ position: 'absolute', inset: 0, maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}>
        <div
          ref={sheetRef}
          style={{
            position: 'relative',
            padding: `0 ${SHEET_PADDING_X}px`,
            transform: `translateY(${sheetTranslateY(offset, layout, blend)}px)`,
            display: 'flex',
            flexDirection: 'column',
            rowGap: LINE_GAP,
            fontFamily: theme.fontFamily,
            fontWeight: 700,
            fontSize: LYRIC_SIZE,
            lineHeight: 1.15
          }}
        >
          {lines.map((words, lineIndex) => (
            <LyricLine
              key={lineIndex}
              words={words}
              lineIndex={lineIndex}
              emphasis={relaxEmphasis(lineEmphasis(seconds, lineStarts, lineIndex), blend)}
              outroDelays={outroDelays}
            />
          ))}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <RhymeArcs events={events} layout={layout} lineStarts={lineStarts} relief={blend} />
            <RhymeBurst events={events} layout={layout} />
            <RhymeCallout events={events} layout={layout} />
          </div>
        </div>
      </div>
    </div>
  );
};
