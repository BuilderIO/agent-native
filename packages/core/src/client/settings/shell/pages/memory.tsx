import { IconBulb, IconNotebook } from "@tabler/icons-react";
import { useMemo } from "react";

import { useT } from "../../../i18n.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import {
  LEARNINGS_RESOURCE_SEED,
  MEMORY_RESOURCE_SEED,
} from "../../../resources/ResourcesPanel.js";
import {
  EmptyRowButton,
  ResourceSettingsPage,
  useOpenResourceRef,
  useSeedResource,
} from "./resource-settings-page.js";

export default function MemorySettingsPage() {
  const t = useT();
  const { ref, open } = useOpenResourceRef();
  const { seed, isPending } = useSeedResource(open);

  const groups = useMemo<ResourceSettingsGroupConfig[]>(
    () => [
      {
        id: "personal",
        view: "memory",
        sources: ["personal"],
        emptyIcon: IconNotebook,
        emptyText: t("agentChat.settingsResources.memory.empty"),
        emptyAction: (
          <EmptyRowButton
            label={t("agentChat.settingsResources.memory.add")}
            disabled={isPending}
            onClick={() =>
              seed(
                MEMORY_RESOURCE_SEED.path,
                MEMORY_RESOURCE_SEED.content,
                "personal",
              )
            }
          />
        ),
      },
      {
        id: "organization",
        view: "memory",
        sources: ["shared"],
        emptyIcon: IconNotebook,
        emptyText: t("agentChat.settingsResources.memory.orgEmpty"),
      },
      {
        id: "learnings",
        view: "learnings",
        sources: ["personal", "shared"],
        title: t("agentChat.settingsShell.learnings"),
        emptyIcon: IconBulb,
        emptyText: t("agentChat.settingsResources.learnings.empty"),
        emptyAction: (
          <EmptyRowButton
            label={t("agentChat.settingsResources.learnings.add")}
            disabled={isPending}
            onClick={() =>
              seed(
                LEARNINGS_RESOURCE_SEED.path,
                LEARNINGS_RESOURCE_SEED.content,
                "personal",
              )
            }
          />
        ),
      },
    ],
    [isPending, seed, t],
  );

  return (
    <ResourceSettingsPage view="memory" groups={groups} openResourceRef={ref} />
  );
}
