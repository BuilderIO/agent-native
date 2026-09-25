import { lazy, Suspense } from "react";

import { useT } from "../../../i18n.js";
import { SettingsSkeleton } from "../../SettingsSkeleton.js";
import { resolveSettingsAppIdentity } from "../app-identity.js";
import type { SettingsPageProps } from "../registry.js";

const IntegrationsPage = lazy(() =>
  import("../../../integrations/IntegrationsPage.js").then((module) => ({
    default: module.IntegrationsPage,
  })),
);

const BuilderIntegrationPage = lazy(() =>
  import("../../../integrations/BuilderIntegrationPage.js").then((module) => ({
    default: module.BuilderIntegrationPage,
  })),
);

// No bridge fallback: the `integrations` tab templates pass comes from core's
// own `useAgentSettingsTabs` and carries the legacy panel this page replaces.
export default function IntegrationsSettingsPage({
  context,
  sub,
}: SettingsPageProps) {
  const t = useT();
  return (
    <Suspense fallback={<SettingsSkeleton lines={4} />}>
      {sub === "builder" ? (
        <BuilderIntegrationPage context={context} />
      ) : (
        <IntegrationsPage
          sub={sub}
          appName={
            resolveSettingsAppIdentity({ appId: context.appId }).name ??
            t("agentChat.settingsShell.appFallbackName")
          }
        />
      )}
    </Suspense>
  );
}
