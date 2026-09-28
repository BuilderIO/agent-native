import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  BuilderConnectPopover,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  CreativeContextSettingsLink,
  createCreativeContextAgentTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconCloudUpload,
  IconExternalLink,
  IconKey,
  IconLibraryPhoto,
  IconLoader2,
  IconPhoto,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/PageShell";
import { AssetsGeneralGroups } from "@/components/settings/AssetsGeneralGroups";
import { AssetsNotificationSettings } from "@/components/settings/AssetsNotificationSettings";
import {
  builderDescription,
  generationSummary,
  ManualMethodPanel,
  useGenerationSetup,
} from "@/components/settings/generation-setup";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAssetsPrefs } from "@/hooks/use-assets-prefs";
import { messagesByLocale } from "@/i18n-data";
import { cn } from "@/lib/utils";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.title }];
}

export default function SettingsPage() {
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);
  // Loading counts as redesign-pending: SettingsTabsPage holds the shell
  // skeleton until the answer arrives, while PageShell around the legacy page
  // would paint the old header first and then swap.
  return redesign.enabled || redesign.status === "loading" ? (
    <RedesignedSettingsPage />
  ) : (
    <LegacySettingsPage />
  );
}

function useAssetsSettingsTabs() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextLab();
  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextAgentTab] : []),
    [creativeContextEnabled],
  );
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories,
  });
  const labs = useMemo(
    () => [
      {
        ...CREATIVE_CONTEXT_LIBRARY_LAB,
        displayName: t("creativeContext.share.title"),
        description: t("creativeContext.description"),
      },
    ],
    [t],
  );
  return { creativeContextEnabled, agentSettingsTabs, labs };
}

/**
 * The `settings-redesign` shell: generation and storage on Assets › General,
 * the email switch on Assets › Notifications. Language lives on core's
 * Account › Preferences, so this page has no language row.
 */
function RedesignedSettingsPage() {
  const t = useT();
  const { agentSettingsTabs, labs } = useAssetsSettingsTabs();
  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "assets-generation-setup",
        label: t("settings.generation"),
        keywords:
          "builder generation image video setup connect gemini openai api key",
        hash: "asset-generation-setup",
      },
      {
        id: "assets-generation-keys",
        label: t("settings.manualKeys"),
        keywords: "manual api key gemini openai provider generation fallback",
        hash: "generation-keys",
      },
      {
        id: "assets-storage",
        label: t("settings.objectStorage"),
        keywords: "storage object storage s3 r2 bucket spaces minio tigris",
        hash: "object-storage",
      },
    ],
    [t],
  );
  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "assets-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notification generation finished failed alert",
        hash: "notifications",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      className="h-full"
      extraTabs={agentSettingsTabs}
      labs={labs}
      generalGroups={<AssetsGeneralGroups />}
      generalSearchEntries={generalSearchEntries}
      notifications={<AssetsNotificationSettings />}
      notificationsSearchEntries={notificationsSearchEntries}
      whatsNew={<ChangelogSettingsCard markdown={changelog} />}
      whatsNewMarkdown={changelog}
    />
  );
}

function LegacySettingsPage() {
  const t = useT();
  const { creativeContextEnabled, agentSettingsTabs, labs } =
    useAssetsSettingsTabs();
  const { data } = useActionQuery("list-libraries", { compact: true }) as {
    data?: { count?: number };
  };
  const { prefs, loading: prefsLoading, save: savePrefs } = useAssetsPrefs();

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "assets-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "assets-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notification generation finished failed alert",
        hash: "notifications",
      },
      {
        id: "assets-generation-setup",
        label: t("settings.setupTitle"),
        keywords:
          "builder generation storage object storage api key gemini openai brand kit setup connect",
        hash: "asset-generation-setup",
      },
    ],
    [t],
  );

  return (
    <PageShell
      title={t("settings.title")}
      description={t("settings.description")}
      className="max-w-5xl"
    >
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        extraTabs={agentSettingsTabs}
        labs={labs}
        generalSearchEntries={generalSearchEntries}
        general={
          <div className="mx-auto w-full max-w-2xl space-y-6">
            {creativeContextEnabled ? <CreativeContextSettingsLink /> : null}

            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("settings.connections")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("settings.connectionsDescription")}
              </p>
            </div>

            <SettingsGroup className="scroll-mt-4">
              <SettingsRow
                id="language"
                label={t("settings.languageTitle")}
                description={t("settings.languageDescription")}
                control={
                  <div className="w-56">
                    <LanguagePicker label={t("settings.languageLabel")} />
                  </div>
                }
              />
              <SettingsRow
                id="notifications"
                label={t("settings.emailNotifications")}
                description={t("settings.emailNotificationsDescription")}
                control={
                  <Switch
                    aria-label={t("settings.emailNotifications")}
                    checked={prefs.emailNotifications !== false}
                    disabled={prefsLoading}
                    onCheckedChange={(checked) => {
                      savePrefs({ emailNotifications: checked }).catch(
                        (err) => {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : t("settings.saveFailed"),
                          );
                        },
                      );
                    }}
                  />
                }
              />
            </SettingsGroup>

            <section id="asset-generation-setup" className="scroll-mt-4">
              <AssetsSetupCard libraryCount={data?.count ?? 0} />
            </section>
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </PageShell>
  );
}

