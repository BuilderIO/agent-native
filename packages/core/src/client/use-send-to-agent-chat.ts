import { useState, useEffect, useCallback } from "react";

import {
  routesToCodeFrame,
  sendToAgentChat,
  type AgentChatMessage,
} from "./agent-chat.js";
import { isInBuilderFrame, isTrustedBuilderMessage } from "./builder-frame.js";
import { isInFrame, isTrustedFrameMessage } from "./frame.js";
import { useAgentChatGenerating } from "./use-agent-chat.js";

export interface CodeRequiredRequest {
  featureLabel?: string;
}

export function useSendToAgentChat(): {
  send: (opts: AgentChatMessage) => string | null;
  isGenerating: boolean;
  isCodeAgentWorking: boolean;
  codeRequiredRequest: CodeRequiredRequest | null;
  dismissCodeRequiredRequest: () => void;
} {
  const [agentGenerating] = useAgentChatGenerating();
  const [codeRequiredRequest, setCodeRequiredRequest] =
    useState<CodeRequiredRequest | null>(null);
  const [codeAgentWorking, setCodeAgentWorking] = useState(false);

  useEffect(() => {
    if (!codeAgentWorking) return;
    function handler(event: MessageEvent) {
      const fromAgentFrame = isTrustedFrameMessage(event);
      const fromBuilderFrame = isTrustedBuilderMessage(event);
      if (!fromAgentFrame && !fromBuilderFrame) return;
      const runningDetail = event.data?.detail ?? event.data?.data;
      if (
        event.data?.type === "agentNative.codeComplete" ||
        (fromBuilderFrame && event.data?.type === "builder.codeComplete") ||
        (event.data?.type === "agentNative.chatRunning" &&
          !runningDetail?.isRunning) ||
        (fromBuilderFrame &&
          event.data?.type === "builder.chatRunning" &&
          !runningDetail?.isRunning)
      ) {
        setCodeAgentWorking(false);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [codeAgentWorking]);

  const send = useCallback((opts: AgentChatMessage): string | null => {
    const isCodeRequest = routesToCodeFrame(opts);

    if (isCodeRequest && !isInFrame() && !isInBuilderFrame()) {
      setCodeRequiredRequest({
        featureLabel: opts.message?.slice(0, 80) || undefined,
      });
      return null;
    }

    if (isCodeRequest) {
      setCodeAgentWorking(true);
      opts = { ...opts, type: "code" };
    }

    return sendToAgentChat(opts);
  }, []);

  return {
    send,
    isGenerating: agentGenerating,
    isCodeAgentWorking: codeAgentWorking,
    codeRequiredRequest,
    dismissCodeRequiredRequest: () => setCodeRequiredRequest(null),
  };
}
