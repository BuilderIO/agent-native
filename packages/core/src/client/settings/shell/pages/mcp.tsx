import type { MouseEvent } from "react";

import { useT } from "../../../i18n.js";
import { McpAccessSettings } from "../../../resources/McpAccessSettings.js";
import { useSettingsShell } from "../context.js";
import type { SettingsPageProps } from "../registry.js";
import { settingsPageHref } from "../routing.js";

// Splits the translated footnote around the link, whatever the word order.
const LINK_TOKEN = "\u0000";

export default function McpServerSettingsPage({ bridge }: SettingsPageProps) {
  const t = useT();
  const { navigate } = useSettingsShell();
  const appName =
    bridge.appName ?? t("agentChat.settingsShell.appFallbackName");
  const [beforeLink, afterLink = ""] = t(
    "agentChat.settingsShell.appGroup.mcpFootnote",
    { integrations: LINK_TOKEN },
  ).split(LINK_TOKEN);
  const openIntegrations = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate("integrations");
  };
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        {bridge.mcpAbout ??
          t("agentChat.settingsShell.appGroup.mcpAbout", { app: appName })}
      </p>
      <McpAccessSettings appName={appName} hideHeader />
      <p className="text-xs text-muted-foreground">
        {beforeLink}
        <a
          href={settingsPageHref("integrations")}
          onClick={openIntegrations}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("agentChat.settingsShell.page.integrations")}
        </a>
        {afterLink}
      </p>
    </div>
  );
}
