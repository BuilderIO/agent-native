import { type AgentPageScope } from "@agent-native/core/client/agent-chat";
import { type SettingsTabItem } from "@agent-native/core/client/settings";
import { IconLibrary } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  CreativeContextPanel,
  type CreativeContextPanelProps,
} from "./CreativeContextPanel.js";
import { creativeContextMessagesByLocale } from "./messages.js";

function creativeContextMessages() {
  const locale =
    typeof document === "undefined" ? "en-US" : document.documentElement.lang;
  return (
    creativeContextMessagesByLocale[
      locale as keyof typeof creativeContextMessagesByLocale
    ] ?? creativeContextMessagesByLocale["en-US"]
  );
}

export type CreativeContextAgentTabFactory = (context: {
  scope: AgentPageScope;
  canManageOrg?: boolean;
  scopeControl: ReactNode;
  /** `"settings"` when the redesigned Settings page supplies the title. */
  variant?: CreativeContextPanelProps["variant"];
}) => SettingsTabItem;

export const createCreativeContextAgentTab: CreativeContextAgentTabFactory = ({
  scope,
  canManageOrg,
  scopeControl,
  variant,
}) => ({
  id: "library",
  label: creativeContextMessages().title,
  icon: IconLibrary,
  group: "creative-context",
  groupLabel: creativeContextMessages().share.title,
  keywords: "creative context library sources packs brand DNA reuse",
  searchEntries: [
    {
      id: "creative-context-sources",
      label: "Creative context sources",
      keywords: "references imports documents assets",
    },
    {
      id: "creative-context-packs",
      label: "Context packs",
      keywords: "generation provenance pinned",
    },
  ],
  content: (
    <CreativeContextPanel
      scope={scope}
      canManageOrg={canManageOrg}
      scopeControl={scopeControl}
      variant={variant}
    />
  ),
});
