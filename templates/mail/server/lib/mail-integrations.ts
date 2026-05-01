import crypto from "node:crypto";
import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";
import { resolveOrgIdForEmail } from "@agent-native/core/org";

const slackEmailCache = new Map<
  string,
  { email: string | null; expiresAt: number }
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

async function resolveSlackSenderEmail(
  incoming: IncomingMessage,
): Promise<string | null> {
  if (incoming.platform !== "slack") return null;
  const token = process.env.SLACK_BOT_TOKEN;
  const userId = contextString(incoming.senderId);
  const teamId = contextString(incoming.platformContext.teamId);
  if (!token || !userId) return null;

  const cacheKey = `${teamId ?? "default"}:${userId}`;
  const cached = slackEmailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.email;

  try {
    const params = new URLSearchParams({ user: userId });
    const res = await fetch(`https://slack.com/api/users.info?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: { profile?: { email?: string } };
    };
    const email = data.ok
      ? data.user?.profile?.email?.trim().toLowerCase() || null
      : null;
    slackEmailCache.set(cacheKey, {
      email,
      expiresAt: Date.now() + SLACK_EMAIL_CACHE_TTL,
    });
    return email;
  } catch {
    return null;
  }
}

async function resolveIncomingEmail(
  incoming: IncomingMessage,
): Promise<string | null> {
  if (incoming.platform === "slack") {
    return resolveSlackSenderEmail(incoming);
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
  const email = await resolveIncomingEmail(incoming);
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

  return { handled: false };
}
