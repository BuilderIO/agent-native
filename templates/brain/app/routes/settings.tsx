import { SettingsTabsPage, useAgentSettingsTabs } from "@agent-native/toolkit/app/settings";
import { Navigate, useSearchParams } from "react-router";

import { useBrainSettingsAreas } from "@/components/settings/BrainSettingsAreas";
import { brainSettingsRedirect } from "@/lib/settings-navigation";

import changelog from "../../CHANGELOG.md?raw";

/**
 * Brain › General with its areas as tabs. Every row saves as it changes, so
 * there is no page-level Save.
 */
export default function SettingsRoute() {
  const agentSettingsTabs = useAgentSettingsTabs();
  const appAreas = useBrainSettingsAreas();
  const [searchParams] = useSearchParams();
  const redirect = brainSettingsRedirect(searchParams.get("section"));
  if (redirect) return <Navigate to={redirect} replace />;
  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      appAreas={appAreas}
      whatsNewMarkdown={changelog}
    />
  );
}
