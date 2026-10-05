// Layout and timing for the stack of lyric lines that stays on screen. Pure, so
// node --test can load it.
import { clamp01, easeInOutCubic } from './ease.ts';

export const APPEAR_LEAD_SECONDS = 0.12;
// Within half a beat at a typical tempo, so a line can always find a beat.
const BEAT_SNAP_SECONDS = 0.25;
export const PAST_OPACITY = 0.75;
export const PAST_FADE_SECONDS = 0.3;
export const SCROLL_SECONDS = 0.35;

const FONT_SIZES = [96, 88, 80, 72, 64, 56];
// Montserrat Bold averages about this much of an em per character.
const CHAR_WIDTH_EM = 0.64;
export const LINE_HEIGHT_EM = 1.1;
export const LINE_GAP_EM = 0.55;
const FIT_MARGIN = 0.94;
const BOTTOM_MARGIN_PX = 24;

function estimateRows(text: string, fontSize: number, width: number): number {
  return Math.max(1, Math.ceil((text.length * CHAR_WIDTH_EM * fontSize) / width));
}

export function estimateStackHeight(texts: string[], fontSize: number, width: number): number {
  const rows = texts.reduce((sum, text) => sum + estimateRows(text, fontSize, width), 0);
  return (rows * LINE_HEIGHT_EM + (texts.length - 1) * LINE_GAP_EM) * fontSize;
}

// One size for the whole song: the largest whose estimated stack fits the stage.
// A song too long for even the smallest size scrolls instead.
export function songFontSize(texts: string[], width: number, height: number): number {
  const fitting = FONT_SIZES.find(
    (size) => estimateStackHeight(texts, size, width) <= height * FIT_MARGIN
  );
  return fitting ?? FONT_SIZES[FONT_SIZES.length - 1];
}

// The beat nearest to a moment, or null when none is close enough to matter.
export function snapToBeat(time: number, beats: number[], toleranceSeconds: number): number | null {
  let nearest: number | null = null;
  for (const beat of beats) {
    const isCloser = nearest === null || Math.abs(beat - time) < Math.abs(nearest - time);
    if (isCloser) nearest = beat;
  }
  if (nearest === null || Math.abs(nearest - time) > toleranceSeconds) return null;
  return nearest;
}

// The first line is there from the first frame. Every other line lands on the beat
// nearest its first word, so the cut hits the music; a singer often starts just before
// the beat, so that beat can fall a little after the first word. With no beat close by,
// the line arrives just before its first word.
export function lineAppearAt(firstWordStart: number, lineIndex: number, beats: number[]): number {
  if (lineIndex === 0) return 0;
  const beat = snapToBeat(firstWordStart, beats, BEAT_SNAP_SECONDS);
  return beat ?? firstWordStart - APPEAR_LEAD_SECONDS;
}

// A line is there in full the moment it is due; only its words fill in over time.
export function isLineVisible(seconds: number, appearAt: number): boolean {
  return seconds >= appearAt;
}

// 1 for the line being sung, easing to PAST_OPACITY once the next line arrives.
export function pastDimAt(seconds: number, nextAppearAt: number | undefined): number {
  if (nextAppearAt === undefined) return 1;
  const fade = clamp01((seconds - nextAppearAt) / PAST_FADE_SECONDS);
  return 1 - (1 - PAST_OPACITY) * fade;
}

function offsetThatShows(lineBottom: number, stageHeight: number): number {
  return Math.max(0, lineBottom + BOTTOM_MARGIN_PX - stageHeight);
}

// How far the stack has scrolled up: none until the newest line would run off the
// bottom, then just enough to keep it in view, eased as it arrives.
export function stackOffsetAt(
  seconds: number,
  appearTimes: number[],
  lineBottoms: number[],
  stageHeight: number
): number {
  let newest = -1;
  appearTimes.forEach((appearAt, index) => {
    if (seconds >= appearAt) newest = index;
  });
  if (newest < 0 || lineBottoms.length === 0) return 0;
  const target = offsetThatShows(lineBottoms[newest], stageHeight);
  const previous = newest === 0 ? 0 : offsetThatShows(lineBottoms[newest - 1], stageHeight);
  const progress = easeInOutCubic((seconds - appearTimes[newest]) / SCROLL_SECONDS);
  return previous + (target - previous) * progress;
}
