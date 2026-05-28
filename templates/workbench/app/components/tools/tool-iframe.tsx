import { useEffect, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { agentNativePath } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ToolIframeProps {
  toolId: string;
  toolName: string;
  /** Cache-busting key — pass the tool's `updatedAt` so saves re-render. */
  version?: string | null;
  /** Manual reload counter — bump to force a hard reload. */
  refreshKey?: number;
  /** When non-zero, the iframe's pointer-events are disabled. Use this to let
   *  overlay popovers (e.g. Share) receive their own clicks since the iframe
   *  would otherwise swallow them. */
  blockPointerEvents?: number;
  className?: string;
}

/**
 * Renders a Custom Tool's Alpine.js HTML inside a sandboxed iframe loaded
 * from `/_agent-native/extensions/:id/render`. Mirrors the parent app's
 * light/dark mode by passing `?dark=…` on first paint and `postMessage`-ing
 * theme updates afterwards.
 *
 * Loading state is rendered above the iframe so the chrome doesn't flash.
 * Errors are exposed as a retry surface (rare — the render endpoint always
 * returns HTML, even for missing tools, but we still guard against an
 * outright iframe load failure).
 */
export function ToolIframe({
  toolId,
  toolName,
  version,
  refreshKey = 0,
  blockPointerEvents = 0,
  className,
}: ToolIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the parent document's theme class — when it flips, post a message
  // to the iframe so the body can re-render in the new theme without a hard
  // reload.
  useEffect(() => {
    if (typeof document === "undefined") return;
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "agent-native-theme-update",
        isDark: document.documentElement.classList.contains("dark"),
      },
      "*",
    );
  }, [isDark, ready]);

  const src = useMemo(
    () =>
      agentNativePath(
        `/_agent-native/extensions/${encodeURIComponent(
          toolId,
        )}/render?dark=${isDark ? "true" : "false"}&v=${encodeURIComponent(
          version ?? "",
        )}&r=${refreshKey}`,
      ),
    [toolId, isDark, version, refreshKey],
  );

  // Reset ready/error state whenever the iframe is about to remount.
  useEffect(() => {
    setReady(false);
    setError(null);
  }, [src]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {!ready && !error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <IconLoader2
            className="size-5 animate-spin text-muted-foreground"
            role="status"
            aria-label={`Loading ${toolName}`}
          />
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <IconAlertTriangle className="size-8 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Couldn't load this tool
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              // Re-assign the same src to trigger a fresh load.
              const cur = iframeRef.current;
              if (cur) cur.src = src;
            }}
            className="cursor-pointer"
          >
            Retry
          </Button>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        key={src}
        src={src}
        title={toolName}
        sandbox="allow-scripts allow-forms"
        className="h-full w-full border-0 bg-background"
        style={{
          pointerEvents: blockPointerEvents > 0 ? "none" : "auto",
        }}
        onLoad={() => {
          // Give Alpine a beat to mount so we don't unblur a blank frame.
          setTimeout(() => setReady(true), 120);
        }}
        onError={() => setError("The tool failed to load.")}
      />
    </div>
  );
}
