import type { H3Event } from "h3";
import { getHeader, readRawBody } from "h3";

import type { EnvKeyConfig } from "../../server/create-server.js";
import { resolveSecret } from "../../server/credential-provider.js";
import type {
  IncomingMessage,
  IntegrationStatus,
  OutgoingMessage,
  PlatformAdapter,
} from "../types.js";

const BOT_FRAMEWORK_SCOPE = "https://api.botframework.com/.default";
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;

type TeamsActivity = {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
  serviceUrl?: unknown;
  channelId?: unknown;
  text?: unknown;
  replyToId?: unknown;
  from?: { id?: unknown; name?: unknown; aadObjectId?: unknown };
  recipient?: { id?: unknown; name?: unknown };
  conversation?: {
    id?: unknown;
    tenantId?: unknown;
    conversationType?: unknown;
  };
  channelData?: {
    tenant?: { id?: unknown };
    team?: { id?: unknown; name?: unknown };
    channel?: { id?: unknown; name?: unknown };
  };
};

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

const accessTokenCache = new Map<string, TokenCacheEntry>();

export function microsoftTeamsAdapter(): PlatformAdapter {
  return {
    platform: "microsoft-teams",
    label: "Microsoft Teams",
    capabilities: {
      replyText: true,
      proactiveMessages: false,
      nativeThreads: true,
      contextualReplies: true,
      deferredWebhookResponse: false,
      interactionOnly: false,
    },

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "MICROSOFT_TEAMS_APP_ID",
          label: "Microsoft Bot App ID",
          required: true,
          helpText:
            "The Microsoft App ID associated with the Azure Bot resource.",
        },
        {
          key: "MICROSOFT_TEAMS_APP_PASSWORD",
          label: "Microsoft Bot Client Secret",
          required: true,
          helpText:
            "A current client secret for the bot app registration. Store the secret value, not its secret ID.",
        },
        {
          key: "MICROSOFT_TEAMS_APP_TENANT_ID",
          label: "Microsoft Bot Tenant ID",
          required: false,
          helpText:
            "Required for single-tenant bot registrations. Multi-tenant Bot Framework apps use botframework.com.",
        },
        {
          key: "MICROSOFT_TEAMS_ALLOWED_TENANT_IDS",
          label: "Allowed Microsoft Teams Tenant IDs",
          required: true,
          helpText:
            "Comma-separated tenant IDs allowed to invoke this deployment. Production webhooks fail closed when unset.",
        },
      ];
    },

    async handleVerification(event: H3Event) {
      await readRawBodyCached(event);
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const appId = await resolveSecret("MICROSOFT_TEAMS_APP_ID");
      const appPassword = await resolveSecret("MICROSOFT_TEAMS_APP_PASSWORD");
      const authorization = getHeader(event, "authorization") ?? "";
      const activity = parseActivity(await readRawBodyCached(event));
      if (
        !appId ||
        !appPassword ||
        !authorization.startsWith("Bearer ") ||
        !activity ||
        activity.channelId !== "msteams" ||
        !readString(activity.serviceUrl)
      ) {
        return false;
      }

      try {
        const { JwtTokenValidation, SimpleCredentialProvider } =
          await import("botframework-connector");
        await JwtTokenValidation.authenticateRequest(
          activity as never,
          authorization,
          new SimpleCredentialProvider(appId, appPassword),
          "",
        );
      } catch {
        return false;
      }

      const tenantId = teamsTenantId(activity);
      return isAllowedTenant(
        tenantId,
        await resolveSecret("MICROSOFT_TEAMS_ALLOWED_TENANT_IDS"),
      );
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      const activity = parseActivity(await readRawBodyCached(event));
      if (
        !activity ||
        activity.channelId !== "msteams" ||
        activity.type !== "message"
      ) {
        return null;
      }

      const activityId = readString(activity.id);
      const conversationId = readString(activity.conversation?.id);
      const serviceUrl = normalizeServiceUrl(activity.serviceUrl);
      const tenantId = teamsTenantId(activity);
      const teamId = readString(activity.channelData?.team?.id);
      const channelId = readString(activity.channelData?.channel?.id);
      const senderId = readString(
        activity.from?.aadObjectId ?? activity.from?.id,
      );
      const text = stripTeamsMentions(readString(activity.text) ?? "");
      if (
        !activityId ||
        !conversationId ||
        !serviceUrl ||
        !tenantId ||
        !senderId ||
        !text
      ) {
        return null;
      }

      const location = teamId
        ? `:team:${teamId}:channel:${channelId ?? conversationId}`
        : "";
      const replyRef = readString(activity.replyToId) ?? activityId;

      return {
        platform: "microsoft-teams",
        externalThreadId: `tenant:${tenantId}${location}:conversation:${conversationId}`,
        text,
        senderName: readString(activity.from?.name),
        senderId,
        threadRef: conversationId,
        replyRef,
        platformContext: {
          tenantId,
          teamId,
          channelId,
          conversationId,
          conversationType: readString(activity.conversation?.conversationType),
          botFrameworkChannelId: readString(activity.channelId),
          activityId,
          replyToId: replyRef,
          serviceUrl,
          from: {
            id: readString(activity.from?.id),
            name: readString(activity.from?.name),
          },
          recipient: {
            id: readString(activity.recipient?.id),
            name: readString(activity.recipient?.name),
          },
        },
        timestamp: parseTimestamp(activity.timestamp),
      };
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const serviceUrl = normalizeServiceUrl(
        context.platformContext.serviceUrl,
      );
      const conversationId = readString(context.platformContext.conversationId);
      const activityId =
        context.replyRef ??
        readString(context.platformContext.activityId) ??
        readString(context.platformContext.replyToId);
      if (!serviceUrl || !conversationId || !activityId) {
        throw new Error("Microsoft Teams conversation reference is incomplete");
      }

      const accessToken = await getMicrosoftTeamsAccessToken();
      const response = await fetch(
        `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "message",
            text: message.text,
            replyToId: activityId,
            channelId:
              readString(context.platformContext.botFrameworkChannelId) ??
              "msteams",
            serviceUrl,
            conversation: { id: conversationId },
            from: context.platformContext.recipient,
            recipient: context.platformContext.from,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Microsoft Teams reply failed (HTTP ${response.status})`,
        );
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      return { text, platformContext: {} };
    },

    async getStatus(): Promise<IntegrationStatus> {
      const hasAppId = !!(await resolveSecret("MICROSOFT_TEAMS_APP_ID"));
      const hasAppPassword = !!(await resolveSecret(
        "MICROSOFT_TEAMS_APP_PASSWORD",
      ));
      const allowedTenants = await resolveSecret(
        "MICROSOFT_TEAMS_ALLOWED_TENANT_IDS",
      );
      const hasAllowedTenants = parseCsv(allowedTenants).size > 0;
      const configured =
        hasAppId &&
        hasAppPassword &&
        (process.env.NODE_ENV !== "production" || hasAllowedTenants);
      return {
        platform: "microsoft-teams",
        label: "Microsoft Teams",
        enabled: false,
        configured,
        details: {
          hasAppId,
          hasAppPassword,
          hasAllowedTenants,
          validation: "botframework-connector",
        },
        error: !configured
          ? "Save the Microsoft Bot App ID, client secret, and production tenant allowlist in settings"
          : undefined,
      };
    },
  };
}

