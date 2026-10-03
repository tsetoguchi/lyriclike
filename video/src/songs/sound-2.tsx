import React from 'react';
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from 'remotion';

import { AmbientBackdrop } from '../components/AmbientBackdrop';
import { CtaBar } from '../components/CtaBar';
import { ScrollingLyrics } from '../components/ScrollingLyrics';
import { useAppFonts } from '../fonts';
import { OUTRO_SECONDS } from '../outro';
import { rhymeEvents } from '../rhyme-events';
import timelineJson from '../../songs/sound-2/timeline.json';
import type { SongTimeline } from '../types';

export const SOUND_2_AUDIO = 'audio/sound-2.wav';

const SONG = timelineJson as unknown as SongTimeline;
const EVENTS = rhymeEvents(SONG.timeline);
const CTA_LABEL = 'Trace your rhymes · lyriclike.com';
const CTA_LEAD_SECONDS = 2.2;

export const Sound2: React.FC = () => {
  const areFontsReady = useAppFonts();
  const { durationInFrames, fps } = useVideoConfig();
  const ctaAppearsAt = durationInFrames / fps - Math.max(CTA_LEAD_SECONDS, OUTRO_SECONDS);

  return (
    <AbsoluteFill>
      <Audio src={staticFile(SOUND_2_AUDIO)} />
      <AmbientBackdrop events={EVENTS} />
      <ScrollingLyrics lines={SONG.timeline} events={EVENTS} areFontsReady={areFontsReady} />
      <CtaBar appearAtSecond={ctaAppearsAt} label={CTA_LABEL} />
    </AbsoluteFill>
  );
};
