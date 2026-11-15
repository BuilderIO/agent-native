import { useT } from "@agent-native/core/client/i18n";
import { IconBroadcast } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { FrameRecoveryControls } from "./FrameRecoveryControls";

export function SharedTunnelPreview({
  url,
  active,
}: {
  url: string;
  active: boolean;
}) {
  const t = useT();
  const [live, setLive] = useState(true);
  if (new URL(url).origin === window.location.origin) return null;
  return (
    <>
      {live ? (
        <div
          inert
          className="absolute inset-0 z-50 overflow-hidden bg-background"
        >
          <iframe
            tabIndex={-1}
            title={t("designEditor.livePreview.live")}
            src={url}
            onError={() => setLive(false)}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            className="pointer-events-none size-full border-0"
          />
        </div>
      ) : null}
      <FrameRecoveryControls active={active}>
        <div className="flex items-center gap-2 rounded-md border bg-background p-1 shadow-sm">
          <IconBroadcast className="size-3.5 text-muted-foreground" />
          <Button size="sm" variant="ghost" onClick={() => setLive(!live)}>
            {t(
              live
                ? "designEditor.livePreview.suggest"
                : "designEditor.livePreview.live",
            )}
          </Button>
        </div>
      </FrameRecoveryControls>
    </>
  );
}
