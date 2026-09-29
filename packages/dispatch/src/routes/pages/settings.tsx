import {
  CHAT_FIRST_MODE_CHANGED_EVENT,
  readChatFirstModeState,
  writeChatFirstMode,
} from "@agent-native/core/client/agent-chat";
import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import {
  useFeatureFlag,
  useFeatureFlagState,
} from "@agent-native/core/client/feature-flags";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { OrgMembersPage, TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  CORE_SETTINGS_PAGES,
  registerSettingsPages,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { IconShield } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import packageChangelog from "../../../CHANGELOG.md?raw";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { dispatchAccessDescriptor } from "../../shared/app-roles.js";
import { DISPATCH_CONNECT_APPS_FLAG } from "../../shared/feature-flags.js";

const coreMembersPage = CORE_SETTINGS_PAGES.find(
  (page) => page.id === "members",
);
if (!coreMembersPage) {
  throw new Error("Core Settings has no members page for Dispatch app roles");
}

function DispatchMembersSettingsPage() {
  return <OrgMembersPage appRoles={dispatchAccessDescriptor} />;
}

// The redesigned Settings shows Members from core; Dispatch's replaces it so
// the app-role column stays.
registerSettingsPages([
  { ...coreMembersPage, component: DispatchMembersSettingsPage },
]);

export function meta() {
  return [{ title: "Settings - Dispatch" }];
}

export interface DispatchSettingsPageProps {
  /** Raw CHANGELOG.md behind What's new. */
  changelog: string;
}

/**
 * Dispatch's Settings. The template route renders it with the app's own
 * changelog; `dispatchRoutes` consumers get the default export.
 */
export function DispatchSettingsPage({ changelog }: DispatchSettingsPageProps) {
  const t = useT();
  const connectAppsEnabled = useFeatureFlag(DISPATCH_CONNECT_APPS_FLAG.key);
  // Core Preferences owns the interface language in the redesigned Settings,
  // whose Dispatch General page shows `generalGroups` instead of `general`.
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
  const agentSettingsTabs = useAgentSettingsTabs({
    usageAppId: "dispatch",
    usageViewAllHref: "/admin/metrics",
    organizationContent: (
      <div className="mx-auto w-full max-w-3xl">
        <TeamPage
          showTitle={false}
          appRoles={dispatchAccessDescriptor}
          createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
        />
      </div>
    ),
  });
  const settingsTabs = [
    ...agentSettingsTabs,
    {
      id: "admin",
      label: t("dispatch.nav.admin", { defaultValue: "Admin" }),
      icon: IconShield,
      group: "Admin",
      href: "/admin",
      content: null,
    },
  ];
  const [chatFirstModeState] = useState(() => readChatFirstModeState());
  const [chatFirstMode, setChatFirstMode] = useState(
    () => chatFirstModeState.enabled,
  );
  const [chatFirstStorageNotice, setChatFirstStorageNotice] = useState<
    string | null
  >(
    chatFirstModeState.availability === "unavailable"
      ? t("settings.chatFirstStorageUnavailable")
      : null,
  );

  function updateChatFirstMode(enabled: boolean) {
    const result = writeChatFirstMode(enabled);
    if (!result.ok) {
      setChatFirstStorageNotice(t("settings.chatFirstStorageBlocked"));
      return;
    }
    setChatFirstStorageNotice(null);
    setChatFirstMode(enabled);
    window.dispatchEvent(
      new CustomEvent(CHAT_FIRST_MODE_CHANGED_EVENT, {
        detail: { enabled },
      }),
    );
  }

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      ...(redesign
        ? []
        : [
            {
              id: "dispatch-language",
              label: t("settings.languageTitle"),
              keywords: "language locale translation i18n",
              hash: "language",
            },
          ]),
      {
        id: "dispatch-workspace",
        label: redesign
          ? t("settings.resourcesTitle")
          : t("settings.workspaceTitle"),
        keywords: "workspace resources integrations vault destinations",
        hash: "workspace-resources",
      },
      {
        id: "dispatch-chat-first",
        label: t("settings.chatFirstTitle"),
        keywords: "chat first codex t3 apps pane navigation",
        hash: "chat-first",
      },
    ],
    [redesign, t],
  );

  const chatFirstSwitch = (
    <Switch
      aria-label={t("settings.chatFirstAriaLabel")}
      checked={chatFirstMode}
      onCheckedChange={updateChatFirstMode}
    />
  );
  const chatFirstStorageAlert = chatFirstStorageNotice ? (
    <p className="text-sm text-destructive" role="alert">
      {chatFirstStorageNotice}
    </p>
  ) : null;
  const connectAppsRow = connectAppsEnabled ? (
    <SettingsRow
      id="connect-apps"
      label={t("settings.connectApps")}
      description={t("settings.connectAppsDescription")}
      control={
        <Button variant="outline" asChild>
          <Link to="/connect">{t("settings.openConnectApps")}</Link>
        </Button>
      }
    />
  ) : null;
  const resourceSettingsButton = (
    <Button variant="outline" asChild>
      <Link to="/workspace">{t("settings.openResourceSettings")}</Link>
    </Button>
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={settingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <SettingsGroup>
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
              id="workspace-resources"
              label={t("settings.workspaceTitle")}
              description={t("settings.workspaceDescription")}
              control={resourceSettingsButton}
            />
            {connectAppsRow}
          </SettingsGroup>

          <SettingsGroup id="chat-first">
            <SettingsRow
              label={t("settings.chatFirstTitle")}
              description={t("settings.chatFirstDescription")}
              control={chatFirstSwitch}
            >
              <p className="text-sm leading-6 text-muted-foreground">
                {t("settings.chatFirstSessionWatchDescription")}
              </p>
              {chatFirstStorageAlert}
            </SettingsRow>
          </SettingsGroup>
        </div>
      }
      generalGroups={
        <SettingsGroup id="workspace" title={t("settings.workspaceTitle")}>
          <SettingsRow
            id="chat-first"
            label={t("settings.chatFirstTitle")}
            description={t("settings.chatFirstDescription")}
            control={chatFirstSwitch}
          >
            {chatFirstStorageAlert}
          </SettingsRow>
          <SettingsRow
            id="workspace-resources"
            label={t("settings.resourcesTitle")}
            description={t("settings.workspaceDescription")}
            control={resourceSettingsButton}
          />
          {connectAppsRow}
        </SettingsGroup>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}

export default function SettingsRoute() {
  return <DispatchSettingsPage changelog={packageChangelog} />;
}
