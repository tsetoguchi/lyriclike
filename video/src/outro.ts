// Timing for the closing moments: the sheet glides back to an overview of the whole
// stanza, then every rhyme re-lights in turn. Pure, so node --test can load it.
import { easeInOutCubic } from './ease.ts';

export const OUTRO_SECONDS = 1.6;
export const OUTRO_SCROLL_SECONDS = 0.6;
export const OUTRO_PULSE_SECONDS = 0.6;
export const OUTRO_STAGGER_SECONDS = 0.12;

// 0 until the outro starts, then eases to 1 as the sheet settles on the overview.
export function outroBlendAt(seconds: number, durationSeconds: number): number {
  const sinceStart = seconds - (durationSeconds - OUTRO_SECONDS);
  return easeInOutCubic(sinceStart / OUTRO_SCROLL_SECONDS);
}

// A bell from 0 to 1 to 0 that starts `delay` seconds into the outro.
export function outroPulseAt(
  seconds: number,
  durationSeconds: number,
  delay: number
): number {
  const sinceStart = seconds - (durationSeconds - OUTRO_SECONDS) - delay;
  if (sinceStart < 0 || sinceStart > OUTRO_PULSE_SECONDS) return 0;
  return Math.sin((Math.PI * sinceStart) / OUTRO_PULSE_SECONDS);
}
