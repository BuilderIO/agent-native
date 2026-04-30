import { useState, useEffect, useCallback, createElement } from "react";
import { sendToAgentChat, type AgentChatMessage } from "./agent-chat.js";
import { useAgentChatGenerating } from "./use-agent-chat.js";
import { isInFrame, isTrustedFrameMessage } from "./frame.js";
import { CodeRequiredDialog } from "./components/CodeRequiredDialog.js";

/**
 * Wraps sendToAgentChat with code-request gating.
 *
 * When a message has `type: "code"` (or `requiresCode: true`) and no
 * frame is connected, shows a dialog explaining code changes need a
 * dev frame. When a frame IS connected, the message is sent to the
 * frame and a code-agent indicator is shown.
 *
 * Returns a `codeRequiredDialog` React element that must be rendered
 * somewhere in the consumer's JSX tree.
 */
export function useSendToAgentChat(): {
  send: (opts: AgentChatMessage) => string | null;
  isGenerating: boolean;
  /** True when a code request is being processed by the frame */
  isCodeAgentWorking: boolean;
  codeRequiredDialog: React.ReactNode;
} {
  const [agentGenerating] = useAgentChatGenerating();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [featureLabel, setFeatureLabel] = useState<string | undefined>();
  const [codeAgentWorking, setCodeAgentWorking] = useState(false);

  // Listen for code completion from frame
  useEffect(() => {
    if (!codeAgentWorking) return;
    function handler(event: MessageEvent) {
      if (!isTrustedFrameMessage(event)) return;
      if (
        event.data?.type === "agentNative.codeComplete" ||
        (event.data?.type === "agentNative.chatRunning" &&
          !event.data?.detail?.isRunning)
      ) {
        setCodeAgentWorking(false);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [codeAgentWorking]);

  const send = useCallback((opts: AgentChatMessage): string | null => {
    const isCodeRequest = opts.type === "code" || opts.requiresCode === true;

    if (isCodeRequest && !isInFrame()) {
      setFeatureLabel(opts.message?.slice(0, 80));
      setDialogOpen(true);
      return null;
    }

    if (isCodeRequest) {
      setCodeAgentWorking(true);
      opts = { ...opts, type: "code" };
    }

    return sendToAgentChat(opts);
  }, []);

  const dialog = createElement(CodeRequiredDialog, {
    open: dialogOpen,
    onClose: () => setDialogOpen(false),
    featureLabel,
  });

  return {
    send,
    isGenerating: agentGenerating,
    isCodeAgentWorking: codeAgentWorking,
    codeRequiredDialog: dialog,
  };
}
