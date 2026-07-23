import type { H3Event } from "h3";
import { getHeader, readRawBody } from "h3";
import nacl from "tweetnacl";

import type { EnvKeyConfig } from "../../server/create-server.js";
import { resolveSecret } from "../../server/credential-provider.js";
import type {
  IncomingMessage,
  IntegrationStatus,
  OutgoingMessage,
  PlatformAdapter,
  PlatformDeliveryReceipt,
} from "../types.js";

const DISCORD_MAX_CONTENT_LENGTH = 2_000;
const DISCORD_PING = 1;
const DISCORD_APPLICATION_COMMAND = 2;
const DISCORD_CHAT_INPUT_COMMAND = 1;
const DISCORD_PONG = 1;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

type DiscordInteraction = {
  id?: unknown;
  application_id?: unknown;
  type?: unknown;
  token?: unknown;
  guild_id?: unknown;
  channel_id?: unknown;
  member?: {
    nick?: unknown;
    user?: DiscordUser;
  };
  user?: DiscordUser;
  data?: {
    type?: unknown;
    name?: unknown;
    options?: unknown;
  };
  authorizing_integration_owners?: Record<string, unknown>;
};

type DiscordUser = {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  bot?: unknown;
};

export function discordAdapter(): PlatformAdapter {
  return {
    platform: "discord",
    label: "Discord",
    capabilities: {
      replyText: true,
      proactiveMessages: false,
      nativeThreads: false,
      contextualReplies: false,
      deferredWebhookResponse: true,
      interactionOnly: true,
    },

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "DISCORD_APPLICATION_ID",
          label: "Discord Application ID",
          required: true,
          helpText:
            "General Information → Application ID in the Discord Developer Portal.",
        },
        {
          key: "DISCORD_PUBLIC_KEY",
          label: "Discord Public Key",
          required: true,
          helpText:
            "General Information → Public Key. Used to verify every interaction webhook.",
        },
      ];
    },

    async handleVerification(event: H3Event) {
      const raw = await readRawBodyCached(event);
      const interaction = parseInteraction(raw);
      if (interaction?.type === DISCORD_PING) {
        return { handled: true, response: { type: DISCORD_PONG } };
      }
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const publicKey = await resolveSecret("DISCORD_PUBLIC_KEY");
      const applicationId = await resolveSecret("DISCORD_APPLICATION_ID");
      const signature = getHeader(event, "x-signature-ed25519");
      const timestamp = getHeader(event, "x-signature-timestamp");
      if (
        !publicKey ||
        !applicationId ||
        !signature ||
        !timestamp ||
        !/^\d+$/.test(timestamp) ||
        !/^[0-9a-f]{64}$/i.test(publicKey) ||
        !/^[0-9a-f]{128}$/i.test(signature)
      ) {
        return false;
      }
      const signedAtMs = Number(timestamp) * 1000;
      if (
        !Number.isSafeInteger(signedAtMs) ||
        Math.abs(Date.now() - signedAtMs) > DISCORD_SIGNATURE_MAX_SKEW_MS
      ) {
        return false;
      }

      const raw = await readRawBodyCached(event);
      const interaction = parseInteraction(raw);
      if (
        !interaction ||
        readString(interaction.application_id) !== applicationId
      ) {
        return false;
      }

      try {
        return nacl.sign.detached.verify(
          new TextEncoder().encode(timestamp + raw),
          hexToBytes(signature),
          hexToBytes(publicKey),
        );
      } catch {
        return false;
      }
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      const interaction = parseInteraction(await readRawBodyCached(event));
      if (
        !interaction ||
        interaction.type !== DISCORD_APPLICATION_COMMAND ||
        interaction.data?.type !== DISCORD_CHAT_INPUT_COMMAND
      ) {
        return null;
      }

      const interactionId = readString(interaction.id);
      const applicationId = readString(interaction.application_id);
      const interactionToken = readString(interaction.token);
      const channelId = readString(interaction.channel_id);
      const guildId = readString(interaction.guild_id);
      const user = interaction.member?.user ?? interaction.user;
      const userId = readString(user?.id);
      const commandName = readString(interaction.data.name);
      const text = extractCommandText(interaction.data.options);
      if (
        !interactionId ||
        !applicationId ||
        !interactionToken ||
        !channelId ||
        !userId ||
        !commandName ||
        !text ||
        user?.bot === true
      ) {
        return null;
      }

      const installationOwner =
        readString(interaction.authorizing_integration_owners?.["0"]) ??
        readString(interaction.authorizing_integration_owners?.["1"]);
      const conversationScope = guildId
        ? `guild:${guildId}:channel:${channelId}`
        : `dm:${channelId}:user:${userId}`;

      return {
        platform: "discord",
        externalThreadId: `app:${applicationId}:${conversationScope}`,
        text,
        senderName:
          readString(interaction.member?.nick) ??
          readString(user?.global_name) ??
          readString(user?.username),
        senderId: userId,
        platformContext: {
          applicationId,
          interactionId,
          commandName,
          channelId,
          guildId,
          installationOwner,
          interactionSurface: "outgoing-webhook",
        },
        responseContext: { interactionToken },
        timestamp: Date.now(),
      };
    },

    getImmediateWebhookResponse(incoming: IncomingMessage) {
      if (!readString(incoming.responseContext?.interactionToken)) return null;
      return {
        status: 200,
        body: {
          type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
          data: { allowed_mentions: { parse: [] } },
        },
      };
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void | PlatformDeliveryReceipt> {
      const applicationId = readString(context.platformContext.applicationId);
      const interactionToken = readString(
        context.responseContext?.interactionToken,
      );
      if (!applicationId || !interactionToken) {
        throw new Error(
          "Discord interaction response is unavailable or has expired",
        );
      }

      const chunks = splitMessage(message.text, DISCORD_MAX_CONTENT_LENGTH);
      if (chunks.length === 0) return;

      await discordWebhookFetch(
        `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
        "PATCH",
        chunks[0],
      );

      for (const chunk of chunks.slice(1)) {
        await discordWebhookFetch(
          `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`,
          "POST",
          chunk,
        );
      }
      return { status: "delivered" };
    },

    formatAgentResponse(text: string): OutgoingMessage {
      return {
        text,
        platformContext: { allowedMentions: { parse: [] } },
      };
    },

    async getStatus(): Promise<IntegrationStatus> {
      const hasApplicationId = !!(await resolveSecret(
        "DISCORD_APPLICATION_ID",
      ));
      const hasPublicKey = !!(await resolveSecret("DISCORD_PUBLIC_KEY"));
      const configured = hasApplicationId && hasPublicKey;
      return {
        platform: "discord",
        label: "Discord",
        enabled: false,
        configured,
        details: {
          hasApplicationId,
          hasPublicKey,
          surface: "interactions",
          ordinaryMessageIngestion: false,
        },
        error: !configured
          ? "Save DISCORD_APPLICATION_ID and DISCORD_PUBLIC_KEY in settings"
          : undefined,
      };
    },
  };
}

async function readRawBodyCached(event: H3Event): Promise<string> {
  const cached = event.context.__rawBody;
  if (typeof cached === "string") return cached;
  const raw = (await readRawBody(event)) ?? "";
  event.context.__rawBody = raw;
  return raw;
}

function parseInteraction(raw: string): DiscordInteraction | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as DiscordInteraction)
      : null;
  } catch {
    return null;
  }
}

function extractCommandText(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const values: string[] = [];
  const visit = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const option = item as {
        name?: unknown;
        value?: unknown;
        options?: unknown;
      };
      if (Array.isArray(option.options)) visit(option.options);
      if (
        typeof option.value === "string" ||
        typeof option.value === "number" ||
        typeof option.value === "boolean"
      ) {
        values.push(String(option.value));
      }
    }
  };
  visit(options);
  return values.join(" ").trim() || null;
}

async function discordWebhookFetch(
  url: string,
  method: "PATCH" | "POST",
  content: string,
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Discord interaction response failed (HTTP ${response.status})`,
    );
  }
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function splitMessage(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
