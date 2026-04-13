import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import {
  SHARED_DISPATCHER_OWNER,
  consumeLinkToken,
  resolveLinkedOwner,
} from "./dispatcher-store.js";

export async function resolveDispatcherOwner(
  incoming: IncomingMessage,
): Promise<string> {
  const owner = await resolveLinkedOwner(
    incoming.platform,
    incoming.senderId || null,
  );
  return owner || SHARED_DISPATCHER_OWNER;
}

export async function beforeDispatcherProcess(
  incoming: IncomingMessage,
  _adapter: PlatformAdapter,
): Promise<{ handled: true; responseText?: string } | { handled: false }> {
  const trimmed = incoming.text.trim();
  const match = trimmed.match(/^\/link\s+([a-zA-Z0-9_-]+)$/);
  if (!match) return { handled: false };

  try {
    const owner = await consumeLinkToken({
      platform: incoming.platform,
      token: match[1],
      externalUserId: incoming.senderId || null,
      externalUserName: incoming.senderName || null,
    });
    return {
      handled: true,
      responseText: `Linked successfully. Future ${incoming.platform} messages will use ${owner}'s personal dispatcher context.`,
    };
  } catch (error) {
    return {
      handled: true,
      responseText:
        error instanceof Error ? error.message : "Failed to link this account.",
    };
  }
}
