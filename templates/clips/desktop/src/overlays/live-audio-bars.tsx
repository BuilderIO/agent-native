import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

const BAR_SHAPES = [0.52, 1, 0.68];
const LEVEL_DECAY = 0.78;
const EVENT_ATTACK_DECAY = 0.52;

interface LiveAudioBarsProps {
  className?: string;
  compact?: boolean;
}

/** Small Granola-style meter shared by the compact and expanded overlays. */
export function LiveAudioBars({
  className,
  compact = false,
}: LiveAudioBarsProps) {
  const [level, setLevel] = useState(0);
  const levelRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | null = null;

    const decayTimer = window.setInterval(() => {
      const next = levelRef.current * LEVEL_DECAY;
      levelRef.current = next < 0.01 ? 0 : next;
      setLevel(levelRef.current);
    }, 60);

    listen<{ level?: number }>("voice:audio-level", (event) => {
      const incoming = Number(event.payload?.level);
      if (!Number.isFinite(incoming)) return;
      const next = Math.max(
        levelRef.current * EVENT_ATTACK_DECAY,
        Math.max(0, Math.min(1, incoming)),
      );
      levelRef.current = next;
      setLevel(next);
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
      window.clearInterval(decayTimer);
      unlisten?.();
    };
  }, []);

  // Peak levels from speech taps are often quiet even when speech is clear.
  // A gentle curve keeps the meter responsive without turning background noise
  // into a full-height signal.
  const visualLevel = level > 0 ? Math.min(1, Math.pow(level, 0.52) * 1.08) : 0;
  const rootClassName = [
    "live-audio-bars",
    compact ? "live-audio-bars-compact" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={rootClassName} aria-hidden="true">
      {BAR_SHAPES.map((shape, index) => {
        const idleHeight = index === 1 ? 0.2 : 0.14;
        const height = Math.round(
          (idleHeight + visualLevel * shape * 0.8) * 100,
        );
        return (
          <span
            className="live-audio-bar"
            key={index}
            style={{ height: `${Math.max(12, height)}%` }}
          />
        );
      })}
    </span>
  );
}