function AssetsSetupCard({ libraryCount }: { libraryCount: number }) {
  const t = useT();
  const setup = useGenerationSetup();
  const [manualGenerationOpen, setManualGenerationOpen] = useState(false);
  const [manualStorageOpen, setManualStorageOpen] = useState(false);
  const {
    configData,
    flow,
    generationStep,
    storageStep,
    builderConnected,
    generationReady,
    storageReady,
    setupIssue,
    refreshSetup,
  } = setup;
  const readyCount = [generationReady, storageReady].filter(Boolean).length;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/80 shadow-sm">
      <CardHeader className="border-b border-border/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {t("settings.setupTitle")}
            </CardTitle>
            <CardDescription className="mt-1 leading-6">
              {t("settings.setupDescription")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{readyCount}/2</span>
            {t("settings.setupReady")}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <SettingsRow
          className="border-b border-border/70 last:border-b-0"
          icon={<IconKey className="size-4" />}
          label="Builder"
          description={builderDescription(setup, t)}
          status={
            <StatusPill tone={builderConnected ? "ready" : "neutral"}>
              {configData?.builderLookupFailed
                ? t("settings.statusUnavailable")
                : builderConnected
                  ? t("settings.connected")
                  : t("settings.optional")}
            </StatusPill>
          }
          control={
            <BuilderConnectPopover flow={flow}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={flow.connecting}
                className="shrink-0"
              >
                {flow.connecting ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    {t("settings.connecting")}
                  </>
                ) : builderConnected ? (
                  <>
                    {t("settings.reconnect")}
                    <IconExternalLink className="size-3.5" />
                  </>
                ) : (
                  <>
                    {t("settings.connect")}
                    <IconExternalLink className="size-3.5" />
                  </>
                )}
              </Button>
            </BuilderConnectPopover>
          }
        />

        {setupIssue ? <SetupIssueCallout message={setupIssue} /> : null}

        <SettingsRow
          className="border-b border-border/70 last:border-b-0"
          icon={<IconPhoto className="size-4" />}
          label={t("settings.generation")}
          description={generationSummary(configData, builderConnected, t)}
          status={
            <StatusPill tone={generationReady ? "ready" : "attention"}>
              {generationReady
                ? t("settings.generationReady")
                : t("settings.generationNeedsSetup")}
            </StatusPill>
          }
          control={
            generationStep ? (
              <DisclosureButton
                open={manualGenerationOpen}
                onClick={() => setManualGenerationOpen((open) => !open)}
              >
                {t("settings.manualKeys")}
              </DisclosureButton>
            ) : null
          }
        />
        {manualGenerationOpen && generationStep ? (
          <ManualMethodPanel
            step={generationStep}
            title={t("settings.manualGenerationKeys")}
            description={t("settings.manualGenerationDescription")}
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          className="border-b border-border/70 last:border-b-0"
          icon={<IconCloudUpload className="size-4" />}
          label={t("settings.storage")}
          description={
            storageReady
              ? t("settings.storageReady")
              : t("settings.storageNeedsSetup")
          }
          status={
            <StatusPill tone={storageReady ? "ready" : "attention"}>
              {storageReady
                ? t("settings.generationReady")
                : t("settings.generationNeedsSetup")}
            </StatusPill>
          }
          control={
            storageStep ? (
              <DisclosureButton
                open={manualStorageOpen}
                onClick={() => setManualStorageOpen((open) => !open)}
              >
                {t("settings.configure")}
              </DisclosureButton>
            ) : null
          }
        />
        {manualStorageOpen && storageStep ? (
          <ManualMethodPanel
            step={storageStep}
            title={t("settings.objectStorage")}
            description={t("settings.objectStorageDescription")}
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          className="border-b border-border/70 last:border-b-0"
          icon={<IconLibraryPhoto className="size-4" />}
          label={t("settings.brandKits")}
          description={`${libraryCount} accessible ${
            libraryCount === 1 ? "brand kit" : "brand kits"
          }.`}
          status={
            <StatusPill tone="neutral">{t("settings.available")}</StatusPill>
          }
        />
      </CardContent>
    </Card>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "ready" | "attention" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium",
        tone === "ready" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "attention" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {tone === "ready" ? <IconCheck className="size-3" /> : null}
      {children}
    </span>
  );
}

function DisclosureButton({
  children,
  open,
  onClick,
}: {
  children: ReactNode;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground"
      aria-expanded={open}
    >
      {children}
      <IconChevronDown
        className={cn("size-3.5 transition-transform", open && "rotate-180")}
      />
    </Button>
  );
}

function SetupIssueCallout({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-b border-border/70 bg-amber-500/5 px-5 py-3"
    >
      <div className="flex gap-2 text-sm leading-6 text-amber-700 dark:text-amber-300">
        <IconAlertCircle className="mt-1 size-4 shrink-0" />
        <p>{message}</p>
      </div>
    </div>
  );
}
