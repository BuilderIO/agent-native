import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  AGENT_PROVIDER_CATALOG,
  AgentProviderSetupForm,
  SettingsGroup,
  SettingsRow,
  type AgentProviderId,
} from "@agent-native/core/client/settings";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import {
  IconBolt,
  IconCheck,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { SecretStatus } from "@/hooks/use-secret-status";

import type { BuilderConnection } from "./types";

export interface AiSetupSectionProps {
  builder: BuilderConnection;
  secrets: SecretStatus;
}

export function AiSetupSection({ builder, secrets }: AiSetupSectionProps) {
  const t = useT();
  const creditStatus = useActionQuery<BuilderCreditsStatus>(
    "get-builder-credit-status",
    undefined,
    { retry: false },
  );
  const [expanded, setExpanded] = useState(false);
  const configuredProviders = new Set<AgentProviderId>(
    AGENT_PROVIDER_CATALOG.filter(
      (provider) =>
        (provider.key && secrets.configured[provider.key]) ||
        (provider.endpointKey && secrets.configured[provider.endpointKey]),
    ).map((provider) => provider.id),
  );
  const configuredCount = configuredProviders.size;
  const creditsPaused = creditStatus.data?.exhausted === true;
  const upgradeUrl =
    creditStatus.data?.upgradeUrl ?? BUILDER_CREDITS_UPGRADE_URL;

  function openProviderSetup() {
    setExpanded(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("ai-provider-keys")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <SettingsGroup id="ai-providers" title={t("settings.apiSetup")}>
      {creditsPaused ? (
        <div className="flex items-center justify-between gap-3 px-5 py-3 text-amber-950 dark:text-amber-100">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBolt className="h-4 w-4 text-amber-700 dark:text-amber-200" />
            {t("builderCredits.pausedTitle")}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" className="h-8">
              <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
                <IconExternalLink className="h-4 w-4" />
                {t("builderCredits.upgrade")}
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-amber-300/80 bg-background/70 text-amber-950 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
              onClick={openProviderSetup}
            >
              {t("builderCredits.openAiSetup")}
            </Button>
          </div>
        </div>
      ) : null}

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SettingsRow
          label={t("settings.providerActionTitle")}
          description={t("settings.providerActionDescription")}
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {builder.connected ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <IconCheck className="h-4 w-4" />
                  Builder.io
                </span>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() =>
                    builder.start({
                      trackingSource: "clips_settings_ai_setup",
                      trackingFlow: "connect_llm",
                    })
                  }
                  disabled={builder.connecting || builder.loading}
                >
                  {builder.connecting ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {t("settings.connectBuilder")}
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {configuredCount > 0
                    ? t("settings.providerManage")
                    : t("settings.providerCustomKeys")}
                </Button>
              </CollapsibleTrigger>
            </div>
          }
        />
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border px-5 py-4">
            {secrets.loading ? (
              <div className="text-xs text-muted-foreground">
                {t("settings.checkingProviderKeys")}
              </div>
            ) : null}
            <AgentProviderSetupForm
              initialProvider="openrouter"
              configuredProviders={configuredProviders}
              layout="page"
              showTitle={false}
              onConnected={() => {
                void secrets.refresh();
                toast.success(t("settings.apiKeySaved"));
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SettingsGroup>
  );
}
