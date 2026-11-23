import { useT } from "@agent-native/core/client/i18n";
import { McpIntegrationsLanding } from "@agent-native/toolkit/app/integrations";
import { SettingsGroup } from "@agent-native/toolkit/app/settings";
import { Link, useNavigate } from "react-router";

import { useAgentSettingsNavigation } from "./useAgentSettingsNavigation";

export function AnalyticsIntegrationsPage() {
  const t = useT();
  useAgentSettingsNavigation(useNavigate());
  return (
    <div className="space-y-6">
      <McpIntegrationsLanding showTitle={false} showDescription={false} />
      <SettingsGroup
        title={t("analytics.gitIntegrations.integrationsLinkTitle")}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t("analytics.gitIntegrations.integrationsLinkDescription")}
          </p>
          <Link
            className="shrink-0 text-sm font-medium underline"
            to="/settings/git-integrations"
          >
            {t("analytics.gitIntegrations.integrationsLinkAction")}
          </Link>
        </div>
      </SettingsGroup>
    </div>
  );
}
