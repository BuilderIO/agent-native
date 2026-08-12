import {
  CHAT_FIRST_MODE_CHANGED_EVENT,
  readChatFirstModeState,
  writeChatFirstMode,
} from "@agent-native/core/client/agent-chat";
import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { Button } from "@agent-native/dispatch/components/ui/button";
import { Switch } from "@agent-native/dispatch/components/ui/switch";
import { IconShield } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";
import { dispatchAccessDescriptor } from "../../shared/app-roles";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs({
    usageAppId: "dispatch",
    usageViewAllHref: "/admin/metrics",
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
      {
        id: "dispatch-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "dispatch-workspace",
        label: t("settings.workspaceTitle"),
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
    [t],
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
              control={
                <Button variant="outline" asChild>
                  <Link to="/workspace">
                    {t("settings.openResourceSettings")}
                  </Link>
                </Button>
              }
            />
          </SettingsGroup>

          <SettingsGroup id="chat-first">
            <SettingsRow
              label={t("settings.chatFirstTitle")}
              description={t("settings.chatFirstDescription")}
              control={
                <Switch
                  aria-label={t("settings.chatFirstAriaLabel")}
                  checked={chatFirstMode}
                  onCheckedChange={updateChatFirstMode}
                />
              }
            >
              <p className="text-sm leading-6 text-muted-foreground">
                {t("settings.chatFirstSessionWatchDescription")}
              </p>
              {chatFirstStorageNotice ? (
                <p className="text-sm text-destructive" role="alert">
                  {chatFirstStorageNotice}
                </p>
              ) : null}
            </SettingsRow>
          </SettingsGroup>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            appRoles={dispatchAccessDescriptor}
            createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
