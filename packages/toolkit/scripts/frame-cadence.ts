import assert from "node:assert/strict";

export function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("No frames were measured.");
  return sorted[Math.ceil(sorted.length * q) - 1];
}

export function frameStats(
  run: { frameTimes: number[]; duration: number },
  period: number,
) {
  const times = run.frameTimes.filter(
    (time) => time >= 0 && time <= run.duration,
  );
  assert.ok(times.length >= 2, "Fewer than two frames during the drag.");
  const dt = times.slice(1).map((v, i) => v - times[i]);
  const edges = [0, ...times, run.duration];
  let worstGapMs = 0;
  let worstGapStartMs = 0;
  let missed = 0,
    longest = 0,
    consecutive = 0;
  for (let i = 1; i < edges.length; i++) {
    const v = edges[i] - edges[i - 1];
    if (v > worstGapMs) {
      worstGapMs = v;
      worstGapStartMs = edges[i - 1];
    }
    const lost = Math.max(0, Math.round(v / period) - 1);
    missed += lost;
    consecutive = lost ? consecutive + lost : 0;
    longest = Math.max(longest, consecutive);
  }
  return {
    intervals: dt.length,
    averageHz: (1000 * times.length) / run.duration,
    firstFrameMs: times[0],
    lastFrameToReleaseMs: run.duration - times[times.length - 1],
    medianMs: percentile(dt, 0.5),
    p95Ms: percentile(dt, 0.95),
    p99Ms: percentile(dt, 0.99),
    maxMs: Math.max(...dt),
    estimatedMissedFrames: missed,
    estimatedMissedPercent: (100 * missed) / (dt.length + missed),
    worstGapMs,
    worstGapStartMs,
    longestGapMissedFrames: Math.max(0, Math.round(worstGapMs / period) - 1),
    missedDuringLongestDegradedStreak: longest,
  };
}

export function sweepWidths(
  widths: number[],
  frameTimes: number[],
  sampleStride: number,
  sweepCount: number,
  sweepMs: number,
) {
  assert.equal(widths.length, Math.ceil(frameTimes.length / sampleStride));
  const groups = Array.from({ length: sweepCount }, (): number[] => []);
  widths.forEach((width, index) => {
    const sweep = Math.floor(frameTimes[index * sampleStride] / sweepMs);
    groups[sweep]?.push(width);
  });
  return groups;
}
