import { useEffect, useRef, type MutableRefObject } from "react";

import { getAudioStreamWithFallback } from "../lib/media-capture-constraints";

export const WAVE_BARS = 10;

export const METER_INTERVAL_MS = 50;

const VIEW_W = 100;
const VIEW_H = 24;
const CENTER_Y = VIEW_H / 2;
const MAX_AMP = 11;
const FLAT_LINE = `M 0 ${CENTER_Y} L ${VIEW_W} ${CENTER_Y}`;
const activeMeterCleanups = new Set<() => void>();

export function stopAllMicMeters(): void {
  for (const stop of Array.from(activeMeterCleanups)) {
    stop();
  }
}

function buildWavePath(levels: number[]): string {
  const n = levels.length;
  if (n < 2) return FLAT_LINE;
  const pts = levels.map((lv, i) => {
    const x = (i / (n - 1)) * VIEW_W;
    const sign = i % 2 === 0 ? -1 : 1;
    const y = CENTER_Y + sign * Math.min(1, lv) * MAX_AMP;
    return { x, y };
  });
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`;
  }
  const last = pts[n - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

function drawWave(path: SVGPathElement | null, levels: number[]): void {
  if (path) path.setAttribute("d", buildWavePath(levels));
}

function flatten(path: SVGPathElement | null): void {
  if (path) path.setAttribute("d", FLAT_LINE);
}

export function createMeterAnalyser(
  ctx: AudioContext,
  stream: MediaStream,
): { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  return { analyser, data: new Uint8Array(analyser.frequencyBinCount) };
}

export function sampleLevels(
  analyser: AnalyserNode,
  data: Uint8Array<ArrayBuffer>,
  barCount: number,
): number[] {
  analyser.getByteFrequencyData(data);
  const usable = Math.floor(data.length * 0.7);
  const levels: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const idx = Math.min(usable - 1, Math.floor((i / barCount) * usable));
    levels.push(Math.min(1, (data[idx] / 255) * 1.65));
  }
  return levels;
}

export function useMicMeter({
  active,
  deviceId,
}: {
  active: boolean;
  deviceId: string;
}): MutableRefObject<SVGPathElement | null> {
  const pathRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (!active) {
      flatten(pathRef.current);
      return;
    }
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      cancelled = true;
      if (timer) clearInterval(timer);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (stream) stream.getTracks().forEach((t) => t.stop());
      activeMeterCleanups.delete(cleanup);
      flatten(pathRef.current);
    };
    activeMeterCleanups.add(cleanup);

    const start = async () => {
      try {
        stream = await getAudioStreamWithFallback(deviceId, undefined, false);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }
        audioCtx = new AudioContext();
        await audioCtx.resume();
        const { analyser, data } = createMeterAnalyser(audioCtx, stream);
        timer = setInterval(() => {
          drawWave(pathRef.current, sampleLevels(analyser, data, WAVE_BARS));
        }, METER_INTERVAL_MS);
      } catch {
        flatten(pathRef.current);
      }
    };

    void start();
    return cleanup;
  }, [active, deviceId]);

  return pathRef;
}
