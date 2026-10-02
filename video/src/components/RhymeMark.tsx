import React from 'react';

const MARK_THICKNESS = 9;
const MARK_OFFSET = -14;
const SLANT_DASH = 18;
const SLANT_GAP = 10;

type RhymeMarkProps = {
  color: string;
  progress: number;
  isSlant: boolean;
};

// The app draws a family's underline solid, or dashed for a slant rhyme
// (styles.css .rhyme-mark); here it also grows with the word being sung.
export const RhymeMark: React.FC<RhymeMarkProps> = ({ color, progress, isSlant }) => {
  const fill = isSlant
    ? `repeating-linear-gradient(90deg, ${color} 0 ${SLANT_DASH}px, transparent ${SLANT_DASH}px ${SLANT_DASH + SLANT_GAP}px)`
    : color;
  return (
    <span
      style={{
        position: 'absolute',
        left: 0,
        bottom: MARK_OFFSET,
        height: MARK_THICKNESS,
        width: `${progress * 100}%`,
        borderRadius: MARK_THICKNESS,
        background: fill
      }}
    />
  );
};
