import { useEffect, useState } from "react";

const DEMO_VIDEO_URL = import.meta.env.VITE_AGENT_NATIVE_DEMO_VIDEO_URL || "";

function VisualPlanDemoFallback() {
  return (
    <div className="flex h-full w-full flex-col bg-[var(--bg-secondary)] p-4 text-[var(--fg)] sm:p-5">
      <div className="flex items-center justify-between border-b border-[var(--docs-border)] pb-3">
        <div className="text-xs font-semibold uppercase text-[var(--docs-accent)]">
          Visual plan
        </div>
        <div className="rounded-full border border-[var(--docs-border)] px-2.5 py-1 text-[11px] text-[var(--fg-secondary)]">
          Ready
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 pt-4 md:grid-cols-[0.9fr_1.1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-lg border border-[var(--docs-border)] bg-black/20 p-3">
            <div className="mb-2 h-2 w-16 rounded-full bg-[var(--docs-accent)]/70" />
            <div className="space-y-2">
              <div className="h-2.5 w-4/5 rounded-full bg-[var(--fg-secondary)]/35" />
              <div className="h-2.5 w-3/5 rounded-full bg-[var(--fg-secondary)]/25" />
              <div className="h-2.5 w-2/3 rounded-full bg-[var(--fg-secondary)]/25" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--fg-secondary)]">
            <div className="rounded-lg border border-[var(--docs-border)] p-2">
              <div className="mb-1 h-1.5 w-8 rounded-full bg-[var(--fg-secondary)]/25" />
              4 blocks
            </div>
            <div className="rounded-lg border border-[var(--docs-border)] p-2">
              <div className="mb-1 h-1.5 w-8 rounded-full bg-[var(--fg-secondary)]/25" />
              2 notes
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-lg border border-[var(--docs-border)] bg-black/20 p-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--docs-accent)]" />
            <div className="h-2.5 w-24 rounded-full bg-[var(--fg-secondary)]/35" />
          </div>
          <div className="grid flex-1 gap-2">
            <div className="rounded border border-[var(--docs-border)] bg-[var(--docs-accent)]/10 p-2">
              <div className="h-2 w-3/5 rounded-full bg-[var(--docs-accent)]/70" />
            </div>
            <div className="rounded border border-[var(--docs-border)] p-2">
              <div className="h-2 w-4/5 rounded-full bg-[var(--fg-secondary)]/25" />
            </div>
            <div className="rounded border border-[var(--docs-border)] p-2">
              <div className="h-2 w-2/3 rounded-full bg-[var(--fg-secondary)]/25" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentNativeDemoVideo({
  className = "",
}: {
  className?: string;
}) {
  const [isReady, setIsReady] = useState(false);
  const [hasVideoError, setHasVideoError] = useState(false);
  const showVideo = Boolean(DEMO_VIDEO_URL) && !hasVideoError;

  useEffect(() => {
    if (!showVideo || isReady) return;
    const fallbackTimer = window.setTimeout(() => {
      setHasVideoError(true);
    }, 8000);

    return () => window.clearTimeout(fallbackTimer);
  }, [isReady, showVideo]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-[var(--docs-border)] bg-black ${className}`}
    >
      {showVideo ? (
        <video
          src={DEMO_VIDEO_URL}
          aria-label="Agent-Native visual planning demo"
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="auto"
          onCanPlay={() => setIsReady(true)}
          onLoadedData={() => setIsReady(true)}
          onPlaying={() => setIsReady(true)}
          onError={() => setHasVideoError(true)}
          className="block h-full w-full object-cover"
        />
      ) : (
        <VisualPlanDemoFallback />
      )}
      {showVideo ? (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-[var(--bg-secondary)] transition-opacity duration-300 ${
            isReady ? "opacity-0" : "opacity-100"
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
      ) : null}
    </div>
  );
}
