import { lazy, Suspense } from "react";

import { SettingsSkeleton } from "../../SettingsSkeleton.js";
import type { SettingsPageProps } from "../registry.js";

const IntegrationsPanel = lazy(() =>
  import("../../../integrations/IntegrationsPanel.js").then((module) => ({
    default: module.IntegrationsPanel,
  })),
);

export default function IntegrationsSettingsPage({
  bridge,
}: SettingsPageProps) {
  const tab = bridge.tab("integrations", "connections");
  if (tab) return <>{tab.content}</>;
  return (
    <Suspense fallback={<SettingsSkeleton lines={4} />}>
      <IntegrationsPanel />
    </Suspense>
  );
}
