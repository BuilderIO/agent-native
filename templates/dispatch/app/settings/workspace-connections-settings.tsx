import { useT } from "@agent-native/core/client/i18n";
import {
  CORE_SETTINGS_PAGES,
  registerSettingsPages,
  SettingsSkeleton,
  settingsPageHref,
  type SettingsPageProps,
} from "@agent-native/toolkit/app/settings";
import { lazy, Suspense } from "react";
import { Link } from "react-router";

import { Button } from "../components/ui/button.js";

const WorkspaceConnectionsPage = lazy(() =>
  import("./WorkspaceConnectionsPage.js").then((module) => ({
    default: module.WorkspaceConnectionsPage,
  })),
);

const coreIntegrationsPage = CORE_SETTINGS_PAGES.find(
  (page) => page.id === "integrations",
);
if (!coreIntegrationsPage) {
  throw new Error("Core Settings has no integrations page for Dispatch");
}
const CoreIntegrationsPage = coreIntegrationsPage.component;

export function WorkspaceConnectionsContent() {
  return (
    <Suspense fallback={<SettingsSkeleton lines={4} />}>
      <WorkspaceConnectionsPage />
    </Suspense>
  );
}

function DispatchIntegrationsSettingsPage(props: SettingsPageProps) {
  const t = useT();
  if (props.sub === "workspace-connections") {
    return <WorkspaceConnectionsContent />;
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-3xl justify-end">
        <Button variant="outline" asChild>
          <Link to={settingsPageHref("integrations", "workspace-connections")}>
            {t("integrations.connectedAccounts")}
          </Link>
        </Button>
      </div>
      <CoreIntegrationsPage {...props} />
    </>
  );
}

registerSettingsPages([
  {
    ...coreIntegrationsPage,
    component: DispatchIntegrationsSettingsPage,
    legacyTabIds: [
      ...(coreIntegrationsPage.legacyTabIds ?? []),
      "integrations:workspace-connections",
    ],
    subpages: [
      ...(coreIntegrationsPage.subpages ?? []),
      {
        id: "workspace-connections",
        labelKey: "integrations.connectedAccounts",
      },
    ],
  },
]);
