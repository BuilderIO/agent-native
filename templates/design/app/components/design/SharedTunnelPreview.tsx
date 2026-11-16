import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function SharedTunnelPreview({ url }: { url: string }) {
  const t = useT();
  const hostname = new URL(url).hostname;
  return (
    <div className="absolute bottom-2 start-2 z-50 rounded-md border bg-background p-1 shadow-sm">
      <Button asChild size="sm" variant="ghost">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <IconExternalLink className="size-3.5" />
          {t("designEditor.livePreview.openLive", { hostname })}
        </a>
      </Button>
    </div>
  );
}
