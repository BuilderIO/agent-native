import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "./ui/button";

/**
 * A workspace linked to Builder builds its apps in Builder, so Dispatch links
 * there instead of offering its own create-app flow. Null when not linked,
 * undefined until known: callers show no create flow until it resolves.
 */
export function useBuilderWorkspaceUrl(): string | null | undefined {
  const { data, isError } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  if (data) return data.builderWorkspaceUrl ?? null;
  // A failed lookup falls back to the normal flow; the server still refuses
  // to create apps for a linked workspace.
  return isError ? null : undefined;
}

function openBuilder(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function BuildInBuilderPanel({ url }: { url: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="text-sm font-medium text-foreground">
        {t("dispatch.pages.buildInBuilderTitle", {
          defaultValue: "Apps are built in Builder",
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("dispatch.pages.buildInBuilderBody", {
          defaultValue:
            "This workspace is managed in Builder. Create the app there, and it shows up here once it is published.",
        })}
      </p>
      <Button className="self-start" onClick={() => openBuilder(url)}>
        {t("dispatch.pages.openInBuilder", { defaultValue: "Open in Builder" })}
        <IconExternalLink size={14} />
      </Button>
    </div>
  );
}

/** For actions answered with `mode: "builder-managed"` by the server. */
export function useNotifyBuildInBuilder(): (url: string) => void {
  const t = useT();
  return useCallback(
    (url: string) => {
      toast.info(
        t("dispatch.pages.buildInBuilderTitle", {
          defaultValue: "Apps are built in Builder",
        }),
        {
          action: {
            label: t("dispatch.pages.openInBuilder", {
              defaultValue: "Open in Builder",
            }),
            onClick: () => openBuilder(url),
          },
        },
      );
    },
    [t],
  );
}
