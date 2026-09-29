import { useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { PLAN_LABS } from "@shared/labs";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs({ extensionTools: true });
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "plan-editor",
        label: t("settings.editorTitle"),
        keywords: "editor extension vscode ide",
        hash: "editor",
      },
    ],
    [t],
  );

  // Core Preferences owns the interface language, so Plan › General keeps only
  // the editor row.
  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
      labs={PLAN_LABS}
      generalSearchEntries={generalSearchEntries}
      generalGroups={
        <SettingsGroup title={t("settings.editorGroupTitle")}>
          <SettingsRow
            id="editor"
            label={t("settings.editorTitle")}
            description={t("settings.editorDescription")}
            control={
              <Button variant="outline" asChild>
                <a
                  href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("settings.openEditorExtension")}
                </a>
              </Button>
            }
          />
        </SettingsGroup>
      }
      whatsNewMarkdown={changelog}
    />
  );
}