export async function getMicrosoftTeamsAccessToken(): Promise<string> {
  const appId = await resolveSecret("MICROSOFT_TEAMS_APP_ID");
  const appPassword = await resolveSecret("MICROSOFT_TEAMS_APP_PASSWORD");
  const tenantId =
    (await resolveSecret("MICROSOFT_TEAMS_APP_TENANT_ID")) ??
    "botframework.com";
  if (!appId || !appPassword) {
    throw new Error("Microsoft Teams bot credentials are not configured");
  }

  const cacheKey = `${tenantId}:${appId}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: appId,
        client_secret: appPassword,
        scope: BOT_FRAMEWORK_SCOPE,
      }),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  const accessToken = readString(body?.access_token);
  const expiresIn = Number(body?.expires_in);
  if (!response.ok || !accessToken || !Number.isFinite(expiresIn)) {
    throw new Error(
      `Microsoft Teams token request failed (HTTP ${response.status})`,
    );
  }

  accessTokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000,
  });
  return accessToken;
}

export function clearMicrosoftTeamsAccessTokenCache(): void {
  accessTokenCache.clear();
}

async function readRawBodyCached(event: H3Event): Promise<string> {
  const cached = event.context.__rawBody;
  if (typeof cached === "string") return cached;
  const raw = (await readRawBody(event)) ?? "";
  event.context.__rawBody = raw;
  return raw;
}

function parseActivity(raw: string): TeamsActivity | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as TeamsActivity) : null;
  } catch {
    return null;
  }
}

function teamsTenantId(activity: TeamsActivity): string | undefined {
  return readString(
    activity.channelData?.tenant?.id ?? activity.conversation?.tenantId,
  );
}

function isAllowedTenant(
  tenantId: string | undefined,
  allowlist: string | null | undefined,
): boolean {
  if (!tenantId) return false;
  const allowed = parseCsv(allowlist);
  if (allowed.size === 0) return process.env.NODE_ENV !== "production";
  return allowed.has(tenantId);
}

function parseCsv(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeServiceUrl(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function stripTeamsMentions(text: string): string {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/gis, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
