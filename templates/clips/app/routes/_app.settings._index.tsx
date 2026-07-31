import { agentNativePath } from "@agent-native/core/client/api-path";
import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { useOrg, useSwitchOrg } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useBuilderConnectFlow,
  useBuilderStatus,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import type { ClipsDefaultVisibility } from "@shared/clips-ai-prefs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/library/page-header";
import { AiSetupSection } from "@/components/settings/ai-setup-section";
import { SlackSection } from "@/components/settings/slack-section";
import { VideoStorageSection } from "@/components/settings/video-storage-section";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OrganizationIdentityCard } from "@/components/workspace/organization-identity-card";
import { useSecretStatus } from "@/hooks/use-secret-status";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.settings.pageTitle }];
}

const SPEEDS = ["1", "1.2", "1.5", "1.75", "2"];

interface ClipsUserSettings {
  defaultPlaybackSpeed?: string;
  emailNotifications?: boolean;
  transcriptCleanupEnabled?: boolean;
  includeFullVideoInAi?: boolean;
  defaultRecordingVisibility?: ClipsDefaultVisibility;
}

async function loadSettings(): Promise<ClipsUserSettings> {
  try {
    const res = await fetch(agentNativePath("/_agent-native/clips/user-prefs"));
    if (!res.ok) return {};
    const json = await res.json();
    // The store's GET returns the stored object directly, not wrapped.
    if (json && typeof json === "object" && !("error" in json)) {
      return json as ClipsUserSettings;
    }
    return {};
  } catch {
    return {};
  }
}

