import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import crypto from "node:crypto";
import { consumeLinkToken, resolveLinkedOwner } from "./dispatch-store.js";

function contextString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function identityKeyForIncoming(incoming: IncomingMessage): string | null {
  const senderId = contextString(incoming.senderId);
  if (!senderId) return null;

  if (incoming.platform === "slack") {
    const teamId = contextString(incoming.platformContext.teamId);
    return teamId ? `${teamId}:${senderId}` : senderId;
  }

  if (incoming.platform === "whatsapp") {
    const phoneNumberId = contextString(incoming.platformContext.phoneNumberId);
    return phoneNumberId ? `${phoneNumberId}:${senderId}` : senderId;
  }

  if (incoming.platform === "email") {
    return senderId.toLowerCase();
  }

  return senderId;
}

function fallbackOwnerForIncoming(incoming: IncomingMessage): string {
  const tenant =
    contextString(incoming.platformContext.teamId) ||
    contextString(incoming.platformContext.phoneNumberId) ||
    contextString(incoming.platformContext.chatId) ||
    contextString(incoming.platformContext.from) ||
    incoming.externalThreadId;
  const raw = `${incoming.platform}:${tenant}:${incoming.senderId || ""}`;
  const hash = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  return `dispatch+${hash}@integration.local`;
}

function configuredDefaultOwnerForIncoming(
  incoming: IncomingMessage,
): string | null {
  // This is intentionally Slack-only: a deployment-wide default owner grants
  // that Slack workspace access to the owner's connected agents and org
  // credentials, so other platforms should opt in with explicit identity links.
  if (incoming.platform !== "slack") return null;
  const email = process.env.DISPATCH_DEFAULT_OWNER_EMAIL?.trim();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function resolveDispatchOwner(
  incoming: IncomingMessage,
): Promise<string> {
  try {
    const externalUserId = identityKeyForIncoming(incoming);

    // Webhooks do not have the browser request's org context, so allow a safe
    // cross-org fallback when the linked platform identity maps to one owner.
    const owner = await resolveLinkedOwner(incoming.platform, externalUserId, {
      allowAnyOrgFallback: true,
    });
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

    const defaultOwner = configuredDefaultOwnerForIncoming(incoming);
    if (defaultOwner) return defaultOwner;

    return fallbackOwnerForIncoming(incoming);
  } catch {
    const defaultOwner = configuredDefaultOwnerForIncoming(incoming);
    if (defaultOwner) return defaultOwner;
    return fallbackOwnerForIncoming(incoming);
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
      externalUserId: identityKeyForIncoming(incoming),
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
