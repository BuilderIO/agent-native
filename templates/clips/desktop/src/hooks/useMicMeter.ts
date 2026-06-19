import { useEffect, useRef, type MutableRefObject } from "react";
import { emit, listen } from "@tauri-apps/api/event";

// Number of bars in the live mic level meter. The popover sends this to the
// bubble page in relay mode so both sides agree on the sample count.
export const WAVE_BARS = 18;

// How often each mode pushes a fresh sample (ms). Both modes share this so the
// meter feels identical whether it runs locally or relays through the bubble.
export const METER_INTERVAL_MS = 50;

// Relay keepalive cadence (ms). The popover re-sends `clips:mic-meter-start` on
// this interval; the bubble treats repeats for the same device as a heartbeat
// and auto-stops its mic if they ever go quiet (see RELAY_STALE_MS in bubble).
export const METER_KEEPALIVE_MS = 1000;

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

/**
 * Drives a row of bars from live mic input so users can validate their mic.
 *
 * Two modes, because of WebKit's single-page capture-exclusion (Tauri runs
 * every webview in one WebKit process; when one page calls getUserMedia, capture
 * in OTHER pages is muted):
 *
 * The mic must open in whichever page owns the camera, or it gets muted:
 *
 *  - **local** (`relay === false`): the popover owns the camera (window/screen/
 *    camera modes) or no camera is live — opening the mic in this same page is
 *    safe, so we analyse it directly. Mirrors what the recorder does (camera +
 *    mic captured together in the popover).
 *  - **relay** (`relay === true`): the camera bubble owns a live capture in
 *    another page (native full-screen). Opening a mic here would black it out,
 *    so we ask the bubble page (same page as its camera → no mute) to run the
 *    analyser and emit level samples, which we just render.
 */
export function useMicMeter({
  active,
  deviceId,
  relay,
}: {
  active: boolean;
  deviceId: string;
  relay: boolean;
}): MutableRefObject<(HTMLSpanElement | null)[]> {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  // Local mode — open the mic in this page and analyse it.
  useEffect(() => {
    if (!active || relay) return;
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
  }, [active, relay, deviceId]);

  // Relay mode — the bubble page owns the mic and emits level samples.
  useEffect(() => {
    if (!active || !relay) return;
    let stopped = false;
    let levelUnlisten: (() => void) | null = null;

    const requestStart = () => {
      emit("clips:mic-meter-start", {
        micId: deviceId || null,
        bars: WAVE_BARS,
      }).catch(() => {});
    };

    // The first send may lose the race against the bubble webview mounting, and
    // the bubble auto-stops if these pings go quiet. Re-sending on a timer both
    // wins the mount race and doubles as the keepalive heartbeat.
    requestStart();
    const keepalive = setInterval(requestStart, METER_KEEPALIVE_MS);

    listen<{ levels?: number[] }>("clips:mic-level", (event) => {
      if (stopped) return;
      const levels = event.payload?.levels;
      if (Array.isArray(levels)) applyLevels(barsRef.current, levels);
    })
      .then((u) => {
        if (stopped) {
          u();
          return;
        }
        levelUnlisten = u;
      })
      .catch(() => {});

    return () => {
      stopped = true;
      clearInterval(keepalive);
      if (levelUnlisten) levelUnlisten();
      emit("clips:mic-meter-stop", {}).catch(() => {});
      flatten(barsRef.current);
    };
  }, [active, relay, deviceId]);

  return barsRef;
}
