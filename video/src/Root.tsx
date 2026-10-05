import React from 'react';
import { Composition, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';

import { ADELA_AINT_IN_LA_AUDIO, AdelaAintInLa } from './songs/adela-aint-in-la';
import { SOUND_2_AUDIO, Sound2 } from './songs/sound-2';
import { FPS, HEIGHT, WIDTH } from './theme';

type SongEntry = { id: string; component: React.FC; audioFile: string };

// One entry per song; the id is the slug render.mjs is called with.
const SONGS: SongEntry[] = [
  { id: 'sound-2', component: Sound2, audioFile: SOUND_2_AUDIO },
  { id: 'adela-aint-in-la', component: AdelaAintInLa, audioFile: ADELA_AINT_IN_LA_AUDIO }
];

async function frameCountFor(audioFile: string): Promise<{ durationInFrames: number }> {
  const seconds = await getAudioDurationInSeconds(staticFile(audioFile));
  return { durationInFrames: Math.ceil(seconds * FPS) };
}

export const Root: React.FC = () => (
  <>
    {SONGS.map((song) => (
      <Composition
        key={song.id}
        id={song.id}
        component={song.component}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={FPS}
        calculateMetadata={() => frameCountFor(song.audioFile)}
      />
    ))}
  </>
);
