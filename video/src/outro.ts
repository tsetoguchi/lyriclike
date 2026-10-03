// Timing for the closing moments, when the address brightens. Pure, so node --test
// can load it.
import { easeInOutCubic } from './ease.ts';

export const OUTRO_SECONDS = 1.6;
export const OUTRO_BLEND_SECONDS = 0.6;

// 0 until the outro starts, then eases to 1.
export function outroBlendAt(seconds: number, durationSeconds: number): number {
  const sinceStart = seconds - (durationSeconds - OUTRO_SECONDS);
  return easeInOutCubic(sinceStart / OUTRO_BLEND_SECONDS);
}
