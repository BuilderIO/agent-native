import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { ObservabilityDashboard } from "@agent-native/core/client/observability";
import { useOrg } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsAppArea,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  createCreativeContextAgentTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import { IconActivity, IconBell, IconDatabase } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import changelog from "../../CHANGELOG.md?raw";
import {
  ANALYTICS_USER_PREFS_KEY,
  type AnalyticsUserPrefs,
} from "../../shared/analytics-user-prefs";
import { AnalyticsReviewArtifactPreview } from "../components/AnalyticsReviewArtifactPreview";
import { useReplayStorageStatus } from "../hooks/use-replay-storage-status";
import { ReplayStorageHint } from "./sessions/SessionsPage";
import { AlertRulesSettingsCard } from "./settings/AlertRulesSettingsCard";
import {
  ALERTS_KEYWORDS,
  ANALYTICS_SETTINGS_AREAS,
  buildAnalyticsDataSourcesSearchEntries,
  buildAnalyticsGeneralSettingsSearchEntries,
  buildAnalyticsNotificationsSearchEntries,
} from "./settings/settings-search";

type NotificationPref = "errorEmailNotifications" | "bellSoundEnabled";
type NotificationPatch = Partial<Record<NotificationPref, boolean>>;

const SAVE_FAILED_KEYS: Record<NotificationPref, string> = {
  errorEmailNotifications: "settings.errorEmailNotificationsSaveFailed",
  bellSoundEnabled: "settings.bellSoundSaveFailed",
};

function useNotificationPreferences() {
  const t = useT();
  const { data, isLoading } = useActionQuery<AnalyticsUserPrefs>(
    "get-user-pref",
    { key: ANALYTICS_USER_PREFS_KEY },
  );
  const save = useActionMutation<
    Required<AnalyticsUserPrefs>,
    NotificationPatch
  >("update-analytics-notification-preferences");
  const [pending, setPending] = useState<NotificationPatch>({});

  // A refetch (after a save, or after the agent changed a preference) is the
  // saved state, so it replaces the optimistic values.
  useEffect(() => {
    setPending({});
  }, [data]);

  const value = (pref: NotificationPref) =>
    pending[pref] ?? data?.[pref] === true;

  const set = (pref: NotificationPref, enabled: boolean) => {
    const previous = value(pref);
    setPending((current) => ({ ...current, [pref]: enabled }));
    void save.mutateAsync({ [pref]: enabled }).catch((error) => {
      setPending((current) => ({ ...current, [pref]: previous }));
      toast.error(
        error instanceof Error ? error.message : t(SAVE_FAILED_KEYS[pref]),
      );
    });
  };

  return { value, set, disabled: isLoading || save.isPending };
}

function CredentialsRow() {
  const t = useT();
  return (
    <SettingsRow
      id="credentials"
      label={t("settings.credentials")}
      description={t("settings.credentialsDescription")}
      control={
        <Button variant="outline" size="sm" asChild>
          <Link to="/data-sources">{t("settings.manageDataSources")}</Link>
        </Button>
      }
    />
  );
}

