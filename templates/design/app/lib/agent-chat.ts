import {
  sendToAgentChat,
  sendToAgentChatAndConfirm,
  sendMcpAppHostMessage,
  type AgentChatMessage,
  type SendToAgentChatAndConfirmResult,
} from "@agent-native/core/client/agent-chat";
import { isInFrame } from "@agent-native/core/client/host";
import { isMcpAppWidgetEmbed } from "@agent-native/core/client/mcp-app-host";

import { sendToHostChat } from "@/lib/builder-host-chat";

import {
  getVerifiedBuilderHostOrigin,
  isBuilderHostEmbed,
} from "./builder-host-origin";
import { isEmbedChromeRequested } from "./embed-chrome";

export const DESIGN_CHAT_STORAGE_KEY = "design";

export function isDesignHostChatEmbed(): boolean {
  return (
    (isEmbedChromeRequested() && isBuilderHostEmbed()) ||
    isMcpAppWidgetEmbed() ||
    isInFrame()
  );
}

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

export type DesignHostFollowUpResult =
  | { delivered: true }
  | { delivered: "unconfirmed" }
  | {
      delivered: false;
      reason: "host-unavailable" | "host-rejected";
    };

/** Submit to a known embedding host without retrying uncertain delivery locally. */
export async function sendDesignHostFollowUp(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<DesignHostFollowUpResult> {
  if (isEmbedChromeRequested() && isBuilderHostEmbed()) {
    const targetOrigin = getVerifiedBuilderHostOrigin();
    const delivered = sendToHostChat({
      message: opts.message,
      ...(opts.context !== undefined ? { context: opts.context } : {}),
      submit: true,
      ...(targetOrigin !== null ? { targetOrigin } : {}),
    });
    return delivered
      ? { delivered: "unconfirmed" }
      : { delivered: false, reason: "host-rejected" };
  }
  if (isInFrame() && !isMcpAppWidgetEmbed()) {
    const result = await sendToAgentChatAndConfirm(
      { ...opts, chatTarget: "auto" },
      { ...options, confirmParentFrame: true },
    );
    if (result.delivered) return { delivered: true };
    if (result.reason === "timeout" || result.reason === "host-unconfirmed") {
      return { delivered: "unconfirmed" };
    }
    return { delivered: false, reason: "host-rejected" };
  }
  const delivery = sendMcpAppHostMessage({
    message: opts.message,
    ...(opts.context !== undefined ? { context: opts.context } : {}),
  });
  if (delivery === false) {
    return { delivered: false, reason: "host-unavailable" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    delivery
      .then((sent) =>
        sent === true
          ? ({ delivered: true } as const)
          : sent === false
            ? ({ delivered: false, reason: "host-rejected" } as const)
            : ({ delivered: "unconfirmed" } as const),
      )
      .catch(() => ({ delivered: "unconfirmed" }) as const),
    new Promise<DesignHostFollowUpResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ delivered: "unconfirmed" }),
        Math.max(100, options?.timeoutMs ?? DEFAULT_HOST_HANDOFF_TIMEOUT_MS),
      );
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

const DEFAULT_HOST_HANDOFF_TIMEOUT_MS = 15_000;

export async function sendDesignSourceHandoffAndConfirm(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<DesignSourceHandoffResult> {
  if (isEmbedChromeRequested() && isBuilderHostEmbed()) {
    const posted = sendToHostChat({
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
