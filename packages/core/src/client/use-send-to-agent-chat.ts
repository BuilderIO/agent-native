import { useState, createElement } from "react";
import { sendToAgentChat, type AgentChatMessage } from "./agent-chat.js";
import { useAgentChatGenerating } from "./use-agent-chat.js";
import { useDevMode } from "./use-dev-mode.js";
import { CodeRequiredDialog } from "./components/CodeRequiredDialog.js";

/**
 * Wraps sendToAgentChat with production-mode gating.
 *
 * When `requiresCode: true` is passed and the app is in production mode,
 * the dialog is shown instead of sending the message. In dev mode,
 * messages are sent normally.
 *
 * Returns a `codeRequiredDialog` React element that must be rendered
 * somewhere in the consumer's JSX tree.
 */
export function useSendToAgentChat(): {
  send: (opts: AgentChatMessage) => string | null;
  isGenerating: boolean;
  codeRequiredDialog: React.ReactNode;
} {
  const { isDevMode } = useDevMode();
  const [agentGenerating] = useAgentChatGenerating();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [featureLabel, setFeatureLabel] = useState<string | undefined>();

  function send(opts: AgentChatMessage): string | null {
    if (opts.requiresCode && !isDevMode) {
      setFeatureLabel(opts.message?.slice(0, 80));
      setDialogOpen(true);
      return null;
    }
    return sendToAgentChat(opts);
  }

  const dialog = createElement(CodeRequiredDialog, {
    open: dialogOpen,
    onClose: () => setDialogOpen(false),
    featureLabel,
  });

  return {
    send,
    isGenerating: agentGenerating,
    codeRequiredDialog: dialog,
  };
}
