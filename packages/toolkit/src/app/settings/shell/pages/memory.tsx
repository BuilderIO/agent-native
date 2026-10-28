import { useT } from "@agent-native/core/client/i18n";
import { IconBulb, IconNotebook } from "@tabler/icons-react";
import { useMemo } from "react";

import type { ResourceSettingsGroupConfig } from "../../../resources/index.js";
import {
  LEARNINGS_RESOURCE_SEED,
  MEMORY_RESOURCE_SEED,
} from "../../../resources/index.js";
import {
  EmptyActionButton,
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
        emptyTitle: t("agentChat.settingsResources.memory.emptyTitle"),
        emptyDescription: t("agentChat.settingsResources.memory.empty"),
        emptyAction: (
          <EmptyActionButton
            label={t("agentChat.settingsResources.memory.add")}
            pending={isPending}
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
        emptyTitle: t("agentChat.settingsResources.memory.orgEmpty"),
      },
      {
        id: "learnings",
        view: "learnings",
        sources: ["personal", "shared"],
        title: t("agentChat.settingsShell.learnings"),
        emptyIcon: IconBulb,
        emptyTitle: t("agentChat.settingsResources.learnings.emptyTitle"),
        emptyDescription: t("agentChat.settingsResources.learnings.empty"),
        emptyAction: (
          <EmptyActionButton
            label={t("agentChat.settingsResources.learnings.add")}
            pending={isPending}
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
