import { useT } from "@agent-native/core/client/i18n";
import type { AssistantChatComposerContextProviderProps } from "@agent-native/toolkit/app/chat/chat";
import type { ComposerContextMenuItem } from "@agent-native/toolkit/composer";
import { IconMessages } from "@tabler/icons-react";

export function useChatComposerMenuItems(): ComposerContextMenuItem[] {
  const t = useT();
  return [
    {
      id: "reference-chat",
      label: t("composerSources.reference"),
      icon: <IconMessages />,
      section: "context",
      order: 20,
      referenceType: "chat",
      referencePicker: { source: "chats", referenceType: "chat" },
    },
  ];
}

export function ChatComposerContextProvider({
  children,
}: AssistantChatComposerContextProviderProps) {
  return children({
    menuItems: useChatComposerMenuItems(),
    contextItems: [],
    onRemoveContextItem: () => {},
    prepareSubmission: async (snapshot) => snapshot,
    submissionAccepted: () => {},
  });
}
