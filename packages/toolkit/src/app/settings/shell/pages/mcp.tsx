import { useT } from "@agent-native/core/client/i18n";
import { useLocale } from "@agent-native/core/client/i18n";
import {
  getMcpConnectGuides,
  resolveMcpConnectGuideId,
} from "@agent-native/core/shared/mcp-connect-content";
import { useEffect, useMemo } from "react";

import { BreadcrumbTitle } from "../../../integrations/IntegrationDetailParts.js";
import {
  McpAccessSettings,
  McpHostMark,
} from "../../../resources/McpAccessSettings.js";
import { useSettingsPageHeader, useSettingsShell } from "../context.js";
import type { SettingsPageProps } from "../registry.js";
import { settingsPageHref } from "../routing.js";

export default function McpServerSettingsPage({
  bridge,
  sub,
}: SettingsPageProps) {
  const t = useT();
  const { locale } = useLocale();
  const { navigate } = useSettingsShell();
  const guides = useMemo(() => getMcpConnectGuides(locale), [locale]);
  const guide = sub
    ? (guides.find((item) => item.id === sub) ??
      guides.find((item) => item.id === "other"))
    : null;
  const header = useMemo(
    () =>
      guide
        ? {
            title: (
              <BreadcrumbTitle
                name={guide.label}
                mark={<McpHostMark id={guide.id} className="size-4" />}
              />
            ),
          }
        : null,
    [guide],
  );
  useSettingsPageHeader(header);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("guide");
    if (!sub && query)
      navigate("mcp", resolveMcpConnectGuideId(query), { replace: true });
  }, [navigate, sub]);
  const appName =
    bridge.appName ?? t("agentChat.settingsShell.appFallbackName");
  return (
    <McpAccessSettings
      appName={appName}
      hideHeader
      {...(bridge.mcpAbout != null ? { helpText: bridge.mcpAbout } : {})}
      guideId={guide?.id ?? null}
      onSelectGuide={(id) => navigate("mcp", id)}
      guideHref={(id) => settingsPageHref("mcp", id)}
    />
  );
}
