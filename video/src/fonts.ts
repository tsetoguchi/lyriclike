import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

type FontSource = { family: string; file: string; weight: string };

const FONT_SOURCES: FontSource[] = [
  { family: 'iA Writer Quattro', file: 'iAWriterQuattroS-Regular.woff2', weight: '400' },
  { family: 'iA Writer Quattro', file: 'iAWriterQuattroS-Bold.woff2', weight: '700' },
  { family: 'Montserrat', file: 'Montserrat-Bold.woff2', weight: '700' }
];

async function loadFont(source: FontSource): Promise<void> {
  const face = new FontFace(source.family, `url(${staticFile(`fonts/${source.file}`)})`, {
    weight: source.weight
  });
  await face.load();
  document.fonts.add(face);
}

// Holds the render until the app's fonts are in, so no frame uses a fallback.
export function useAppFonts(): void {
  const [handle] = useState(() => delayRender('loading fonts'));
  useEffect(() => {
    Promise.all(FONT_SOURCES.map(loadFont)).then(() => continueRender(handle));
  }, [handle]);
}
