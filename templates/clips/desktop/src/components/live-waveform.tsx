
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
  level?: number | null;
  dimmed?: boolean;
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
