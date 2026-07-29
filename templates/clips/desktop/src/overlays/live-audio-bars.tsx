import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  advanceMeterLevels,
  combinedMeterLevel,
  decayMeterLevel,
  EMPTY_METER_SOURCES,
  foldMeterSources,
  METER_BAR_COUNT,
  METER_BAR_GAINS,
  METER_IDLE_MS,
  meterBarHeight,
  type MeterSource,
  type MeterSourceLevels,
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
  const sourcesRef = useRef<MeterSourceLevels>(EMPTY_METER_SOURCES);
  const lastEventRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | null = null;

    const push = () =>
      setLevels((prev) =>
        advanceMeterLevels(prev, combinedMeterLevel(sourcesRef.current)),
      );

    // Drive the bars straight off the capture events rather than resampling on
    // a timer — both taps already emit at ~25 Hz, and a timer tick landing
    // between them just showed a decayed copy of a live level.
    listen<{ level?: number; source?: MeterSource }>(
      "voice:audio-level",
      (event) => {
        sourcesRef.current = foldMeterSources(
          sourcesRef.current,
          event.payload?.source === "system" ? "system" : "mic",
          Number(event.payload?.level),
        );
        lastEventRef.current = Date.now();
        push();
      },
    )
      .then((cleanup) => {
        if (stopped) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {});

    // Capture buffers keep arriving through silence, so they settle the meter on
    // their own. This only covers pause / teardown, where the events stop.
    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastEventRef.current < METER_IDLE_MS) return;
      if (combinedMeterLevel(sourcesRef.current) === 0) return;
      sourcesRef.current = {
        mic: decayMeterLevel(sourcesRef.current.mic),
        system: decayMeterLevel(sourcesRef.current.system),
      };
      push();
    }, METER_IDLE_MS);

    return () => {
      stopped = true;
      window.clearInterval(idleTimer);
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
            height: `calc(var(--meter-height) * ${(
              meterBarHeight(levels[index] ?? 0, index) / 100
            ).toFixed(3)})`,
          }}
        />
      ))}
    </span>
  );
}
