import { useEffect, useRef, type MutableRefObject } from "react";

// Number of bars in the live mic level meter.
export const WAVE_BARS = 18;

// How often the meter pushes a fresh sample (ms).
export const METER_INTERVAL_MS = 50;

// Map a 0..1 level to a bar height. The 10% floor keeps idle bars visible; the
// 1.3 gain lifts quiet speech to a readable height before the 100% clamp.
function levelToHeight(level: number): string {
  return `${Math.max(10, Math.min(100, level * 130))}%`;
}

function flatten(bars: (HTMLSpanElement | null)[]): void {
  for (const bar of bars) if (bar) bar.style.height = "10%";
}

function applyLevels(bars: (HTMLSpanElement | null)[], levels: number[]): void {
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar) bar.style.height = levelToHeight(levels[i] ?? 0);
  }
}

// Shared analyser config so local and relay modes sample identically.
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

// Read the analyser and bucket the usable FFT bins into `barCount` levels. The
// top ~30% of bins carry little voice energy, so we only sample the lower 70%.
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
    levels.push(data[idx] / 255);
  }
  return levels;
}

export function useMicMeter({
  active,
  deviceId,
}: {
  active: boolean;
  deviceId: string;
}): MutableRefObject<(HTMLSpanElement | null)[]> {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }
        audioCtx = new AudioContext();
        // A context created without a user gesture can start suspended, which
        // freezes the analyser at zero — resume before reading it.
        await audioCtx.resume();
        const { analyser, data } = createMeterAnalyser(audioCtx, stream);
        timer = setInterval(() => {
          applyLevels(barsRef.current, sampleLevels(analyser, data, WAVE_BARS));
        }, METER_INTERVAL_MS);
      } catch {
        flatten(barsRef.current);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active, deviceId]);

  return barsRef;
}
