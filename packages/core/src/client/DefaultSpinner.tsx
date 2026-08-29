import { CubeLoader } from "@agent-native/toolkit/ui/cube-loader";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LOADING_LABELS } from "../shared/loading-labels.js";

const LOADING_LABEL_INTERVAL_MS = 3_000;
const LOADING_SHIMMER_DURATION_MS = 2_600;

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

declare global {
  interface Window {
    __agentNativeLoadingLabelIndex?: number;
  }
}

function getInitialLoadingLabelIndex(): number {
  if (typeof window === "undefined") return 0;
  const index = window.__agentNativeLoadingLabelIndex;
  return typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < LOADING_LABELS.length
    ? index
    : 0;
}

function getRandomLoadingLabelIndex(): number {
  return Math.floor(Math.random() * LOADING_LABELS.length);
}

/**
 * Full-screen loading spinner rendered during SSR and initial hydration.
 * Uses inline layout because Tailwind may not be loaded yet on the server.
 * Respects the user's OS color scheme so dark-mode users don't get a white flash.
 */

export function DefaultSpinner({
  ariaLabel = "Loading",
}: {
  ariaLabel?: string;
}) {
  const [loadingLabelIndex, setLoadingLabelIndex] = useState(
    getInitialLoadingLabelIndex,
  );
  const loadingLabelRef = useRef<HTMLSpanElement>(null);

  useBrowserLayoutEffect(() => {
    const loadingLabel = loadingLabelRef.current;
    if (!loadingLabel) return;

    const width = loadingLabel.scrollWidth;
    if (width > 0) {
      loadingLabel.style.width = `${width}px`;
    }
    loadingLabel.style.animationDelay = `-${window.performance.now() % LOADING_SHIMMER_DURATION_MS}ms`;
  }, [loadingLabelIndex]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.__agentNativeLoadingLabelIndex === undefined
    ) {
      setLoadingLabelIndex(getRandomLoadingLabelIndex());
    }
    if (typeof window !== "undefined") {
      delete window.__agentNativeLoadingLabelIndex;
    }

    const interval = window.setInterval(() => {
      setLoadingLabelIndex((index) => (index + 1) % LOADING_LABELS.length);
    }, LOADING_LABEL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <CubeLoader aria-label={ariaLabel} className="size-6" />
        <span
          ref={loadingLabelRef}
          data-agent-native-loading-label="true"
          className="agent-running-shimmer agent-loading-label"
          style={{
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 500,
            opacity: 0.65,
          }}
        >
          {LOADING_LABELS[loadingLabelIndex]}
        </span>
      </div>
      <style>{`
        html {
          background: hsl(var(--background, 0 0% 100%));
          color: hsl(var(--foreground, 240 10% 3.9%));
        }
        @media (prefers-color-scheme: dark) {
          html {
            background: hsl(var(--background, 240 10% 3.9%));
            color: hsl(var(--foreground, 0 0% 98%));
          }
        }
      `}</style>
    </div>
  );
}
