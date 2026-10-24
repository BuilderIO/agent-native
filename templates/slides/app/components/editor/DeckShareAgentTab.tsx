import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { lazy, Suspense } from "react";
import { useNavigate } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

const McpInstallActions = lazy(() =>
  import("@agent-native/toolkit/app/sharing").then((m) => ({
    default: m.McpInstallActions,
  })),
);

/**
 * The Agents tab of the Share panel. The shared panel already adds the deck's
 * temporary agent link below this; this adds how to connect an agent to Slides.
 */
export function DeckShareAgentTab({ deckId }: { deckId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const mcpSettingsRoute = buildSettingsRoute("mcp");
  return (
    <Suspense fallback={<Skeleton className="h-28 w-full" />}>
      <McpInstallActions
        heading={t("share.connectSlides")}
        otherClients={{
          label: t("share.otherAgents"),
          href: appPath(mcpSettingsRoute),
          onNavigate: () => void navigate(mcpSettingsRoute),
        }}
        onInstall={(client) =>
          trackEvent("mcp_install_link_opened", {
            resource_type: "deck",
            resource_id: deckId,
            client,
          })
        }
      />
    </Suspense>
  );
}
