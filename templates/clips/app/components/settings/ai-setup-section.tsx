import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import {
  AGENT_PROVIDER_CATALOG,
  AgentProviderSetupForm,
  BuilderConnectPopover,
  ProviderDialog,
  SettingsGroup,
  SettingsRow,
  type AgentProviderId,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import { IconBolt, IconCheck, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
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
  // With the redesign on, the provider dialog adds keys and Model manages them.
  const redesign = useFeatureFlag(SETTINGS_REDESIGN_FLAG.key);
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
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
    if (redesign) {
      if (configuredCount > 0) void navigate(buildSettingsRoute("model"));
      else setDialogOpen(true);
      return;
    }
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
        <SettingsRow
          icon={<IconBolt />}
          label={t("builderCredits.pausedTitle")}
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
                  <IconExternalLink />
                  {t("builderCredits.upgrade")}
                </a>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openProviderSetup}
              >
                {t("builderCredits.openAiSetup")}
              </Button>
            </div>
          }
        />
      ) : null}

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SettingsRow
          label={t("settings.providerActionTitle")}
          description={t("settings.providerActionDescription")}
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {builder.connected ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <IconCheck className="size-4" aria-hidden="true" />
                  Builder.io
                </span>
              ) : (
                <BuilderConnectPopover
                  flow={builder.connectFlow}
                  onConnect={(provisionAccount) =>
                    builder.start({
                      provisionAccount,
                      trackingSource: "clips_settings_ai_setup",
                      trackingFlow: "connect_llm",
                    })
                  }
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={builder.connecting || builder.loading}
                  >
                    {builder.connecting ? <Spinner /> : null}
                    {t("settings.connectBuilder")}
                  </Button>
                </BuilderConnectPopover>
              )}
              {redesign ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={openProviderSetup}
                >
                  {configuredCount > 0
                    ? t("settings.providerManage")
                    : t("settings.providerCustomKeys")}
                </Button>
              ) : (
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="secondary" size="sm">
                    {configuredCount > 0
                      ? t("settings.providerManage")
                      : t("settings.providerCustomKeys")}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          }
        />
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:px-6">
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
      {redesign ? (
        <ProviderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode="add"
          onSaved={() => {
            void secrets.refresh();
            toast.success(t("settings.apiKeySaved"));
          }}
        />
      ) : null}
    </SettingsGroup>
  );
}
