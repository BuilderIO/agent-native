import crypto from "node:crypto";
import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import { resolveOrgIdForEmail } from "@agent-native/core/org";

type SlackSenderProfile = {
  email: string | null;
  name: string | null;
};

const slackProfileCache = new Map<
  string,
  { profile: SlackSenderProfile; expiresAt: number }
>();
const SLACK_EMAIL_CACHE_TTL = 10 * 60 * 1000;

function contextString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function fallbackOwnerForIncoming(incoming: IncomingMessage): string {
  const tenant =
    contextString(incoming.platformContext.teamId) ||
    contextString(incoming.platformContext.channelId) ||
    incoming.externalThreadId;
  const raw = `${incoming.platform}:${tenant}:${incoming.senderId || ""}`;
  const hash = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  return `mail+${hash}@integration.local`;
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
      expiresAt: Date.now() + SLACK_EMAIL_CACHE_TTL,
    });
    return profile;
  } catch {
    return { email: null, name: null };
  }
}

async function resolveIncomingEmail(
  incoming: IncomingMessage,
): Promise<string | null> {
  if (incoming.platform === "slack") {
    return (await resolveSlackSenderProfile(incoming)).email;
  }
  if (incoming.senderId?.includes("@")) {
    return incoming.senderId.trim().toLowerCase();
  }
  return null;
}

export async function resolveMailIntegrationOwner(
  incoming: IncomingMessage,
): Promise<string> {
  return (
    (await resolveIncomingEmail(incoming)) ?? fallbackOwnerForIncoming(incoming)
  );
}

export async function beforeMailIntegrationProcess(
  incoming: IncomingMessage,
  _adapter: PlatformAdapter,
): Promise<{ handled: true; responseText?: string } | { handled: false }> {
  const profile =
    incoming.platform === "slack"
      ? await resolveSlackSenderProfile(incoming)
      : { email: await resolveIncomingEmail(incoming), name: null };
  const email = profile.email;
  if (!email) {
    return {
      handled: true,
      responseText:
        "I could not verify your workspace email, so I cannot queue mail drafts. Ask an admin to grant the Slack app access to user emails and make sure you are in the Agent-Native organization.",
    };
  }

  const orgId = await resolveOrgIdForEmail(email);
  if (!orgId) {
    return {
      handled: true,
      responseText:
        "I can only queue email drafts for Agent-Native organization members. Ask an organization owner to invite you first.",
    };
  }

  incoming.senderEmail = email;
  incoming.senderName = profile.name || incoming.senderName;
  incoming.platformContext.senderEmail = email;
  if (profile.name) incoming.platformContext.senderName = profile.name;

  return { handled: false };
}
