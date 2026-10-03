import { OUTRO_STAGGER_SECONDS } from './outro.ts';
import type { TimedWord } from './types';

export function wordKey(lineIndex: number, wordIndex: number): string {
  return `${lineIndex}-${wordIndex}`;
}

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

export type WordMaps = {
  landings: Set<string>;
  outroDelays: Record<string, number>;
};

// Which words complete a rhyme, and when each rhyme word takes its turn in the
// closing wave.
export function buildWordMaps(events: RhymeEvent[]): WordMaps {
  const landings = new Set<string>();
  const outroDelays: Record<string, number> = {};
  events.forEach((event, order) => {
    const key = wordKey(event.lineIndex, event.wordIndex);
    if (event.countInFamily >= 2) landings.add(key);
    outroDelays[key] = order * OUTRO_STAGGER_SECONDS;
  });
  return { landings, outroDelays };
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
