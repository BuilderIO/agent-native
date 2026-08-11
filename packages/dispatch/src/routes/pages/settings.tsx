import {
  CHAT_FIRST_MODE_CHANGED_EVENT,
  readChatFirstModeState,
  writeChatFirstMode,
} from "@agent-native/core/client/agent-chat";
import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { IconShield } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import changelog from "../../../CHANGELOG.md?raw";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";

export function meta() {
  return [{ title: "Settings - Dispatch" }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  const settingsTabs = [
    ...agentSettingsTabs.filter((tab) => tab.id !== "integrations"),
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
      ? "This browser is not allowing local preferences, so Chat-first mode cannot be persisted."
      : null,
  );

  function updateChatFirstMode(enabled: boolean) {
    const result = writeChatFirstMode(enabled);
    if (!result.ok) {
      setChatFirstStorageNotice(
        "This browser blocked local preferences, so Chat-first mode was not changed.",
      );
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

  return (
    <DispatchShell
      title={t("settings.title")}
      description={t("settings.description")}
    >
      <SettingsTabsPage
        extraTabs={settingsTabs}
        general={
          <div className="mx-auto w-full max-w-3xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.languageTitle")}
                </CardTitle>
                <CardDescription>
                  {t("settings.languageDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-w-xs space-y-1.5">
                <Label>{t("settings.languageLabel")}</Label>
                <LanguagePicker label={t("settings.languageLabel")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Chat-first workspace
                </CardTitle>
                <CardDescription>
                  Keep chats at the center and open workspace apps in a
                  contextual pane beside them.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="dispatch-chat-first-mode">
                    Use chat-first navigation
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    This preference only changes your local Dispatch shell.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Session watch and follow-up messaging work in this browser
                    pane too. Local CLI subscription detection stays in the
                    Electron app; Dispatch uses workspace/provider credentials.
                  </p>
                </div>
                <Switch
                  id="dispatch-chat-first-mode"
                  checked={chatFirstMode}
                  onCheckedChange={updateChatFirstMode}
                />
              </CardContent>
              {chatFirstStorageNotice ? (
                <p className="px-6 pb-4 text-sm text-destructive" role="alert">
                  {chatFirstStorageNotice}
                </p>
              ) : null}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.workspaceTitle")}
                </CardTitle>
                <CardDescription>
                  {t("settings.workspaceDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" asChild>
                  <Link to="/admin/workspace">
                    {t("settings.openResourceSettings")}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.deliveryTitle")}
                </CardTitle>
                <CardDescription>
                  {t("settings.deliveryDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" asChild>
                  <Link to="/admin/destinations">
                    {t("settings.openDelivery")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-3xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </DispatchShell>
  );
}
