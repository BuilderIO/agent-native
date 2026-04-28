import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import {
  SHARED_DISPATCH_OWNER,
  consumeLinkToken,
  resolveLinkedOwner,
} from "./dispatch-store.js";

export async function resolveDispatchOwner(
  incoming: IncomingMessage,
): Promise<string> {
  try {
    // Check linked identities first (works for all platforms)
    const owner = await resolveLinkedOwner(
      incoming.platform,
      incoming.senderId || null,
    );
    if (owner) return owner;

    // For email, the sender's email address is already a natural identity.
    // If the senderId looks like an email address, use it directly as the owner.
    if (
      incoming.platform === "email" &&
      incoming.senderId &&
      incoming.senderId.includes("@")
    ) {
      return incoming.senderId;
    }

    return SHARED_DISPATCH_OWNER;
  } catch {
    return SHARED_DISPATCH_OWNER;
  }
}

export async function beforeDispatchProcess(
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
      responseText: `Linked successfully. Future ${incoming.platform} messages will use ${owner}'s personal dispatch context.`,
    };
  } catch (error) {
    return {
      handled: true,
      responseText:
        error instanceof Error ? error.message : "Failed to link this account.",
    };
  }
}
