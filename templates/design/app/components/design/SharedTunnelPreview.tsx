import { useT } from "@agent-native/core/client/i18n";
import { IconBroadcast } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { FrameRecoveryControls } from "./FrameRecoveryControls";
import { useReferenceFrameFailure } from "./use-reference-frame-failure";

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
  const [loaded, setLoaded] = useState(false);
  // Browsers rarely fire iframe `error` for a stopped tunnel, so an unloaded
  // frame times out to the snapshot; a late load still reveals it.
  const { failed, markFailed } = useReferenceFrameFailure({
    url,
    eligible: live,
    loaded,
  });
  const showLive = live && !failed;
  return (
    <>
      {live ? (
        <div
          inert
          hidden={!showLive}
          className="absolute inset-0 z-50 overflow-hidden bg-background"
        >
          <iframe
            tabIndex={-1}
            title={t("designEditor.livePreview.live")}
            src={url}
            onLoad={() => setLoaded(true)}
            onError={markFailed}
            // No allow-same-origin: a tunnel may redirect to this origin, and the
            // sandbox must stay opaque even then. Apps that need cookies or
            // storage lose them here; viewers fall back to the snapshot.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="pointer-events-none size-full border-0"
          />
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
