import { useT } from "@agent-native/core/client/i18n";
import type { AssistantChatComposerContextProviderProps } from "@agent-native/toolkit/app/chat/chat";
import type { ComposerContextMenuItem } from "@agent-native/toolkit/composer";
import { IconVideo } from "@tabler/icons-react";

export function useClipsComposerMenuItems(): ComposerContextMenuItem[] {
  const t = useT();
  return [
    {
      id: "reference-recording",
      label: t("composerSources.reference"),
      icon: <IconVideo />,
      section: "context",
      order: 20,
      referenceType: "recording",
      referencePicker: { source: "recordings", referenceType: "recording" },
    },
  ];
}

export function ClipsComposerContextProvider({
  children,
}: AssistantChatComposerContextProviderProps) {
  return children({
    menuItems: useClipsComposerMenuItems(),
    contextItems: [],
    onRemoveContextItem: () => {},
    prepareSubmission: async (snapshot) => snapshot,
    submissionAccepted: () => {},
  });
}
