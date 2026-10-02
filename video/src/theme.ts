import themeJson from '../public/theme.json';

import type { Theme } from './types';

export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// TikTok and Reels cover the top ~10%, the bottom ~22% and the right ~15%.
export const SAFE_TOP = 192;
export const SAFE_BOTTOM = 420;
export const SAFE_SIDE = 90;

// The lyrics sit between the wordmark (top) and the call-to-action pill (bottom).
export const CONTENT_TOP = SAFE_TOP + 170;
export const CONTENT_BOTTOM = SAFE_BOTTOM + 150;

// rhyme-core.js marks the families that outrun the palette with this value.
export const OVERFLOW_FAMILY = -1;

export const theme = themeJson as Theme;

export function markColor(family: number | null): string | null {
  if (family === null) return null;
  if (family === OVERFLOW_FAMILY) return theme.colors['ink-faded'];
  return theme.scheme[family % theme.scheme.length];
}
