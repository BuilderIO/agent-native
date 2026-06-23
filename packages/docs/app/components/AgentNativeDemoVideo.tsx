import { useState } from "react";

const DEMO_VIDEO_URL =
  "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F99ec814b12784b1885742a1c82d9dcf5?alt=media&token=e164a53f-ae25-41f9-b8fb-a58937a4d370"; // ggignore: public Builder CDN media token

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
