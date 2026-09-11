/**
 * The shared meter, wired to desktop capture.
 *
 * The shape and the level math live in `shared/live-waveform.tsx` with the web
 * app; only the transport is here, because that is the one part that genuinely
 * differs — Tauri emits `voice:audio-level`, the browser reads an
 * `AnalyserNode`. Anything visual belongs in the shared component so the two
 * apps cannot drift apart again.
 */

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  combinedMeterLevel,
  EMPTY_METER_SOURCES,
  foldMeterSources,
  type MeterSource,
  type MeterSourceLevels,
} from "../../../shared/audio-meter";
import { LiveWaveform as SharedLiveWaveform } from "../../../shared/live-waveform";

interface LiveWaveformProps {
  className?: string;
  bars?: number;
  barWidth?: number;
  barGap?: number;
  /** Drive from a caller-supplied level instead of capture events (demos). */
  level?: number | null;
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
  bars,
  barWidth,
  barGap,
  level = null,
  dimmed = false,
  sources = "all",
}: LiveWaveformProps) {
  const [captured, setCaptured] = useState<number | null>(null);
  const sourcesRef = useRef<MeterSourceLevels>(EMPTY_METER_SOURCES);
  const external = level !== null && level !== undefined;

  useEffect(() => {
    if (external) return;
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
        setCaptured(
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
      unlisten?.();
    };
  }, [external, sources]);

  return (
    <SharedLiveWaveform
      level={external ? level : captured}
      className={className}
      bars={bars}
      barWidth={barWidth}
      barGap={barGap}
      dimmed={dimmed}
    />
  );
}
