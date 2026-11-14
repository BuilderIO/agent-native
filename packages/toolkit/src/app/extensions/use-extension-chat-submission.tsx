import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog.js";

interface ExtensionChatMessage {
  message: string;
  context?: string | undefined;
  openSidebar: boolean;
}

interface PendingExtensionChatMessage {
  message: string;
  context?: string;
  openSidebar: boolean;
}

export function useExtensionChatSubmission() {
  const t = useT();
  const [pending, setPending] = useState<{
    input: PendingExtensionChatMessage;
    onConfirmed?: () => void;
  } | null>(null);

  const send = (
    input: ExtensionChatMessage & { submit: boolean },
    onConfirmed?: () => void,
  ) => {
    const message: PendingExtensionChatMessage = {
      message: input.message,
      ...(input.context !== undefined ? { context: input.context } : {}),
      openSidebar: input.openSidebar,
    };
    if (!input.submit) {
      sendToAgentChat({ ...message, submit: false });
      return;
    }
    setPending(
      (current) =>
        current ?? {
          input: message,
          ...(onConfirmed ? { onConfirmed } : {}),
        },
    );
  };

  const confirmation = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("agentChat.extensions.confirmAgentMessage")}
          </AlertDialogTitle>
          <AlertDialogDescription className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
            {pending?.input.message}
            {pending?.input.context !== undefined && (
              <span className="mt-3 block border-t pt-3">
                <span className="block font-medium">
                  {t("agentChat.extensions.context")}
                </span>
                <span className="block">{pending.input.context}</span>
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t("agentChat.extensions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!pending) return;
              sendToAgentChat({ ...pending.input, submit: true });
              pending.onConfirmed?.();
              setPending(null);
            }}
          >
            {t("agentChat.extensions.sendToAgent")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { send, confirmation, cancel: () => setPending(null) };
}
