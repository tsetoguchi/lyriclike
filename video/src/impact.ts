// What happens to the whole frame when a rhyme lands. Pure, so node --test can load it.
import type { RhymeEvent } from './rhyme-events.ts';

export const SHAKE_SECONDS = 0.3;
export const SHAKE_PX = 10;
export const FLASH_SECONDS = 0.45;

const SHAKE_X_RATE = 90;
const SHAKE_Y_RATE = 130;
const SHAKE_Y_SHARE = 0.6;

// A word completes a rhyme when it is at least the second of its family.
export function latestLanding(events: RhymeEvent[], seconds: number): RhymeEvent | null {
  let latest: RhymeEvent | null = null;
  for (const event of events) {
    if (event.countInFamily >= 2 && event.time <= seconds) latest = event;
  }
  return latest;
}

// A short damped shake, the same every render because it depends only on time.
export function shakeAt(seconds: number, events: RhymeEvent[]): { x: number; y: number } {
  const landing = latestLanding(events, seconds);
  if (landing === null) return { x: 0, y: 0 };
  const age = seconds - landing.time;
  if (age > SHAKE_SECONDS) return { x: 0, y: 0 };
  const decay = Math.pow(1 - age / SHAKE_SECONDS, 2);
  return {
    x: SHAKE_PX * decay * Math.sin(age * SHAKE_X_RATE),
    y: SHAKE_PX * SHAKE_Y_SHARE * decay * Math.cos(age * SHAKE_Y_RATE)
  };
}