export default function Settings() {
  const t = useT();
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
  const creativeContextEnabled = useCreativeContextLab();
  const replayStorageStatus = useReplayStorageStatus();
  const preferences = useNotificationPreferences();
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();

  const bellSoundRow = (
    <SettingsRow
      id="bell-sound"
      label={t("settings.bellSound")}
      description={t("settings.bellSoundDescription")}
      control={
        <Switch
          aria-label={t("settings.bellSound")}
          checked={preferences.value("bellSoundEnabled")}
          disabled={preferences.disabled}
          onCheckedChange={(enabled) =>
            preferences.set("bellSoundEnabled", enabled)
          }
        />
      }
    />
  );
  const errorEmailRow = (
    <SettingsRow
      id="error-email-notifications"
      label={t("settings.errorEmailNotifications")}
      description={t("settings.errorEmailNotificationsDescription")}
      control={
        <Switch
          aria-label={t("settings.errorEmailNotifications")}
          checked={preferences.value("errorEmailNotifications")}
          disabled={preferences.disabled}
          onCheckedChange={(enabled) =>
            preferences.set("errorEmailNotifications", enabled)
          }
        />
      }
    />
  );
  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextAgentTab] : []),
    [creativeContextEnabled],
  );
  // The redesigned Settings has no Agent overview; the bell sound is on the
  // Notifications page there.
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalContent: redesign ? undefined : bellSoundRow,
    agentAdditionalTabFactories,
  });
  const observabilityBasePath = buildSettingsRoute("observability");
  const observabilityTabs = useMemo<SettingsTabItem[]>(
    () =>
      !orgLoading &&
      !orgError &&
      activeOrg?.orgId &&
      (activeOrg.role === "owner" || activeOrg.role === "admin")
        ? [
            {
              id: "observability",
              label: t("settings.agentObservability"),
              icon: IconActivity,
              group: "agent",
              href: `${observabilityBasePath}/overview`,
              content: (
                <ObservabilityDashboard
                  routeBasePath={observabilityBasePath}
                  showHumanReview
                  renderArtifactPreview={(artifact, compact) => (
                    <AnalyticsReviewArtifactPreview
                      artifactId={artifact.artifactId}
                      compact={compact}
                    />
                  )}
                />
              ),
            },
          ]
        : [],
    [
      activeOrg?.orgId,
      activeOrg?.role,
      observabilityBasePath,
      orgError,
      orgLoading,
      t,
    ],
  );
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

  const legacyTabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: ANALYTICS_SETTINGS_AREAS.alerts,
        label: t("settings.alertsTitle"),
        icon: IconBell,
        keywords: ALERTS_KEYWORDS,
        content: (
          <div className="w-full">
            <AlertRulesSettingsCard />
          </div>
        ),
      },
      ...agentSettingsTabs,
      ...observabilityTabs,
    ],
    [agentSettingsTabs, observabilityTabs, t],
  );

  const redesignTabs = useMemo<SettingsTabItem[]>(
    () => [...agentSettingsTabs, ...observabilityTabs],
    [agentSettingsTabs, observabilityTabs],
  );

  const appAreas = useMemo<SettingsAppArea[]>(
    () => [
      {
        id: ANALYTICS_SETTINGS_AREAS.alerts,
        label: t("settings.alertsTitle"),
        icon: IconBell,
        keywords: ALERTS_KEYWORDS,
        content: <AlertRulesSettingsCard embedded />,
      },
      {
        id: ANALYTICS_SETTINGS_AREAS.dataSources,
        label: t("navigation.dataSources"),
        icon: IconDatabase,
        keywords: "data sources credentials api keys",
        searchEntries: buildAnalyticsDataSourcesSearchEntries(t),
        content: (
          <SettingsGroup>
            <CredentialsRow />
          </SettingsGroup>
        ),
      },
    ],
    [t],
  );

  const generalSearchEntries = useMemo(
    () =>
      buildAnalyticsGeneralSettingsSearchEntries(
        t,
        !!replayStorageStatus.data?.configured,
      ),
    [replayStorageStatus.data?.configured, t],
  );
  const notificationsSearchEntries = useMemo(
    () => buildAnalyticsNotificationsSearchEntries(t),
    [t],
  );

  const whatsNew = (
    <div className="w-full">
      <ChangelogSettingsCard markdown={changelog} />
    </div>
  );

  if (redesign) {
    // Language is on Account › Preferences, and replay storage is the
    // workspace's file storage on Organization › Infrastructure.
    return (
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        whatsNewLabel={t("root.whatsNew")}
        extraTabs={redesignTabs}
        appAreas={appAreas}
        notifications={
          <div className="flex flex-col gap-8">
            <SettingsGroup title={t("settings.notificationsEmailGroup")}>
              {errorEmailRow}
            </SettingsGroup>
            <SettingsGroup title={t("settings.notificationsSoundGroup")}>
              {bellSoundRow}
            </SettingsGroup>
          </div>
        }
        notificationsSearchEntries={notificationsSearchEntries}
        labs={labs}
        whatsNew={whatsNew}
      />
    );
  }

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      whatsNewLabel={t("root.whatsNew")}
      extraTabs={legacyTabs}
      labs={labs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="w-full space-y-6">
          <SettingsGroup className="bg-card border-border/50">
            <CredentialsRow />
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
            {errorEmailRow}
          </SettingsGroup>

          {replayStorageStatus.data?.configured ? (
            <SettingsGroup
              id="replay-storage"
              title={t("sessions.storageSetupTitle")}
              description={t("sessions.storageSetupDescription")}
            >
              <ReplayStorageHint embedded />
            </SettingsGroup>
          ) : null}
        </div>
      }
      whatsNew={whatsNew}
    />
  );
}
