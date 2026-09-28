import { IconFolder } from "@tabler/icons-react";
import { useMemo } from "react";

import { useT } from "../../../i18n.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import { useSettingsPageHeader } from "../context.js";
import {
  AddFileMenu,
  ResourceSettingsPage,
  useDispatchGroup,
  useOpenResourceRef,
  useOrganizationResourceAccess,
} from "./resource-settings-page.js";

export default function FilesSettingsPage() {
  const t = useT();
  const { ref, open } = useOpenResourceRef();
  const { canEditOrg } = useOrganizationResourceAccess();
  const dispatchGroup = useDispatchGroup("files");

  const header = useMemo(
    () => ({
      action: (
        <AddFileMenu scope="personal" placement="header" onCreated={open} />
      ),
    }),
    [open],
  );
  useSettingsPageHeader(header);

  const groups = useMemo<ResourceSettingsGroupConfig[]>(
    () => [
      {
        id: "personal",
        view: "files",
        sources: ["personal"],
        emptyIcon: IconFolder,
        emptyTitle: t("agentChat.settingsResources.files.emptyTitle"),
        emptyDescription: t("agentChat.settingsResources.files.empty"),
        emptyAction: (
          <AddFileMenu scope="personal" placement="empty" onCreated={open} />
        ),
      },
      {
        id: "organization",
        view: "files",
        sources: ["shared"],
        emptyIcon: IconFolder,
        emptyTitle: t("agentChat.settingsResources.files.orgEmpty"),
        emptyAction: (
          <AddFileMenu scope="shared" placement="empty" onCreated={open} />
        ),
        action: canEditOrg ? (
          <AddFileMenu scope="shared" placement="group" onCreated={open} />
        ) : undefined,
      },
      dispatchGroup,
    ],
    [canEditOrg, dispatchGroup, open, t],
  );

  return (
    <ResourceSettingsPage view="files" groups={groups} openResourceRef={ref} />
  );
}
