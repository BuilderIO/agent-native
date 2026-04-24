import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconCloud,
  IconExternalLink,
  IconLoader2,
  IconServer,
} from "@tabler/icons-react";
import { useBuilderEnabled } from "@agent-native/core/client";

function BuilderBMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 116 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M115.14 39C115.14 17.36 97.58 0 76.14 0H10.27C4.58002 0 0 4.62002 0 10.27C0 20.79 22.2899 28.78 22.2899 65C22.2899 101.22 0 109.21 0 119.73C0 125.38 4.58002 130 10.27 130H76.14C97.58 130 115.14 112.64 115.14 91C115.14 75.1 105.59 65.41 105.21 65C105.58 64.59 115.14 54.9 115.14 39ZM13.58 11.1504H76.14C83.58 11.1504 90.58 14.0501 95.84 19.3101C101.1 24.5701 104 31.5703 104 39.0103C104 46.4503 101.26 53.0102 96.38 58.1602L13.59 11.1504H13.58ZM95.83 110.7C90.57 115.96 83.57 118.86 76.13 118.86H13.5699L96.36 71.8501C101.24 77.0001 103.98 83.8 103.98 91C103.98 98.2 101.08 105.44 95.8199 110.7H95.83ZM25.7 99.1602C26.36 97.7802 33.4199 84.08 33.4199 65C33.4199 45.92 26.36 32.2203 25.7 30.8403L85.86 65L25.7 99.1602Z"
        fill="currentColor"
      />
    </svg>
  );
}

export interface StorageSetupCardProps {
  onConfigured: () => void;
}

export function StorageSetupCard({ onConfigured }: StorageSetupCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const builderEnabled = useBuilderEnabled();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const handleConnect = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setConnecting(true);
    setErr(null);

    window.open(
      `${window.location.origin}/_agent-native/builder/connect`,
      "_blank",
      "noopener,noreferrer",
    );

    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(
          `${window.location.origin}/_agent-native/builder/status`,
        );
        if (!r.ok) return;
        const s = (await r.json()) as { configured: boolean };
        if (!mountedRef.current) {
          stop();
          return;
        }
        if (s.configured) {
          stop();
          setConnecting(false);
          setConnected(true);
          setTimeout(() => onConfigured(), 800);
        } else if (Date.now() - start > timeoutMs) {
          stop();
          setConnecting(false);
          setErr(
            "Didn't hear back from Builder in 5 minutes. Check the popup and try again.",
          );
        }
      } catch {
        // transient poll error
      }
    }, 2000);
  }, [onConfigured]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <IconCloud className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Set up video storage</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect a storage provider to start recording clips.
        </p>
      </div>

      {/* Builder.io — primary option. Gated behind ENABLE_BUILDER so
          deployments without Builder access see a waitlist CTA instead
          of a path that won't work for them. */}
      {builderEnabled ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting || connected}
          className={
            "flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left " +
            (connected
              ? "border-primary/50 bg-primary/5"
              : "border-border bg-background hover:border-foreground/30")
          }
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            {connected ? (
              <IconCheck className="h-5 w-5" />
            ) : connecting ? (
              <IconLoader2 className="h-5 w-5 animate-spin" />
            ) : (
              <BuilderBMark className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {connected
                  ? "Builder.io connected"
                  : connecting
                    ? "Waiting for Builder..."
                    : "Connect Builder.io"}
              </span>
              {!connected && !connecting && (
                <>
                  <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Free
                  </span>
                  <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </>
              )}
            </div>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {connected
                ? "You're all set. Starting recorder..."
                : "One-click setup — also unlocks LLM and browser automation."}
            </span>
          </div>
        </button>
      ) : (
        <a
          href="https://forms.agent-native.com/f/builder-waitlist/36GWqf"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3.5 text-left hover:border-foreground/30"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <BuilderBMark className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                Builder.io — join waitlist
              </span>
              <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              One-click video storage is coming soon.
            </span>
          </div>
        </a>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* S3 — secondary option */}
      {!connected && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <IconServer className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <span className="text-sm text-muted-foreground">
              Or{" "}
              <a
                href="/settings"
                className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
              >
                configure S3-compatible storage
              </a>
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
