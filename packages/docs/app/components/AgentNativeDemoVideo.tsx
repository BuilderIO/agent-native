import { useState } from "react";

const DEMO_VIDEO_URL = import.meta.env.VITE_AGENT_NATIVE_DEMO_VIDEO_URL || "";

export function AgentNativeDemoVideo({
  className = "",
}: {
  className?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-[var(--docs-border)] bg-black ${className}`}
    >
      {DEMO_VIDEO_URL ? (
        <video
          src={DEMO_VIDEO_URL}
          aria-label="Agent-Native visual planning demo"
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="auto"
          onPlaying={() => setIsPlaying(true)}
          onWaiting={() => setIsPlaying(false)}
          className="block h-full w-full object-cover"
        />
      ) : null}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-[var(--bg-secondary)] transition-opacity duration-300 ${
          isPlaying ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex h-full w-full animate-pulse flex-col justify-between p-5">
          <div className="space-y-3">
            <div className="h-4 w-2/5 rounded-full bg-[var(--docs-border)]" />
            <div className="h-3 w-3/4 rounded-full bg-[var(--docs-border)]" />
            <div className="h-3 w-1/2 rounded-full bg-[var(--docs-border)]" />
          </div>
          <div className="grid gap-3">
            <div className="h-28 rounded-lg bg-[var(--docs-border)]/70" />
            <div className="h-16 rounded-lg bg-[var(--docs-border)]/50" />
          </div>
          <div className="h-8 w-1/3 rounded-full bg-[var(--docs-border)]" />
        </div>
      </div>
    </div>
  );
}
