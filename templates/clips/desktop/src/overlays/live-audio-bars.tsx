import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

const BAR_GAINS = [0.72, 1, 0.84];
const BAR_COUNT = BAR_GAINS.length;
const LEVEL_DECAY = 0.82;
const EVENT_ATTACK_DECAY = 0.55;
const IDLE_HEIGHT = 0.14;
const SAMPLE_MS = 50;

interface LiveAudioBarsProps {
  className?: string;
  compact?: boolean;
}

/** Small Granola-style meter shared by the compact and expanded overlays. */
export function LiveAudioBars({
  className,
  compact = false,
}: LiveAudioBarsProps) {
  const [levels, setLevels] = useState<number[]>(() =>
    new Array(BAR_COUNT).fill(0),
  );
  const levelRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | null = null;

    const sampleTimer = window.setInterval(() => {
      const current = levelRef.current;
      const decayed = current * LEVEL_DECAY;
      levelRef.current = decayed < 0.01 ? 0 : decayed;
      // Newest sample enters at the first bar and travels across the meter, so
      // the bars ripple against each other instead of moving as one block.
      setLevels((prev) => [current, ...prev.slice(0, BAR_COUNT - 1)]);
    }, SAMPLE_MS);

    listen<{ level?: number }>("voice:audio-level", (event) => {
      const incoming = Number(event.payload?.level);
      if (!Number.isFinite(incoming)) return;
      levelRef.current = Math.max(
        levelRef.current * EVENT_ATTACK_DECAY,
        Math.max(0, Math.min(1, incoming)),
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
      {BAR_GAINS.map((gain, index) => {
        // Peak levels from speech taps are often quiet even when speech is
        // clear. A gentle curve keeps the meter responsive without turning
        // background noise into a full-height signal.
        const level = levels[index] ?? 0;
        const shaped =
          level > 0 ? Math.min(1, Math.pow(level, 0.52) * 1.08) : 0;
        const height = (IDLE_HEIGHT + shaped * gain * (1 - IDLE_HEIGHT)) * 100;
        return (
          <span
            className="live-audio-bar"
            key={index}
            style={{ height: `${Math.round(height)}%` }}
          />
        );
      })}
    </span>
  );
}
