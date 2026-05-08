import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import crypto from "node:crypto";
import { consumeLinkToken, resolveLinkedOwner } from "./dispatch-store.js";

type SlackSenderProfile = {
  email: string | null;
  name: string | null;
};

const slackProfileCache = new Map<
  string,
  { profile: SlackSenderProfile; expiresAt: number }
>();
const SLACK_PROFILE_CACHE_TTL = 10 * 60 * 1000;

function contextString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function identityKeyForIncoming(
  incoming: IncomingMessage,
): string | null {
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

async function resolveSlackSenderProfile(
  incoming: IncomingMessage,
): Promise<SlackSenderProfile> {
  if (incoming.platform !== "slack") return { email: null, name: null };
  const token = process.env.SLACK_BOT_TOKEN;
  const userId = contextString(incoming.senderId);
  const teamId = contextString(incoming.platformContext.teamId);
  if (!token || !userId) return { email: null, name: null };

  const cacheKey = `${teamId ?? "default"}:${userId}`;
  const cached = slackProfileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  try {
    const params = new URLSearchParams({ user: userId });
    const res = await fetch(`https://slack.com/api/users.info?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: {
        real_name?: string;
        name?: string;
        profile?: {
          email?: string;
          real_name?: string;
          display_name?: string;
        };
      };
    };
    const profile = data.ok
      ? {
          email: data.user?.profile?.email?.trim().toLowerCase() || null,
          name:
            data.user?.profile?.real_name?.trim() ||
            data.user?.profile?.display_name?.trim() ||
            data.user?.real_name?.trim() ||
            data.user?.name?.trim() ||
            null,
        }
      : { email: null, name: null };
    slackProfileCache.set(cacheKey, {
      profile,
      expiresAt: Date.now() + SLACK_PROFILE_CACHE_TTL,
    });
    return profile;
  } catch {
    return { email: null, name: null };
  }
}

async function resolveSlackOwnerFromVerifiedEmail(
  incoming: IncomingMessage,
): Promise<string | null> {
  const profile = await resolveSlackSenderProfile(incoming);
  if (!profile.email) return null;

  incoming.senderEmail = profile.email;
  incoming.platformContext.senderEmail = profile.email;
  if (profile.name) {
    incoming.senderName = profile.name;
    incoming.platformContext.senderName = profile.name;
  }

  const orgId = await resolveOrgIdForEmail(profile.email);
  return orgId ? profile.email : null;
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

    // Slack gives us a user id in the event payload. Resolve it to a verified
    // workspace email and use that user's own org context when they are an
    // Agent-Native member, so artifacts created via @agent-native are visible
    // when they open the target app.
    if (incoming.platform === "slack") {
      const slackOwner = await resolveSlackOwnerFromVerifiedEmail(incoming);
      if (slackOwner) return slackOwner;
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
