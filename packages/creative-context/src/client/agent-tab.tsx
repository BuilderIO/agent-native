import { type AgentPageScope } from "@agent-native/core/client/agent-chat";
import { type SettingsTabItem } from "@agent-native/core/client/settings";
import { IconLibrary } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { CreativeContextPanel } from "./CreativeContextPanel.js";
import { creativeContextMessagesByLocale } from "./messages.js";

function libraryLabel() {
  if (typeof document === "undefined") {
    return creativeContextMessagesByLocale["en-US"].title;
  }
  const locale = document.documentElement.lang;
  return (
    creativeContextMessagesByLocale[
      locale as keyof typeof creativeContextMessagesByLocale
    ] ?? creativeContextMessagesByLocale["en-US"]
  ).title;
}

export type CreativeContextAgentTabFactory = (context: {
  scope: AgentPageScope;
  canManageOrg?: boolean;
  scopeControl: ReactNode;
}) => SettingsTabItem;

export const createCreativeContextAgentTab: CreativeContextAgentTabFactory = ({
  scope,
  canManageOrg,
  scopeControl,
}) => ({
  id: "library",
  label: libraryLabel(),
  icon: IconLibrary,
  group: "creative-context",
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
    />
  ),
});
