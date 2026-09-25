import { IconBolt } from "@tabler/icons-react";
import { useMemo } from "react";

import { useT } from "../../../i18n.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import { useSettingsPageHeader } from "../context.js";
import {
  AddSkillMenu,
  ResourceSettingsPage,
  useDispatchGroup,
  useOpenResourceRef,
  useOrganizationResourceAccess,
} from "./resource-settings-page.js";

export default function SkillsSettingsPage() {
  const t = useT();
  const { ref, open } = useOpenResourceRef();
  const { canEditOrg } = useOrganizationResourceAccess();
  const dispatchGroup = useDispatchGroup("skills");

  const header = useMemo(
    () => ({
      action: (
        <AddSkillMenu scope="personal" placement="header" onCreated={open} />
      ),
    }),
    [open],
  );
  useSettingsPageHeader(header);

  const groups = useMemo<ResourceSettingsGroupConfig[]>(
    () => [
      {
        id: "personal",
        view: "skills",
        sources: ["personal"],
        emptyIcon: IconBolt,
        emptyText: t("agentChat.settingsResources.skills.empty"),
      },
      {
        id: "organization",
        view: "skills",
        sources: ["shared"],
        emptyIcon: IconBolt,
        emptyText: t("agentChat.settingsResources.skills.orgEmpty"),
        action: canEditOrg ? (
          <AddSkillMenu scope="shared" placement="group" onCreated={open} />
        ) : undefined,
      },
      dispatchGroup,
    ],
    [canEditOrg, dispatchGroup, open, t],
  );

  return (
    <ResourceSettingsPage view="skills" groups={groups} openResourceRef={ref} />
  );
}
