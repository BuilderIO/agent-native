import { useT } from "@agent-native/core/client/i18n";
import type { AssistantChatComposerContextProviderProps } from "@agent-native/toolkit/app/chat/chat";
import type { ComposerContextMenuItem } from "@agent-native/toolkit/composer";
import { IconChartBar } from "@tabler/icons-react";

export function useAnalyticsComposerMenuItems(): ComposerContextMenuItem[] {
  const t = useT();
  return [
    {
      id: "reference-dashboard",
      label: t("composerSources.reference"),
      icon: <IconChartBar />,
      section: "context",
      order: 20,
      referenceType: "dashboard",
      referencePicker: { source: "dashboards", referenceType: "dashboard" },
    },
  ];
}

export function AnalyticsComposerContextProvider({
  children,
}: AssistantChatComposerContextProviderProps) {
  return children({ menuItems: useAnalyticsComposerMenuItems() });
}
