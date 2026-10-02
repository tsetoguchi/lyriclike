export type TimedWord = {
  text: string;
  raw: string;
  charStart: number;
  charEnd: number;
  start: number;
  end: number;
  isInterpolated: boolean;
  family: number | null;
  isSlant: boolean;
};

export type SongTimeline = {
  timeline: TimedWord[][];
  lineMatch: number[];
  overallMatch: number;
};

export type Theme = {
  colors: Record<string, string>;
  scheme: string[];
  fontFamily: string;
};
