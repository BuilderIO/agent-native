import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconBolt } from "@tabler/icons-react";
import { useMemo } from "react";

import type { ResourceSettingsGroupConfig } from "../../../resources/index.js";
import { resolveSettingsAppIdentity } from "../app-identity.js";
import type { SettingsPageProps } from "../registry.js";
import {
  AddSkillMenu,
  ResourceSettingsPage,
  useDispatchGroup,
  useOpenResourceRef,
  useOrganizationResourceAccess,
} from "./resource-settings-page.js";

export default function SkillsSettingsPage({
  onDescribe,
  trashRemovedSkills,
}: Partial<Pick<SettingsPageProps, "pageId">> & {
  onDescribe?: (message: AgentChatMessage) => Promise<void>;
  trashRemovedSkills?: boolean;
} = {}) {
  const t = useT();
  const { ref, open } = useOpenResourceRef();
  const { canEditOrg, orgName, hasOrg } = useOrganizationResourceAccess();
  const isOrgAdmin = hasOrg && canEditOrg;
  const dispatchGroup = useDispatchGroup("skills");
  const appName = resolveSettingsAppIdentity({}).name;

  const groups = useMemo<ResourceSettingsGroupConfig[]>(() => {
    const org = orgName ?? t("agentChat.settingsResources.organization");
    return [
      {
        id: "personal",
        view: "skills",
        sources: ["personal"],
        description: t("agentChat.settingsResources.skills.personalHint"),
        emptyIcon: IconBolt,
        emptyTitle: t("agentChat.settingsResources.skills.emptyTitle"),
        emptyDescription: t("agentChat.settingsResources.skills.empty"),
        emptyAction: (
          <AddSkillMenu
            scope="personal"
            placement="empty"
            onCreated={open}
            onDescribe={onDescribe}
          />
        ),
        action: (
          <AddSkillMenu
            scope="personal"
            placement="group"
            label={
              isOrgAdmin
                ? t("agentChat.settingsResources.skills.addForMe")
                : undefined
            }
            onCreated={open}
            onDescribe={onDescribe}
          />
        ),
      },
      {
        id: "organization",
        view: "skills",
        sources: ["shared"],
        description: hasOrg
          ? isOrgAdmin
            ? t("agentChat.settingsResources.skills.orgAdminHint", { org })
            : t("agentChat.settingsResources.skills.orgHint", { org })
          : undefined,
        emptyIcon: IconBolt,
        emptyTitle: t("agentChat.settingsResources.skills.orgEmpty"),
        emptyAction: (
          <AddSkillMenu
            scope="shared"
            placement="empty"
            onCreated={open}
            onDescribe={onDescribe}
          />
        ),
        action: canEditOrg ? (
          <AddSkillMenu
            scope="shared"
            placement="group"
            label={t("agentChat.settingsResources.skills.addForEveryone")}
            onCreated={open}
            onDescribe={onDescribe}
          />
        ) : undefined,
      },
      {
        ...dispatchGroup,
        description: t("agentChat.settingsResources.skills.dispatchHint", {
          app: appName ?? t("agentChat.settingsResources.skills.thisApp"),
        }),
      },
    ];
  }, [
    appName,
    canEditOrg,
    dispatchGroup,
    hasOrg,
    isOrgAdmin,
    onDescribe,
    open,
    orgName,
    t,
  ]);

  return (
    <ResourceSettingsPage
      view="skills"
      groups={groups}
      openResourceRef={ref}
      trashRemovedSkills={trashRemovedSkills}
    />
  );
}
