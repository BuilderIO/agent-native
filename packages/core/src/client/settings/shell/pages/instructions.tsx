import { IconFileText } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { useT } from "../../../i18n.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import {
  EmptyActionButton,
  InstructionsDialog,
  ResourceSettingsPage,
  useDispatchGroup,
  useOpenResourceRef,
  useOrganizationResourceAccess,
} from "./resource-settings-page.js";

export default function InstructionsSettingsPage() {
  const t = useT();
  const { ref } = useOpenResourceRef();
  const { orgName } = useOrganizationResourceAccess();
  const [adding, setAdding] = useState(false);
  const dispatchGroup = useDispatchGroup("instructions");

  const groups = useMemo<ResourceSettingsGroupConfig[]>(
    () => [
      {
        id: "personal",
        view: "instructions",
        sources: ["personal"],
        emptyIcon: IconFileText,
        emptyTitle: t("agentChat.settingsResources.instructions.emptyTitle"),
        emptyDescription: t("agentChat.settingsResources.instructions.empty"),
        emptyAction: (
          <EmptyActionButton
            label={t("agentChat.settingsResources.instructions.add")}
            onClick={() => setAdding(true)}
          />
        ),
      },
      {
        id: "organization",
        view: "instructions",
        sources: ["shared"],
        emptyIcon: IconFileText,
        emptyTitle: t("agentChat.settingsResources.instructions.orgEmpty", {
          org: orgName || t("agentChat.settingsResources.organization"),
        }),
      },
      dispatchGroup,
    ],
    [dispatchGroup, orgName, t],
  );

  return (
    <>
      <ResourceSettingsPage
        view="instructions"
        groups={groups}
        openResourceRef={ref}
      />
      <InstructionsDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
