import {
  sendToAgentChat,
  sendToAgentChatAndConfirm,
  sendMcpAppHostMessage,
  type AgentChatMessage,
  type SendToAgentChatAndConfirmResult,
} from "@agent-native/core/client/agent-chat";
import { sendToBuilderChat } from "@agent-native/core/client/host";

import {
  getVerifiedBuilderHostOrigin,
  isBuilderHostEmbed,
} from "./builder-host-origin";
import { isEmbedChromeRequested } from "./embed-chrome";

export const DESIGN_CHAT_STORAGE_KEY = "design";

export function sendToDesignAgentChat(opts: AgentChatMessage): string {
  return sendToAgentChat({
    ...opts,
    chatTarget: "local",
  });
}

export function sendToDesignAgentChatAndConfirm(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<SendToAgentChatAndConfirmResult> {
  return sendToAgentChatAndConfirm(
    {
      ...opts,
      chatTarget: "local",
    },
    options,
  );
}

export interface DesignSourceHandoffResult {
  target: "host" | "local";
  delivered: boolean;
  awaitingHostTurn?: boolean;
  reason?: string;
  tabId?: string;
}

const DEFAULT_HOST_HANDOFF_TIMEOUT_MS = 15_000;

export async function sendDesignSourceHandoffAndConfirm(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<DesignSourceHandoffResult> {
  if (isEmbedChromeRequested() && isBuilderHostEmbed()) {
    const posted = sendToBuilderChat({
      message: opts.message,
      context: opts.context,
      submit: true,
      targetOrigin: getVerifiedBuilderHostOrigin() ?? undefined,
    });
    return {
      target: "host",
      delivered: posted,
      ...(posted ? { awaitingHostTurn: true } : { reason: "host-post-failed" }),
    };
  }

  const hostDelivery = sendMcpAppHostMessage({
    message: opts.message,
    context: opts.context,
    mode: opts.mode,
    requestMode: opts.requestMode,
  });
  if (hostDelivery !== false) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      hostDelivery
        .then((delivered) =>
          delivered
            ? ({ delivered: true } as const)
            : ({ delivered: false, reason: "host-rejected" } as const),
        )
        .catch(() => ({ delivered: false, reason: "host-rejected" })),
      new Promise<{ delivered: false; reason: string }>((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ delivered: false, reason: "host-timeout" }),
          Math.max(100, options?.timeoutMs ?? DEFAULT_HOST_HANDOFF_TIMEOUT_MS),
        );
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return {
      target: "host",
      ...outcome,
    };
  }

  const localDelivery = await sendToDesignAgentChatAndConfirm(opts, options);
  return {
    target: "local",
    ...localDelivery,
  };
}
