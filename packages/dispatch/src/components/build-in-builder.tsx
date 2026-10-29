import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconExternalLink } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "./ui/button";

/**
 * A workspace linked to Builder builds its apps in Builder, so Dispatch links
 * there instead of offering its own create-app flow. Null when not linked.
 */
export function useBuilderWorkspaceUrl(): string | null {
  const { data } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  return data?.builderWorkspaceUrl ?? null;
}

function openBuilder(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function BuildInBuilderPanel({ url }: { url: string }) {
  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="text-sm font-medium text-foreground">
        Apps are built in Builder
      </div>
      <p className="text-sm text-muted-foreground">
        This workspace is managed in Builder. Create the app there, and it shows
        up here once it is published.
      </p>
      <Button className="self-start" onClick={() => openBuilder(url)}>
        Open in Builder
        <IconExternalLink size={14} />
      </Button>
    </div>
  );
}

/** For actions answered with `mode: "builder-managed"` by the server. */
export function notifyBuildInBuilder(url: string) {
  toast.info("Apps in this workspace are built in Builder", {
    action: { label: "Open in Builder", onClick: () => openBuilder(url) },
  });
}
