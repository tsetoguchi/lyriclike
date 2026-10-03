// When each lyric line is on screen and how far through its entrance, hold and exit
// it is. Pure, so node --test can load it.
import { clamp01 } from './ease.ts';

export const ENTER_LEAD_SECONDS = 0.12;
export const ENTER_SECONDS = 0.18;
export const EXIT_SECONDS = 0.16;

const SIZE_SHORT = 150;
const SIZE_MEDIUM = 128;
const SIZE_LONG = 112;
const SIZE_XLONG = 96;
const MAX_SHORT_CHARS = 14;
const MAX_MEDIUM_CHARS = 24;
const MAX_LONG_CHARS = 34;

export type LineSpan = { start: number; end: number };
export type LineWindow = { appearAt: number; exitStart: number; exitEnd: number };
export type LineStage = { isVisible: boolean; enter: number; exit: number; hold: number };

// Big enough to fill the width, small enough to stay within three rows.
export function fontSizeFor(text: string): number {
  if (text.length <= MAX_SHORT_CHARS) return SIZE_SHORT;
  if (text.length <= MAX_MEDIUM_CHARS) return SIZE_MEDIUM;
  if (text.length <= MAX_LONG_CHARS) return SIZE_LONG;
  return SIZE_XLONG;
}

// A line arrives just before its first word and leaves just before the next line
// arrives, so lines never overlap. The last line leaves when the outro recap starts.
export function lineWindows(spans: LineSpan[], outroStart: number): LineWindow[] {
  return spans.map((span, index) => {
    const next = spans[index + 1];
    const appearAt = index === 0 ? 0 : span.start - ENTER_LEAD_SECONDS;
    const exitStart = next
      ? Math.max(span.end, next.start - ENTER_LEAD_SECONDS - EXIT_SECONDS)
      : outroStart;
    return { appearAt, exitStart, exitEnd: exitStart + EXIT_SECONDS };
  });
}

export function lineStageAt(seconds: number, window: LineWindow): LineStage {
  const holdSeconds = Math.max(window.exitStart - window.appearAt, 0.001);
  return {
    isVisible: seconds >= window.appearAt && seconds < window.exitEnd,
    enter: clamp01((seconds - window.appearAt) / ENTER_SECONDS),
    exit: clamp01((seconds - window.exitStart) / EXIT_SECONDS),
    hold: clamp01((seconds - window.appearAt) / holdSeconds)
  };
}
