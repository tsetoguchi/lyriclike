import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { fontSizeFor, lineStageAt } from '../lines';
import type { LineWindow } from '../lines';
import { wordKey } from '../rhyme-events';
import type { WordMaps } from '../rhyme-events';
import { STAGE_HEIGHT, STAGE_TOP, STAGE_WIDTH, SAFE_SIDE, theme } from '../theme';
import type { TimedWord } from '../types';

import { KineticWord } from './KineticWord';

const WORD_GAP_EM = 0.44;
const ROW_GAP_EM = 0.2;
const LINE_HEIGHT = 1.05;
const ENTER_SCALE = 0.15;
const ENTER_DROP_PX = 40;
const ENTER_BLUR_PX = 12;
const EXIT_RISE_PX = 60;
const EXIT_SHRINK = 0.08;
const PUSH_IN = 0.05;

type WordRowProps = {
  words: TimedWord[];
  lineIndex: number;
  maps: WordMaps;
};

export const WordRow: React.FC<WordRowProps> = ({ words, lineIndex, maps }) => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: `${WORD_GAP_EM}em`,
      rowGap: `${ROW_GAP_EM}em`,
      lineHeight: LINE_HEIGHT,
      fontFamily: 'Montserrat',
      fontWeight: 700,
      color: theme.colors.ink,
      textAlign: 'center'
    }}
  >
    {words.map((word, wordIndex) => {
      const key = wordKey(lineIndex, wordIndex);
      return (
        <KineticWord
          key={key}
          word={word}
          wordIndex={wordIndex}
          isLanding={maps.landings.has(key)}
          outroDelay={maps.outroDelays[key]}
        />
      );
    })}
  </div>
);

type KineticLineProps = WordRowProps & { window: LineWindow };

// One lyric line, big and centred. It slams in as the song reaches it, pushes in
// slowly while it is held, and snaps away just before the next line.
export const KineticLine: React.FC<KineticLineProps> = ({ words, lineIndex, maps, window }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = lineStageAt(frame / fps, window);
  if (!stage.isVisible) return null;

  const enter = 1 - Math.pow(1 - stage.enter, 3);
  const scale = (1 + ENTER_SCALE * (1 - enter)) * (1 + PUSH_IN * stage.hold) * (1 - EXIT_SHRINK * stage.exit);
  const lift = ENTER_DROP_PX * (1 - enter) - EXIT_RISE_PX * stage.exit * stage.exit;
  const blur = ENTER_BLUR_PX * (1 - enter) + ENTER_BLUR_PX * stage.exit;
  const text = words.map((word) => word.raw).join(' ');

  return (
    <div
      style={{
        position: 'absolute',
        top: STAGE_TOP,
        left: SAFE_SIDE,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fontSizeFor(text),
        opacity: Math.min(1, enter * 3) * (1 - stage.exit),
        transform: `translateY(${lift}px) scale(${scale})`,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined
      }}
    >
      <WordRow words={words} lineIndex={lineIndex} maps={maps} />
    </div>
  );
};
