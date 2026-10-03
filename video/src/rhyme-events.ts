import type { TimedWord } from './types';

export type WordRef = { lineIndex: number; wordIndex: number };

export type RhymeEvent = WordRef & {
  family: number;
  time: number;
  countInFamily: number;
  previous: WordRef | null;
};

type MarkedWord = WordRef & { family: number; time: number };

function collectMarkedWords(timeline: TimedWord[][]): MarkedWord[] {
  const marked: MarkedWord[] = [];
  timeline.forEach((line, lineIndex) => {
    line.forEach((word, wordIndex) => {
      if (word.family === null) return;
      marked.push({ lineIndex, wordIndex, family: word.family, time: word.start });
    });
  });
  return marked.sort((a, b) => a.time - b.time);
}

// Every marked word in the order it is sung, with how many words of its family
// have landed so far and which one it answers.
export function rhymeEvents(timeline: TimedWord[][]): RhymeEvent[] {
  const lastInFamily = new Map<number, WordRef>();
  const counts = new Map<number, number>();
  return collectMarkedWords(timeline).map((word) => {
    const countInFamily = (counts.get(word.family) ?? 0) + 1;
    counts.set(word.family, countInFamily);
    const previous = lastInFamily.get(word.family) ?? null;
    lastInFamily.set(word.family, { lineIndex: word.lineIndex, wordIndex: word.wordIndex });
    return { ...word, countInFamily, previous };
  });
}
