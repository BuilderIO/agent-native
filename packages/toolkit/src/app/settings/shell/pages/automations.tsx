import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { IconPlus } from "@tabler/icons-react";
import { lazy, Suspense, useMemo } from "react";

import { AgentAskPopover } from "../../../chat/index.js";
import { automationCreationContext } from "../../AutomationsSection.js";
import { SettingsSkeleton } from "../../SettingsSkeleton.js";
import { useSettingsPageHeader } from "../context.js";
import {
  canManageOrganizationPages,
  type SettingsPageProps,
} from "../registry.js";

const AgentJobsTab = lazy(() =>
  import("../../../agent-page/AgentJobsTab.js").then((module) => ({
    default: module.AgentJobsTab,
  })),
);

/**
 * Personal and organization automations for this app. Members create
 * organization automations too and manage the ones they created; the
 * automations service enforces that, this only mirrors it.
 */
export default function AutomationsSettingsPage({
  context,
}: SettingsPageProps) {
  const t = useT();
  const { data: org } = useOrg();
  const header = useMemo(
    () => ({
      action: (
        <AgentAskPopover
          context={automationCreationContext()}
          draftScope="settings:automations-create"
          prompt={t("jobs.automationPrompt", {
            defaultValue: "Create an automation that does this: ",
          })}
          title={t("agentChat.settingsShell.appGroup.automationsCreateTitle")}
          label={t("agentChat.settingsShell.appGroup.newAutomation")}
          icon={<IconPlus aria-hidden="true" />}
          variant="default"
        />
      ),
    }),
    [t],
  );
  useSettingsPageHeader(header);
  return (
    <Suspense fallback={<SettingsSkeleton lines={3} />}>
      <AgentJobsTab
        scope="user"
        variant="settings"
        canManageOrg={canManageOrganizationPages(context)}
        organizationId={org?.orgId}
        organizationName={org?.orgName}
      />
    </Suspense>
  );
}
