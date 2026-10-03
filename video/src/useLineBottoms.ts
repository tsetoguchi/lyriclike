import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { continueRender, delayRender } from 'remotion';

// Where each line of the stack ends, measured once the fonts are in. offsetTop and
// offsetHeight ignore transforms, so the numbers are the same on every frame a render
// tab might start on. The render waits until they are known.
export function useLineBottoms(
  sheetRef: RefObject<HTMLDivElement | null>,
  areFontsReady: boolean
): number[] {
  const [handle] = useState(() => delayRender('measuring lyric lines'));
  const [bottoms, setBottoms] = useState<number[]>([]);
  useLayoutEffect(() => {
    if (!areFontsReady || sheetRef.current === null) return;
    const lines = sheetRef.current.querySelectorAll<HTMLElement>('[data-line]');
    setBottoms(Array.from(lines, (line) => line.offsetTop + line.offsetHeight));
    continueRender(handle);
  }, [areFontsReady, handle, sheetRef]);
  return bottoms;
}
