
import { useEffect, useRef, useState } from "react";

import {
  createWaveformState,
  nextWaveformState,
  waveformBarPx,
  WAVEFORM_BAR_COUNT,
  WAVEFORM_IDLE_MS,
  waveformWidth,
} from "./audio-meter";

export interface LiveWaveformProps {
  level: number | null;
  className?: string;
  bars?: number;
  barWidth?: number;
  barGap?: number;
  dimmed?: boolean;
}

export function LiveWaveform({
  level,
  className,
  bars = WAVEFORM_BAR_COUNT,
  barWidth = 2,
  barGap = 2,
  dimmed = false,
}: LiveWaveformProps) {
  const width = waveformWidth(bars);
  const [samples, setSamples] = useState<number[]>(() =>
    new Array(width).fill(0),
  );
  const stateRef = useRef(createWaveformState(bars));
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    stateRef.current = nextWaveformState(stateRef.current, level, bars);
    setSamples(stateRef.current.history);
    if (level === null || level === undefined) return;
    idleRef.current = setTimeout(() => {
      stateRef.current = createWaveformState(bars);
      setSamples(stateRef.current.history);
    }, WAVEFORM_IDLE_MS);
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [level, bars]);

  const shown = dimmed ? new Array(width).fill(0) : samples;

  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        gap: `${barGap}px`,
        opacity: dimmed ? 0.3 : 1,
        // guard:allow-raw-color — meter green is theme-invariant capture chrome
        color: "var(--waveform, #97c459)",
        transition: "opacity 150ms ease-out",
      }}
    >
      {Array.from({ length: width }, (_, i) => (
        <i
          key={i}
          style={{
            display: "block",
            width: `${barWidth}px`,
            height: `${waveformBarPx(shown[i] ?? 0)}px`,
            borderRadius: "999px",
            background: "currentColor",
            transition: "height 70ms linear",
          }}
        />
      ))}
    </span>
  );
}
