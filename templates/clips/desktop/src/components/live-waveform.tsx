/**
 * The product's one live audio meter.
 *
 * Every surface that shows how loud the room is right now renders this: the
 * record pill, the meeting pill, the dictation flow bar. Before it there were
 * three — a five-bar auto-gain meter, a three-bar meter with fixed per-bar
 * gains, and a canvas whose bars moved on a sine phase multiplied by the level,
 * which animated whether or not anyone was speaking.
 *
 * Bars inherit `currentColor` and the meter sizes from its own props, so a
 * caller styles it by setting a color on the parent rather than by forking it.
 */

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  advanceWaveform,
  combinedMeterLevel,
  createWaveformState,
  EMPTY_METER_SOURCES,
  foldMeterSources,
  waveformBarPx,
  WAVEFORM_BAR_COUNT,
  WAVEFORM_IDLE_MS,
  type MeterSource,
  type MeterSourceLevels,
} from "../lib/audio-meter";

interface LiveWaveformProps {
  className?: string;
  /** Bars, newest on the right. Defaults to the shared five. */
  bars?: number;
  /** Px per bar and the gap between them, for a denser or airier meter. */
  barWidth?: number;
  barGap?: number;
  /**
   * Drive the meter from a caller-supplied level instead of capture events.
   * Used by the demo harnesses, which have no audio pipeline behind them.
   */
  level?: number | null;
  /** Paused or stopped: hold the meter flat and dim rather than hiding it. */
  dimmed?: boolean;
  /**
   * Which capture to meter. "all" rides whichever of mic and system audio is
   * louder, which is what a meeting is; "mic" answers the narrower question a
   * recorder asks — am I being heard.
   */
  sources?: "all" | "mic";
}

export function LiveWaveform({
  className,
  bars = WAVEFORM_BAR_COUNT,
  barWidth = 2,
  barGap = 2,
  level = null,
  dimmed = false,
  sources = "all",
}: LiveWaveformProps) {
  const [samples, setSamples] = useState<number[]>(() =>
    new Array(bars).fill(0),
  );
  const stateRef = useRef(createWaveformState());
  const sourcesRef = useRef<MeterSourceLevels>(EMPTY_METER_SOURCES);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const external = level !== null && level !== undefined;

  useEffect(() => {
    const push = (raw: number) => {
      stateRef.current = advanceWaveform(stateRef.current, raw);
      setSamples(stateRef.current.history);
      if (idleRef.current) clearTimeout(idleRef.current);
      // Capture keeps emitting through silence, so this only fires on pause or
      // teardown — where a frozen tall bar would claim someone is still talking.
      idleRef.current = setTimeout(() => {
        stateRef.current = createWaveformState();
        setSamples(stateRef.current.history);
      }, WAVEFORM_IDLE_MS);
    };

    if (external) {
      push(level);
      return () => {
        if (idleRef.current) clearTimeout(idleRef.current);
      };
    }

    let stopped = false;
    let unlisten: (() => void) | null = null;
    // Mic and system audio interleave on one event and each decays on its own
    // frames: a shared level lets a silent mic halve whoever is actually
    // talking on every other event, which pins the meter to its floor.
    listen<{ level?: number; source?: MeterSource }>(
      "voice:audio-level",
      (event) => {
        const source: MeterSource =
          event.payload?.source === "system" ? "system" : "mic";
        if (sources === "mic" && source !== "mic") return;
        sourcesRef.current = foldMeterSources(
          sourcesRef.current,
          source,
          Number(event.payload?.level),
        );
        push(
          sources === "mic"
            ? sourcesRef.current.mic
            : combinedMeterLevel(sourcesRef.current),
        );
      },
    )
      .then((cleanup) => {
        if (stopped) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {});

    return () => {
      stopped = true;
      if (idleRef.current) clearTimeout(idleRef.current);
      unlisten?.();
    };
  }, [external, level, sources]);

  const shown = dimmed ? new Array(bars).fill(0) : samples;

  return (
    <span
      aria-hidden
      className={`live-waveform${className ? ` ${className}` : ""}`}
      style={{
        gap: `${barGap}px`,
        opacity: dimmed ? 0.3 : 1,
      }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          className="live-waveform-bar"
          style={{
            width: `${barWidth}px`,
            height: `${waveformBarPx(shown[i] ?? 0)}px`,
          }}
        />
      ))}
    </span>
  );
}
