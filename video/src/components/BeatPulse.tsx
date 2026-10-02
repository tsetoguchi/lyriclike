import React from 'react';
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useAudioData, visualizeAudio } from '@remotion/media-utils';

const SAMPLE_COUNT = 32;
const BASS_BINS = 4;
const PULSE_STRENGTH = 0.05;

type BeatPulseProps = {
  audioFile: string;
  children: React.ReactNode;
};

function useBassLevel(audioFile: string): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile(audioFile));
  if (!audioData) return 0;
  const spectrum = visualizeAudio({ fps, frame, audioData, numberOfSamples: SAMPLE_COUNT });
  const bass = spectrum.slice(0, BASS_BINS);
  return bass.reduce((sum, level) => sum + level, 0) / BASS_BINS;
}

// The low end of the track nudges the card's scale, so the page breathes with the beat.
export const BeatPulse: React.FC<BeatPulseProps> = ({ audioFile, children }) => {
  const level = useBassLevel(audioFile);
  return <div style={{ transform: `scale(${1 + level * PULSE_STRENGTH})` }}>{children}</div>;
};
