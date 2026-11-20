import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { useOrg } from "@agent-native/core/client/org";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  createCreativeContextAgentTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import { ObservabilityDashboard } from "@agent-native/toolkit/app/observability";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsAppArea,
  type SettingsTabItem,
} from "@agent-native/toolkit/app/settings";
import {
  ModelSurface,
  type ModelSurfaceProps,
} from "@agent-native/toolkit/design-system";
import { IconActivity, IconBell, IconDatabase } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import changelog from "../../CHANGELOG.md?raw";
import {
  ANALYTICS_USER_PREFS_KEY,
  type AnalyticsUserPrefs,
} from "../../shared/analytics-user-prefs";
import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../shared/labs";
import { AnalyticsReviewArtifactPreview } from "../components/AnalyticsReviewArtifactPreview";
import { AlertRulesSettingsCard } from "./settings/AlertRulesSettingsCard";
import {
  ALERTS_KEYWORDS,
  ANALYTICS_SETTINGS_AREAS,
  buildAnalyticsDataSourcesSearchEntries,
  buildAnalyticsNotificationsSearchEntries,
} from "./settings/settings-search";

type ScreenModel = ModelSurfaceProps["model"];
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
  const navigate = useNavigate();
  const goTo = useCallback((to: string) => void navigate(to), [navigate]);
  const model = useMemo<ScreenModel>(
    () => ({
      id: "settings",
      rows: [
        {
          id: "settings.data-sources.credentials",
          part: "settings.row",
          label: t("settings.credentials"),
          description: t("settings.credentialsDescription"),
          anchor: "credentials",
          rows: [
            {
              id: "settings.data-sources.credentials.manage",
              part: "button",
              kind: "destination",
              label: t("settings.manageDataSources"),
              effect: { kind: "navigate", to: "/data-sources" },
            },
          ],
        },
      ],
    }),
    [t],
  );
  return <ModelSurface model={model} navigate={goTo} />;
}

function NotificationGroups() {
  const t = useT();
  const preferences = useNotificationPreferences();
  const toggleRow = (
    pref: NotificationPref,
    anchor: string,
    label: string,
    description: string,
  ): ScreenModel["rows"][number] => ({
    id: `settings.notifications.${anchor}`,
    part: "settings.row",
    kind: "toggle",
    label,
    description,
    anchor,
    state: {
      checked: preferences.value(pref),
      disabled: preferences.disabled,
    },
    effect: { kind: "action", effectId: `toggle-${anchor}` },
  });
  const model: ScreenModel = {
    id: "settings",
    rows: [
      {
        id: "settings.notifications.email",
        part: "settings.group",
        label: t("settings.notificationsEmailGroup"),
        rows: [
          toggleRow(
            "errorEmailNotifications",
            "error-email-notifications",
            t("settings.errorEmailNotifications"),
            t("settings.errorEmailNotificationsDescription"),
          ),
        ],
      },
      {
        id: "settings.notifications.sound",
        part: "settings.group",
        label: t("settings.notificationsSoundGroup"),
        rows: [
          toggleRow(
            "bellSoundEnabled",
            "bell-sound",
            t("settings.bellSound"),
            t("settings.bellSoundDescription"),
          ),
        ],
      },
    ],
  };
  return (
    <ModelSurface
      model={model}
      actions={{
        "toggle-error-email-notifications": () =>
          preferences.set(
            "errorEmailNotifications",
            !preferences.value("errorEmailNotifications"),
          ),
        "toggle-bell-sound": () =>
          preferences.set(
            "bellSoundEnabled",
            !preferences.value("bellSoundEnabled"),
          ),
      }}
    />
  );
}

export default function Settings() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextLab();
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();

  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextAgentTab] : []),
    [creativeContextEnabled],
  );
  const agentSettingsTabs = useAgentSettingsTabs({
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
                  renderArtifactPreview={(artifact, compact, reviewOrgId) => (
                    <AnalyticsReviewArtifactPreview
                      artifactId={artifact.artifactId}
                      artifactPath={artifact.path}
                      compact={compact}
                      reviewOrgId={reviewOrgId}
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
      {
        ...ANALYTICS_SESSIONS_TRIAGE_LAB,
        displayName: t("sessions.labName"),
        description: t("sessions.labDescription"),
      },
    ],
    [t],
  );

  const settingsTabs = useMemo<SettingsTabItem[]>(
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
        content: <AlertRulesSettingsCard />,
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

  const notificationsSearchEntries = useMemo(
    () => buildAnalyticsNotificationsSearchEntries(t),
    [t],
  );

  // Language is on Account › Preferences, and replay storage is the
  // workspace's file storage on Organization › Infrastructure.
  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      whatsNewLabel={t("root.whatsNew")}
      extraTabs={settingsTabs}
      appAreas={appAreas}
      notifications={
        <div className="flex flex-col gap-8">
          <NotificationGroups />
        </div>
      }
      notificationsSearchEntries={notificationsSearchEntries}
      labs={labs}
      whatsNewMarkdown={changelog}
    />
  );
}
