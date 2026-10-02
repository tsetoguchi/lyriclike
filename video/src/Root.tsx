import React from 'react';
import { Composition, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';

import { SOUND_2_AUDIO, Sound2 } from './songs/sound-2';
import { FPS, HEIGHT, WIDTH } from './theme';

async function frameCountFor(audioFile: string): Promise<{ durationInFrames: number }> {
  const seconds = await getAudioDurationInSeconds(staticFile(audioFile));
  return { durationInFrames: Math.ceil(seconds * FPS) };
}

export const Root: React.FC = () => (
  <Composition
    id="sound-2"
    component={Sound2}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={FPS}
    calculateMetadata={() => frameCountFor(SOUND_2_AUDIO)}
  />
);
