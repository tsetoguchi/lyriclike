import themeJson from '../public/theme.json';

import type { Theme } from './types';

export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// TikTok and Reels cover the top ~10%, the bottom ~22% and the right ~15%.
export const SAFE_TOP = 192;
export const SAFE_BOTTOM = 420;
export const SAFE_SIDE = 90;

// One step darker than the app's --paper (#141922), so the amber and the rhyme
// colours carry the frame.
export const STAGE_BACKGROUND = '#0b0e14';
export const SITE_URL = 'lyriclike.com';

// Lyrics are centred in the space between the top safe line and the URL mark.
const URL_ZONE_HEIGHT = 150;
export const STAGE_TOP = SAFE_TOP;
export const STAGE_WIDTH = WIDTH - 2 * SAFE_SIDE;
export const STAGE_HEIGHT = HEIGHT - SAFE_BOTTOM - URL_ZONE_HEIGHT - STAGE_TOP;
export const URL_TOP = HEIGHT - SAFE_BOTTOM - 90;

// rhyme-core.js marks the families that outrun the palette with this value.
export const OVERFLOW_FAMILY = -1;

export const theme = themeJson as Theme;

export function markColor(family: number | null): string | null {
  if (family === null) return null;
  if (family === OVERFLOW_FAMILY) return theme.colors['ink-faded'];
  return theme.scheme[family % theme.scheme.length];
}
