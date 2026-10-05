import { makeLyricVideo } from '../LyricVideo';
import type { SongTimeline } from '../types';
import beatsJson from '../../songs/sound-2/beats.json';
import timelineJson from '../../songs/sound-2/timeline.json';

export const SOUND_2_AUDIO = 'audio/sound-2.wav';

export const Sound2 = makeLyricVideo({
  timeline: timelineJson as unknown as SongTimeline,
  beats: beatsJson.beats,
  audioFile: SOUND_2_AUDIO,
  syncOffsetSeconds: 0,
  lineOffsetSeconds: 0
});
