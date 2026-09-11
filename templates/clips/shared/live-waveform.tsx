/**
 * The product's one live audio meter, shared by the web app and the desktop
 * app.
 *
 * There were four: the record pill's five-bar auto-gain meter, the meeting
 * pill's three bars with fixed per-bar gains, the dictation bar's canvas whose
 * bars rode a sine phase (so they moved whether or not anyone was speaking),
 * and the web mic test's cyan oscilloscope. Same question on screen, four
 * answers.
 *
 * This component owns the shape and the level math only. Transport stays with
 * the caller — the desktop feeds it Tauri capture events, the web app feeds it
 * RMS off an `AnalyserNode` — because that is the one part that genuinely
 * differs. Everything visual is inline style plus `currentColor`, so it needs
 * no stylesheet from either app.
 */

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
  /**
   * The newest 0-1 level. Every change pushes one sample, so callers drive the
   * meter by updating this as their capture emits. `null` holds the meter at
   * rest, which is what a caller with no stream yet should pass.
   */
  level: number | null;
  className?: string;
  /** Bars, newest on the right. */
  bars?: number;
  barWidth?: number;
  barGap?: number;
  /** Paused or stopped: hold flat and dim rather than disappearing. */
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
    // A null level already rested the meter above. Arming the idle timer here
    // too would be harmless but pointless, and returning no cleanup keeps the
    // pending timer from the last real sample cancelled rather than rescheduled.
    if (level === null || level === undefined) return;
    // Capture keeps emitting through silence, so this only fires on pause or
    // teardown — where a frozen tall bar would claim someone is still talking.
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
        // The meter is this green everywhere. A surface overrides by setting
        // `--waveform`, or its own `color` on the wrapper. The literal is the
        // fallback for an app that has not declared the token yet.
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
            // Samples land roughly every 40ms. A longer, eased transition is
            // always retargeted mid-flight and never settles — that reads as
            // jitter rather than as a level moving. Linear and shorter than
            // the sample interval makes the bars one continuous motion.
            transition: "height 70ms linear",
          }}
        />
      ))}
    </span>
  );
}
