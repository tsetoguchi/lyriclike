import { makeLyricVideo } from '../LyricVideo';
import type { SongTimeline } from '../types';
import beatsJson from '../../songs/adela-aint-in-la/beats.json';
import timelineJson from '../../songs/adela-aint-in-la/timeline.json';

export const ADELA_AINT_IN_LA_AUDIO = 'audio/adela-aint-in-la.wav';

export const AdelaAintInLa = makeLyricVideo({
  timeline: timelineJson as unknown as SongTimeline,
  beats: beatsJson.beats,
  audioFile: ADELA_AINT_IN_LA_AUDIO,
  syncOffsetSeconds: 0,
  lineOffsetSeconds: 0,
  censored: { bitches: 'b*tches' }
});
