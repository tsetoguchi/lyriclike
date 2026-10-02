import React from 'react';
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { AmbientBackdrop } from '../components/AmbientBackdrop';
import { BeatPulse } from '../components/BeatPulse';
import { CtaBar } from '../components/CtaBar';
import { LyricCard } from '../components/LyricCard';
import { Wordmark } from '../components/Wordmark';
import { useAppFonts } from '../fonts';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../theme';
import timelineJson from '../../songs/sound-2/timeline.json';
import type { SongTimeline } from '../types';

export const SOUND_2_AUDIO = 'audio/sound-2.wav';

const SONG = timelineJson as unknown as SongTimeline;
const SLOW_ZOOM = 1.05;
const CTA_LEAD_SECONDS = 2.2;
const CTA_LABEL = 'Trace your rhymes · lyriclike.com';

export const Sound2: React.FC = () => {
  useAppFonts();
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, SLOW_ZOOM]);

  return (
    <AbsoluteFill>
      <Audio src={staticFile(SOUND_2_AUDIO)} />
      <AmbientBackdrop />
      <Wordmark />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: CONTENT_TOP,
          paddingBottom: CONTENT_BOTTOM,
          transform: `scale(${zoom})`
        }}
      >
        <BeatPulse audioFile={SOUND_2_AUDIO}>
          <LyricCard lines={SONG.timeline} />
        </BeatPulse>
      </AbsoluteFill>
      <CtaBar appearAtSecond={durationInFrames / fps - CTA_LEAD_SECONDS} label={CTA_LABEL} />
    </AbsoluteFill>
  );
};
