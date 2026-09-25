import { lazy, Suspense } from "react";

import { SettingsSkeleton } from "../../SettingsSkeleton.js";

const AgentJobsTab = lazy(() =>
  import("../../../agent-page/AgentJobsTab.js").then((module) => ({
    default: module.AgentJobsTab,
  })),
);

export default function AutomationsSettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton lines={3} />}>
      <AgentJobsTab scope="user" canManageOrg hideHeader />
    </Suspense>
  );
}
