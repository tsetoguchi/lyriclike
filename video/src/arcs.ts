// Geometry for the arcs that join rhyming words. No imports, so node --test can
// load it directly.

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Arc = [Point, Point, Point, Point];

const SAME_ROW_RATIO = 0.5;
const LIFT_RATIO = 0.9;
const LIFT_PER_PIXEL = 0.25;
const UNDERLINE_CLEARANCE = 20;
const TOP_CLEARANCE = 6;
const LEVEL_RUN_PX = 10;

function arcOverTheTop(from: Box, to: Box): Arc {
  const start = { x: from.x + from.width / 2, y: from.y };
  const end = { x: to.x + to.width / 2, y: to.y };
  const lift = Math.max(from.height * LIFT_RATIO, Math.abs(end.x - start.x) * LIFT_PER_PIXEL);
  return [start, { x: start.x, y: start.y - lift }, { x: end.x, y: end.y - lift }, end];
}

// Leaves along the gap under the first word, swings out through the margin to the
// right of all the text, and comes back along the gap above the second word, so it
// never cuts through a word in between. Both controls share one x, chosen so the
// curve's midpoint reaches peakX.
function curveThroughTheMargin(from: Box, to: Box, peakX: number): Arc {
  const start = { x: from.x + from.width / 2, y: from.y + from.height + UNDERLINE_CLEARANCE };
  const end = { x: to.x + to.width / 2, y: to.y - TOP_CLEARANCE };
  const controlX = (peakX - (start.x + end.x) / 8) / 0.75;
  return [
    start,
    { x: controlX, y: start.y + LEVEL_RUN_PX },
    { x: controlX, y: end.y - LEVEL_RUN_PX },
    end
  ];
}

export function arcBetween(from: Box, to: Box, peakX: number): Arc {
  const isSameRow = Math.abs(to.y - from.y) < from.height * SAME_ROW_RATIO;
  return isSameRow ? arcOverTheTop(from, to) : curveThroughTheMargin(from, to, peakX);
}

export function cubicPoint(arc: Arc, t: number): Point {
  const [p0, p1, p2, p3] = arc;
  const u = 1 - t;
  const weight = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: weight[0] * p0.x + weight[1] * p1.x + weight[2] * p2.x + weight[3] * p3.x,
    y: weight[0] * p0.y + weight[1] * p1.y + weight[2] * p2.y + weight[3] * p3.y
  };
}

export function arcPath(arc: Arc): string {
  const [p0, p1, p2, p3] = arc;
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
}
