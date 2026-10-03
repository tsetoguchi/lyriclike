import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { continueRender, delayRender } from 'remotion';

import type { Box } from './arcs';

export type SheetLayout = {
  width: number;
  height: number;
  lineTops: number[];
  wordBoxes: Record<string, Box>;
};

const EMPTY_LAYOUT: SheetLayout = { width: 0, height: 0, lineTops: [], wordBoxes: {} };

export function wordKey(lineIndex: number, wordIndex: number): string {
  return `${lineIndex}-${wordIndex}`;
}

// offsetLeft/offsetTop ignore transforms, so the numbers are the same whichever
// frame a render tab starts on (the active line is scaled, the sheet is translated).
function offsetWithin(element: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node !== null && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function measureSheet(sheet: HTMLElement): SheetLayout {
  const lineElements = sheet.querySelectorAll<HTMLElement>('[data-line]');
  const lineTops = Array.from(lineElements, (line) => offsetWithin(line, sheet).y);
  const wordBoxes: Record<string, Box> = {};
  sheet.querySelectorAll<HTMLElement>('[data-word]').forEach((word) => {
    const { x, y } = offsetWithin(word, sheet);
    wordBoxes[word.dataset.word as string] = {
      x,
      y,
      width: word.offsetWidth,
      height: word.offsetHeight
    };
  });
  return { width: sheet.offsetWidth, height: sheet.offsetHeight, lineTops, wordBoxes };
}

// Measures where each line and word landed once the fonts are in, and holds the
// render until then so the arcs, bursts and scroll all use the real positions.
export function useSheetLayout(
  sheetRef: RefObject<HTMLDivElement | null>,
  areFontsReady: boolean
): SheetLayout {
  const [handle] = useState(() => delayRender('measuring lyric layout'));
  const [layout, setLayout] = useState<SheetLayout>(EMPTY_LAYOUT);
  useLayoutEffect(() => {
    if (!areFontsReady || sheetRef.current === null) return;
    setLayout(measureSheet(sheetRef.current));
    continueRender(handle);
  }, [areFontsReady, handle, sheetRef]);
  return layout;
}
