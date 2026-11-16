import { useT } from "@agent-native/core/client/i18n";
import { IconBroadcast } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { FrameRecoveryControls } from "./FrameRecoveryControls";
import { REFERENCE_FRAME_LOAD_TIMEOUT_MS } from "./use-reference-frame-failure";

export function SharedTunnelPreview({
  url,
  active,
}: {
  url: string;
  active: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  if (new URL(url).origin === window.location.origin) return null;
  return (
    <TunnelFrame
      key={`${url}:${attempt}`}
      url={url}
      active={active}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function TunnelFrame({
  url,
  active,
  onRetry,
}: {
  url: string;
  active: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const [live, setLive] = useState(true);
  const [probe, setProbe] = useState<"checking" | "available" | "unavailable">(
    "checking",
  );
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (active) setProbe("unavailable");
    }, REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    setProbe("checking");
    void fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(
        () => {
          if (active) setProbe("available");
        },
        () => {
          if (active) setProbe("unavailable");
        },
      )
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [live, url]);
  const showLive = live && probe === "available";
  return (
    <>
      {showLive ? (
        <div
          inert
          hidden={!showLive}
          className="absolute inset-0 z-50 overflow-hidden bg-background"
        >
          <iframe
            tabIndex={-1}
            title={t("designEditor.livePreview.live")}
            src={url}
            // No allow-same-origin: a tunnel may redirect to this origin, and the
            // sandbox must stay opaque even then. Apps that need cookies or
            // storage lose them here; viewers fall back to the snapshot.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="pointer-events-none size-full border-0"
          />
        </div>
      ) : null}
      {live && probe === "unavailable" ? (
        <div
          role="status"
          className="absolute bottom-2 start-2 z-50 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
        >
          {t("designEditor.livePreview.unavailable")}
        </div>
      ) : null}
      <FrameRecoveryControls active={active}>
        <div className="flex items-center gap-2 rounded-md border bg-background p-1 shadow-sm">
          <IconBroadcast className="size-3.5 text-muted-foreground" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (showLive ? setLive(false) : onRetry())}
          >
            {t(
              showLive
                ? "designEditor.livePreview.suggest"
                : "designEditor.livePreview.live",
            )}
          </Button>
        </div>
      </FrameRecoveryControls>
    </>
  );
}