async function saveSettings(value: ClipsUserSettings): Promise<void> {
  const res = await fetch(agentNativePath("/_agent-native/clips/user-prefs"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    throw new Error(`Save failed (${res.status})`);
  }
}

export default function SettingsIndexRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  // Organization identity (name, logo, brand color) belongs with membership,
  // so it rides on the framework's Organization tab rather than a second one.
  const settingsTabs = useMemo(
    () =>
      agentSettingsTabs.map((tab) =>
        tab.id === "organization"
          ? {
              ...tab,
              content: (
                <div className="mx-auto w-full max-w-2xl space-y-6">
                  <OrganizationIdentityCard />
                  {tab.content}
                </div>
              ),
            }
          : tab,
      ),
    [agentSettingsTabs],
  );
  const { data: org } = useOrg();
  const switchOrg = useSwitchOrg();
  const storageStatus = useVideoStorageStatus();
  const secrets = useSecretStatus();
  const builderStatus = useBuilderStatus();
  const builderConnect = useBuilderConnectFlow({
    popupUrl:
      builderStatus.status?.cliAuthUrl ?? builderStatus.status?.connectUrl,
    trackingSource: "clips_settings",
    trackingFlow: "clips_setup",
    onConnected: async () => {
      await Promise.all([storageStatus.refetch(), builderStatus.refetch()]);
      toast.success(t("settings.builderConnectedToast"));
    },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultSpeed, setDefaultSpeed] = useState("1.2");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [defaultVisibility, setDefaultVisibility] =
    useState<ClipsDefaultVisibility>("private");
  const [transcriptCleanupEnabled, setTranscriptCleanupEnabled] =
    useState(true);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((v) => {
      if (cancelled) return;
      setDefaultSpeed(v.defaultPlaybackSpeed ?? "1.2");
      setEmailNotifications(v.emailNotifications ?? true);
      setDefaultVisibility(v.defaultRecordingVisibility ?? "private");
      setTranscriptCleanupEnabled(v.transcriptCleanupEnabled !== false);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const orgs = org?.orgs ?? [];

  const builder = useMemo(
    () => ({
      connected: Boolean(
        builderConnect.configured ||
        builderStatus.status?.configured ||
        storageStatus.data?.builderConfigured ||
        storageStatus.data?.activeProvider?.id === "builder",
      ),
      loading:
        storageStatus.isLoading ||
        builderStatus.loading ||
        !builderConnect.hasFetchedStatus,
      connecting: builderConnect.connecting,
      orgName: builderConnect.orgName ?? builderStatus.status?.orgName ?? null,
      start: builderConnect.start,
    }),
    [builderConnect, builderStatus, storageStatus],
  );

  async function handleUploadWorkspaceChange(organizationId: string) {
    if (!organizationId || organizationId === org?.orgId) return;
    try {
      await switchOrg.mutateAsync(organizationId);
      toast.success(t("settings.uploadWorkspaceSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("settings.uploadWorkspaceSaveFailed"),
      );
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettings({
        defaultPlaybackSpeed: defaultSpeed,
        emailNotifications,
        transcriptCleanupEnabled,
        defaultRecordingVisibility: defaultVisibility,
      });
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  const localizedChangelog = t("settings.changelogMarkdown");

  // Hashes match the row ids below, so a search hit still scrolls to the
  // individual setting now that the one-control cards are rows in a group.
  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "clips-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "clips-video-storage",
        label: t("settings.videoStorage"),
        keywords: "storage s3 builder bucket cloud video",
        hash: "video-storage",
      },
      {
        id: "clips-upload-workspace",
        label: t("settings.uploadWorkspaceTitle"),
        keywords:
          "upload recordings desktop destination organization workspace",
        hash: "upload-workspace",
      },
      {
        id: "clips-slack",
        label: t("settings.slackTitle"),
        keywords: "slack integration notifications workspace",
        hash: "slack",
      },
      {
        id: "clips-ai-providers",
        label: t("settings.apiSetup"),
        keywords:
          "ai provider api key anthropic openai gemini groq openrouter builder",
        hash: "ai-providers",
      },
      {
        id: "clips-playback",
        label: t("settings.playback"),
        keywords: "playback speed video default",
        hash: "playback",
      },
      {
        id: "clips-transcript",
        label: t("settings.transcript"),
        keywords: "transcript cleanup captions",
        hash: "transcript",
      },
      {
        id: "clips-sharing",
        label: t("settings.sharing"),
        keywords: "sharing visibility private public organization default",
        hash: "sharing",
      },
      {
        id: "clips-notifications",
        label: t("settings.notifications"),
        keywords: "email notifications alerts",
        hash: "notifications",
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("settings.title")}
        </h1>
      </PageHeader>
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        whatsNewLabel={t("settings.whatsNew")}
        extraTabs={settingsTabs}
        generalSearchEntries={generalSearchEntries}
        general={
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <div className="min-w-0 space-y-6">
              <p className="text-sm text-muted-foreground">
                {t("settings.intro")}
              </p>

              <SettingsGroup
                id="preferences"
                title={t("settings.preferencesTitle")}
              >
                <SettingsRow
                  id="language"
                  label={t("settings.languageLabel")}
                  description={t("settings.languageDescription")}
                  control={
                    <div className="w-56">
                      <LanguagePicker label={t("settings.languageLabel")} />
                    </div>
                  }
                />
                <SettingsRow
                  id="playback"
                  label={t("settings.defaultPlaybackSpeed")}
                  description={t("settings.playbackDescription")}
                  control={
                    <Select
                      value={defaultSpeed}
                      onValueChange={setDefaultSpeed}
                      disabled={loading}
                    >
                      <SelectTrigger id="speed" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SPEEDS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}×
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  id="sharing"
                  label={t("settings.defaultVisibility")}
                  description={t("settings.defaultVisibilityDescription")}
                  control={
                    <Select
                      value={defaultVisibility}
                      onValueChange={(value) =>
                        setDefaultVisibility(value as ClipsDefaultVisibility)
                      }
                      disabled={loading}
                    >
                      <SelectTrigger id="default-visibility" className="w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">
                          {t("settings.visibilityPrivate")}
                        </SelectItem>
                        <SelectItem value="org">
                          {t("settings.visibilityOrg")}
                        </SelectItem>
                        <SelectItem value="public">
                          {t("settings.visibilityPublic")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  id="transcript"
                  label={t("settings.transcriptCleanup")}
                  description={t("settings.transcriptCleanupDescription")}
                  control={
                    <Switch
                      id="transcript-cleanup"
                      aria-label={t("settings.transcriptCleanup")}
                      checked={transcriptCleanupEnabled}
                      onCheckedChange={setTranscriptCleanupEnabled}
                      disabled={loading}
                    />
                  }
                />
                <SettingsRow
                  id="notifications"
                  label={t("settings.emailNotifications")}
                  description={t("settings.emailNotificationsDescription")}
                  control={
                    <Switch
                      id="email-notif"
                      aria-label={t("settings.emailNotifications")}
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                      disabled={loading}
                    />
                  }
                />
              </SettingsGroup>

              {orgs.length > 0 ? (
                <SettingsGroup
                  title={t("settings.uploadWorkspaceTitle")}
                  description={t("settings.uploadWorkspaceDescription")}
                >
                  <SettingsRow
                    id="upload-workspace"
                    label={t("settings.uploadWorkspaceLabel")}
                    description={
                      switchOrg.isPending
                        ? t("settings.uploadWorkspaceSaving")
                        : t("settings.uploadWorkspaceHint")
                    }
                    control={
                      <Select
                        value={org?.orgId ?? undefined}
                        onValueChange={handleUploadWorkspaceChange}
                        disabled={switchOrg.isPending || orgs.length < 2}
                      >
                        <SelectTrigger
                          id="upload-workspace-select"
                          className="w-64"
                        >
                          <SelectValue
                            placeholder={t(
                              "settings.uploadWorkspacePlaceholder",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {orgs.map((workspace) => (
                            <SelectItem
                              key={workspace.orgId}
                              value={workspace.orgId}
                            >
                              {workspace.orgName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    }
                  />
                </SettingsGroup>
              ) : null}

              <VideoStorageSection
                builder={builder}
                secrets={secrets}
                storageStatus={storageStatus}
              />

              <AiSetupSection builder={builder} secrets={secrets} />

              <SlackSection />

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={loading || saving}
                  className="bg-primary hover:bg-primary/90"
                >
                  {saving ? t("common.saving") : t("common.saveChanges")}
                </Button>
              </div>
            </div>
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-3xl">
            <ChangelogSettingsCard
              markdown={localizedChangelog}
              title={t("settings.whatsNew")}
              closeLabel={t("common.cancel")}
              emptyText={t("settings.changelogEmpty")}
              viewAllLabel={t("settings.viewAllUpdates")}
            />
          </div>
        }
      />
    </>
  );
}
