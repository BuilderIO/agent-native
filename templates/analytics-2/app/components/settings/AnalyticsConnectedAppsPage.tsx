import { useT } from "@agent-native/core/client/i18n";
import { getDefaultMcpIntegrations } from "@agent-native/core/client/resources/mcp-integration-catalog";
import { McpIntegrationsSection } from "@agent-native/toolkit/app/integrations";
import { SettingsGroup } from "@agent-native/toolkit/app/settings";

import { ANALYTICS_MCP_INTEGRATIONS } from "../../../shared/connected-apps";

const CONNECTABLE_APPS = getDefaultMcpIntegrations(ANALYTICS_MCP_INTEGRATIONS);

export function AnalyticsConnectedAppsPage() {
  const t = useT();
  return (
    <SettingsGroup title={t("analytics.settings.rail.connectedApps")}>
      <McpIntegrationsSection
        integrations={CONNECTABLE_APPS}
        showHeader={false}
      />
    </SettingsGroup>
  );
}
