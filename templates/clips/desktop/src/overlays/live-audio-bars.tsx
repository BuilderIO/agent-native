import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  advanceMeterLevels,
  decayMeterLevel,
  METER_BAR_COUNT,
  METER_BAR_GAINS,
  METER_SAMPLE_MS,
  meterBarHeight,
  nextMeterLevel,
} from "../lib/audio-meter";

interface LiveAudioBarsProps {
  className?: string;
  compact?: boolean;
}

/**
 * Small Granola-style meter shared by the compact and expanded overlays. The
 * bars track how loud the meeting actually is — mic and system audio both feed
 * `voice:audio-level`, and the meter rides whichever is louder.
 */
export function LiveAudioBars({
  className,
  compact = false,
}: LiveAudioBarsProps) {
  const [levels, setLevels] = useState<number[]>(() =>
    new Array(METER_BAR_COUNT).fill(0),
  );
  const levelRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | null = null;

    const sampleTimer = window.setInterval(() => {
      const current = levelRef.current;
      levelRef.current = decayMeterLevel(current);
      setLevels((prev) => advanceMeterLevels(prev, current));
    }, METER_SAMPLE_MS);

    listen<{ level?: number }>("voice:audio-level", (event) => {
      levelRef.current = nextMeterLevel(
        levelRef.current,
        Number(event.payload?.level),
      );
    })
      .then((cleanup) => {
        if (stopped) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {});

    return () => {
      stopped = true;
      window.clearInterval(sampleTimer);
      unlisten?.();
    };
  }, []);

  const rootClassName = [
    "live-audio-bars",
    compact ? "live-audio-bars-compact" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={rootClassName} aria-hidden="true">
      {METER_BAR_GAINS.map((_gain, index) => (
        <span
          className="live-audio-bar"
          key={index}
          style={{
            height: `${Math.round(meterBarHeight(levels[index] ?? 0, index))}%`,
          }}
        />
      ))}
    </span>
  );
}
