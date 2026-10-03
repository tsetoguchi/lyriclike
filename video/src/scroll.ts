// Pure timing maths for the scrolling lyric sheet, so node --test can load it.
import { clamp01, easeInOutCubic } from './ease.ts';

export const ANCHOR_RATIO = 0.18;
export const SCROLL_SECONDS = 0.5;
export const SCROLL_LEAD_SECONDS = 0.15;
export const EMPHASIS_SECONDS = 0.3;

export type LineEmphasis = { active: number; past: number };

export function activeLineAt(seconds: number, lineStarts: number[]): number {
  let active = 0;
  lineStarts.forEach((start, index) => {
    if (seconds >= start) active = index;
  });
  return active;
}

// The sheet glides to each line so it arrives just before the line's first word.
export function scrollOffsetAt(
  seconds: number,
  lineStarts: number[],
  lineTops: number[]
): number {
  if (lineTops.length === 0) return 0;
  let offset = lineTops[0];
  for (let index = 1; index < lineTops.length; index += 1) {
    const windowEnd = lineStarts[index] - SCROLL_LEAD_SECONDS;
    const windowStart = windowEnd - SCROLL_SECONDS;
    if (seconds < windowStart) return offset;
    const progress = easeInOutCubic((seconds - windowStart) / SCROLL_SECONDS);
    offset = lineTops[index - 1] + (lineTops[index] - lineTops[index - 1]) * progress;
    if (progress < 1) return offset;
  }
  return offset;
}

// How much a line is the current one (0 to 1) and how far it has been left behind.
export function lineEmphasis(
  seconds: number,
  lineStarts: number[],
  lineIndex: number
): LineEmphasis {
  const start = lineStarts[lineIndex];
  const nextStart = lineStarts[lineIndex + 1];
  const arrive = clamp01((seconds - (start - EMPHASIS_SECONDS)) / EMPHASIS_SECONDS);
  const leave =
    nextStart === undefined
      ? 0
      : clamp01((seconds - (nextStart - EMPHASIS_SECONDS)) / EMPHASIS_SECONDS);
  return { active: arrive * (1 - leave), past: leave };
}
