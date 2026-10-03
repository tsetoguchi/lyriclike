import React from 'react';
import { random, useCurrentFrame, useVideoConfig } from 'remotion';

import type { RhymeEvent } from '../rhyme-events';
import { markColor } from '../theme';
import { wordKey } from '../useSheetLayout';
import type { SheetLayout } from '../useSheetLayout';

const BURST_SECONDS = 0.6;
const SPARK_COUNT = 14;
const RING_START_RADIUS = 30;
const RING_GROWTH = 100;
const RING_WIDTH = 5;
const SPARK_MIN_DISTANCE = 70;
const SPARK_SPREAD = 110;
const SPARK_SIZE = 12;

type RhymeBurstProps = {
  events: RhymeEvent[];
  layout: SheetLayout;
};

function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

type SparkProps = { event: RhymeEvent; index: number; cx: number; cy: number; progress: number; color: string };

const Spark: React.FC<SparkProps> = ({ event, index, cx, cy, progress, color }) => {
  const seed = `spark-${event.lineIndex}-${event.wordIndex}-${index}`;
  const angle = random(seed) * 2 * Math.PI;
  const distance = (SPARK_MIN_DISTANCE + random(`${seed}-d`) * SPARK_SPREAD) * easeOut(progress);
  const size = SPARK_SIZE * (1 - progress);
  return (
    <div
      style={{
        position: 'absolute',
        left: cx + Math.cos(angle) * distance - size / 2,
        top: cy + Math.sin(angle) * distance - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 12px ${color}`,
        opacity: 1 - progress
      }}
    />
  );
};

// A ring and a spray of sparks in the family's colour when a rhyme completes.
export const RhymeBurst: React.FC<RhymeBurstProps> = ({ events, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  return (
    <>
      {events.filter((event) => event.countInFamily >= 2).map((event) => {
        const box = layout.wordBoxes[wordKey(event.lineIndex, event.wordIndex)];
        const color = markColor(event.family);
        const progress = (seconds - event.time) / BURST_SECONDS;
        if (!box || !color || progress < 0 || progress > 1) return null;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const radius = RING_START_RADIUS + RING_GROWTH * easeOut(progress);
        return (
          <React.Fragment key={wordKey(event.lineIndex, event.wordIndex)}>
            <div
              style={{
                position: 'absolute',
                left: cx - radius,
                top: cy - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: '50%',
                border: `${RING_WIDTH}px solid ${color}`,
                opacity: 1 - progress
              }}
            />
            {Array.from({ length: SPARK_COUNT }, (_, index) => (
              <Spark key={index} event={event} index={index} cx={cx} cy={cy} progress={progress} color={color} />
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
};
