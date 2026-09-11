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

/**
 * Ack-confirmed variant of `sendToDesignAgentChat`. Resolves once the
 * message either became a visible chat turn (`delivered: true`) or was
 * definitively rejected/timed out (`delivered: false`) — use this wherever
 * the caller owns state (draw overlay strokes, queued comment pins) that
 * must not be discarded on a silent drop. See the `design-canvas/
 * annotation-submit.ts` docblock for the contract this backs.
 */
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
  /**
   * The host accepted the handoff and owns the turn from here. Callers must not
   * treat this as applied: the edits stay pending until that turn settles, or a
   * failed run would silently discard them.
   */
  awaitingHostTurn?: boolean;
  reason?: string;
  tabId?: string;
}

const DEFAULT_HOST_HANDOFF_TIMEOUT_MS = 15_000;

/**
 * Pending localhost source edits belong in the coding host when Design is
 * running as an MCP App. Ordinary Design pages have no host bridge, so they
 * keep the existing local Design-agent path.
 *
 * A rejected host request never falls through to the local agent: the host may
 * have accepted the turn even when its acknowledgement was lost, and a second
 * source-writing turn would be unsafe.
 */
export async function sendDesignSourceHandoffAndConfirm(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<DesignSourceHandoffResult> {
  // `embedChrome` alone is a display preference any embedder can ask for, so the
  // shell route is what decides who receives source-edit context.
  if (isEmbedChromeRequested() && isBuilderHostEmbed()) {
    const posted = sendToBuilderChat({
      message: opts.message,
      context: opts.context,
      // Runs the turn rather than prefilling: the prompt is generated from the
      // pending edits, so there is nothing for the user to write or review.
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
