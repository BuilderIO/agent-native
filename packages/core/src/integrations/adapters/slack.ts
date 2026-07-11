import type { H3Event } from "h3";
import { createError, getHeader, readRawBody } from "h3";

import type { EnvKeyConfig } from "../../server/create-server.js";
import { resolveSecret } from "../../server/credential-provider.js";
import { getRequestContext } from "../../server/request-context.js";
import { getIntegrationRequestContext } from "../../server/request-context.js";
import { consumeIntegrationAwaitingInput } from "../awaiting-input-store.js";
import { createIntegrationControl } from "../controls-store.js";
import {
  getActiveIntegrationInstallationByKey,
  getActiveIntegrationInstallationForTenant,
  listIntegrationInstallations,
  resolveIntegrationTokenBundle,
} from "../installations-store.js";
import { hasActivePendingTask } from "../pending-tasks-store.js";
import { slackInstallationKey } from "../slack-oauth.js";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  OutboundTarget,
  PlatformRunProgress,
  PlatformRunProgressRef,
  IntegrationContextMessage,
  IntegrationFileReference,
} from "../types.js";

/** Slack's max message length */
const SLACK_MAX_LENGTH = 4000;
const SLACK_SECTION_TEXT_MAX_LENGTH = 3000;
const SLACK_API_TIMEOUT_MS = 10_000;
// Permalink lookup happens on Slack's acknowledgement path, so keep it well
// inside Slack's three-second Events API deadline. Failure is non-fatal: the
// normalized message still carries channel/thread ids for replies.
const SLACK_PERMALINK_TIMEOUT_MS = 1_000;
const SLACK_CONTEXT_MESSAGE_LIMIT = 15;
const SLACK_CONTEXT_TEXT_LIMIT = 2_000;
const SLACK_CALM_PROGRESS_THRESHOLD_SECONDS = 30;

export interface SlackAdapterOptions {
  /** Resolve the bot token for the exact Slack installation. */
  resolveBotToken?: (incoming: IncomingMessage) => Promise<string | undefined>;
  /** Override active-thread detection for hosted adapters/tests. */
  isThreadActive?: (incoming: IncomingMessage) => Promise<boolean>;
  /** Override one-shot clarification-window consumption for tests. */
  consumeAwaitingInput?: (incoming: IncomingMessage) => Promise<boolean>;
}

/**
 * Create a Slack platform adapter.
 *
 * Required env vars:
 * - SLACK_BOT_TOKEN — Bot user OAuth token (xoxb-...)
 * - SLACK_SIGNING_SECRET — Used to verify webhook signatures
 *
 * Optional env vars:
 * - SLACK_ALLOWED_TEAM_IDS — Comma-separated list of Slack workspace
 *   `team_id` values (e.g. "T012ABCDEF,T034GHIJKL") that this deployment
 *   accepts events from. Required in production and strongly recommended
 *   to prevent cross-workspace event injection (H1 in the webhook audit):
 *   the global `SLACK_SIGNING_SECRET` is the same key for every workspace
 *   the app is installed to, so without an allowlist any installed
 *   workspace can drive the agent. When unset the adapter accepts events
 *   from any workspace in development, but rejects events in production.
 * - SLACK_ALLOWED_API_APP_IDS — Comma-separated list of Slack app IDs
 *   (`api_app_id`) to additionally pin events to. Useful when the same
 *   signing secret rotation surfaces multiple app installs.
 */
export function slackAdapter(
  options: SlackAdapterOptions = {},
): PlatformAdapter {
  const resolveBotToken = async (incoming: IncomingMessage) =>
    (await options.resolveBotToken?.(incoming)) ??
    (await resolveManagedSlackBotToken(incoming)) ??
    (await resolveSecret("SLACK_BOT_TOKEN")) ??
    undefined;

  return {
    platform: "slack",
    label: "Slack",
    capabilities: {
      replyText: true,
      proactiveMessages: true,
      nativeThreads: true,
      contextualReplies: true,
      deferredWebhookResponse: false,
      interactionOnly: false,
      nativeContextHydration: true,
      liveRunProgress: true,
    },

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "SLACK_BOT_TOKEN",
          label: "Slack Bot Token",
          required: false,
          helpText:
            "In your Slack app's left nav: OAuth & Permissions → Bot User OAuth Token (starts with `xoxb-`).",
        },
        {
          key: "SLACK_CLIENT_ID",
          label: "Slack OAuth Client ID",
          required: false,
          helpText:
            "Slack app Basic Information → App Credentials → Client ID.",
        },
        {
          key: "SLACK_CLIENT_SECRET",
          label: "Slack OAuth Client Secret",
          required: false,
          helpText:
            "Slack app Basic Information → App Credentials → Client Secret.",
        },
        {
          key: "SLACK_SIGNING_SECRET",
          label: "Slack Signing Secret",
          required: true,
          helpText:
            "In your Slack app's left nav: Basic Information → App Credentials → Signing Secret.",
        },
      ];
    },

    async handleVerification(
      event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      // Slack sends url_verification when first setting up the webhook.
      // readRawBodyCached caches the raw bytes on event.context.__rawBody so
      // subsequent verifyWebhook + parseIncomingMessage calls re-use them
      // without re-stringifying a parsed body (M2 in the audit).
      const body = await readRawBodyCached(event);
      try {
        const parsed = JSON.parse(body);
        if (parsed.type === "url_verification") {
          // Slack's URL verifier expects the raw challenge value in the
          // response body. Returning JSON works for some clients but the app
          // settings verifier rejects it as not matching the challenge.
          return { handled: true, response: parsed.challenge };
        }
      } catch {}
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const signingSecret = await resolveSecret("SLACK_SIGNING_SECRET");
      if (!signingSecret) return false;

      const signature = getHeader(event, "x-slack-signature");
      const timestamp = getHeader(event, "x-slack-request-timestamp");
      if (!signature || !timestamp) return false;

      // Reject requests older than 5 minutes (replay protection)
      const ts = parseInt(timestamp, 10);
      if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

      const body = await readRawBodyCached(event);
      const crypto = await import("node:crypto");
      const basestring = `v0:${timestamp}:${body}`;
      const expectedSignature =
        "v0=" +
        crypto
          .createHmac("sha256", signingSecret)
          .update(basestring)
          .digest("hex");

      // Timing-safe comparison
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        );
      } catch {
        return false;
      }
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      const raw = await readRawBodyCached(event);
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return null;
      }

      // H1 (webhook audit): cross-workspace event injection. The global
      // SLACK_SIGNING_SECRET is the same key for every workspace this Slack
      // app is installed to — without a per-tenant allowlist any installed
      // workspace can drive the agent. We enforce SLACK_ALLOWED_TEAM_IDS
      // here AFTER the signature has already been verified by the webhook
      // handler, so this is purely a tenant-isolation gate (not a forgery
      // defense). When unset in production we surface a one-time warning
      // recommending it be configured.
      await enforceWorkspaceAllowlist(payload);

      // Handle Events API wrapper
      if (payload.type === "event_callback") {
        const e = payload.event;
        if (!e) return null;

        // Ignore bot messages
        if (e.bot_id || e.subtype === "bot_message") return null;
        // Ignore message edits and deletes
        if (e.subtype === "message_changed" || e.subtype === "message_deleted")
          return null;

        // Handle DMs and explicit mentions. Ordinary channel replies are only
        // accepted while this exact workspace-qualified thread has queued or
        // executing work; broad message subscriptions must never invoke the
        // agent for general channel chatter.
        const text = e.text?.trim();
        if (!text) return null;

        const teamId =
          typeof payload.team_id === "string" ? payload.team_id : "unknown";
        const apiAppId =
          typeof payload.api_app_id === "string"
            ? payload.api_app_id
            : "unknown";
        const agentContext = normalizeSlackAgentContext(e.app_context, teamId);
        const isDm =
          typeof e.channel_type === "string"
            ? e.channel_type === "im"
            : typeof e.channel === "string" && e.channel.startsWith("D");
        const isMention = e.type === "app_mention";
        const isThreadReply = !isDm && !isMention && !!e.thread_ts;
        if (!isDm && !isMention && !isThreadReply) return null;

        // Remove bot mention from text (e.g., "<@U123> do something" → "do something")
        const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
        if (!cleanText) return null;

        // Thread ID: use thread_ts if in a thread, otherwise message ts
        const threadTs = e.thread_ts || e.ts;
        const externalThreadId = `${apiAppId}:${teamId}:${e.channel}:${threadTs}`;
        const partialIncoming: IncomingMessage = {
          platform: "slack",
          externalThreadId,
          text: cleanText,
          senderName: e.user,
          senderId: e.user,
          triggerKind: isDm ? "dm" : isMention ? "mention" : "thread_reply",
          conversationType: isDm ? "dm" : "unknown",
          tenantId: teamId,
          actorTrust: { memberType: "unknown", verified: true },
          platformContext: {
            channelId: e.channel,
            channelType: e.channel_type,
            threadTs,
            messageTs: e.ts,
            teamId,
            apiAppId,
            enterpriseId:
              typeof payload.enterprise_id === "string"
                ? payload.enterprise_id
                : undefined,
            eventId: payload.event_id,
            ...(agentContext
              ? {
                  agentContext: agentContext.entities,
                  activeContextChannelId: agentContext.channelId,
                }
              : {}),
          },
          threadRef: threadTs,
          replyRef: e.ts,
          timestamp: Math.floor(parseFloat(e.ts) * 1000),
        };

        if (isThreadReply) {
          // An ordinary thread reply is narrowly admitted when either work is
          // still queued or the same Slack user is answering a fresh
          // integration-originated clarification. Consuming the latter is a
          // conditional SQL delete, so concurrent replies cannot both reopen
          // the agent and unrelated channel messages remain ignored.
          const answeredClarification = options.consumeAwaitingInput
            ? await options.consumeAwaitingInput(partialIncoming)
            : options.isThreadActive
              ? false
              : await consumeIntegrationAwaitingInput({
                  platform: "slack",
                  externalThreadId,
                  requesterId: e.user,
                });
          const active = options.isThreadActive
            ? await options.isThreadActive(partialIncoming)
            : await hasActivePendingTask("slack", externalThreadId);
          if (!active && !answeredClarification) return null;
        }

        const token = await resolveBotToken(partialIncoming);
        const threadPermalink = await resolveSlackThreadPermalink(
          e.channel,
          threadTs,
          token,
        );

        return {
          ...partialIncoming,
          platformContext: {
            ...partialIncoming.platformContext,
            ...(threadPermalink ? { threadPermalink } : {}),
          },
          ...(threadPermalink ? { sourceUrl: threadPermalink } : {}),
        };
      }

      return null;
    },

    getLegacyExternalThreadIds(incoming: IncomingMessage): string[] {
      const channelId = incoming.platformContext.channelId;
      const threadTs = incoming.platformContext.threadTs;
      return typeof channelId === "string" && typeof threadTs === "string"
        ? [`${channelId}:${threadTs}`]
        : [];
    },

    async postProcessingPlaceholder(
      incoming: IncomingMessage,
    ): Promise<{ placeholderRef: string } | null> {
      // No placeholder reply in the thread — Slack's native assistant status
      // bar and the task stream are the loading affordance. Keep the status
      // specific about intent instead of presenting the generic thinking
      // state while the native plan is opening.
      const token = await resolveBotToken(incoming);
      if (!token) return null;

      const channelId = incoming.platformContext.channelId as string;
      const threadTs = incoming.platformContext.threadTs as string;
      if (!channelId || !threadTs) return null;

      // Best-effort: flip the native Agent status bar in the
      // channel input area. Slack accepts chat:write for this method. The
      // canonical manifest separately requests assistant:write for Agent View
      // and app_context_changed events.
      setSlackAssistantStatus(
        token,
        channelId,
        threadTs,
        "I’m looking into this now…",
      );
      return null;
    },

    async hydrateIncomingMessage(
      incoming: IncomingMessage,
    ): Promise<IncomingMessage> {
      const token = await resolveBotToken(incoming);
      if (!token) return incoming;
      return hydrateSlackContext(token, incoming);
    },

    async startRunProgress(
      incoming: IncomingMessage,
    ): Promise<PlatformRunProgress | null> {
      const token = await resolveBotToken(incoming);
      if (!token) return null;
      return startSlackRunProgress(token, incoming);
    },

    async resumeRunProgress(
      incoming: IncomingMessage,
      ref: PlatformRunProgressRef,
    ): Promise<PlatformRunProgress | null> {
      if (!isSlackStreamProgressRef(ref)) return null;
      const token = await resolveBotToken(incoming);
      if (!token) return null;
      return resumeSlackRunProgress(token, incoming, ref.streamTs);
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
      opts?: { placeholderRef?: string },
    ): Promise<void> {
      const token = await resolveBotToken(context);
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const channelId = context.platformContext.channelId as string;
      const threadTs = context.platformContext.threadTs as string;
      const blocks = (message.platformContext as any)?.blocks as
        | unknown[]
        | undefined;
      const placeholderRef = opts?.placeholderRef;

      // Block-rich path: split text into chunks but render the FIRST chunk as
      // blocks (so we keep the in-place edit + button) and any overflow as
      // plain follow-up posts. The vast majority of replies fit in one block.
      const chunks = splitNonEmptyMessage(message.text, SLACK_MAX_LENGTH);
      const hasProvidedBlocks = Array.isArray(blocks) && blocks.length > 0;
      const firstChunk = chunks[0] ?? (hasProvidedBlocks ? "Response" : "");
      if (!firstChunk) {
        if (threadTs) {
          setSlackAssistantStatus(token, channelId, threadTs, "");
        }
        return;
      }
      const restChunks = chunks.slice(1);

      const finalBlocks =
        blocks ??
        buildResponseBlocks(firstChunk, {
          threadDeepLinkUrl: (message.platformContext as any)
            ?.threadDeepLinkUrl,
        });

      const baseBody: Record<string, unknown> = {
        channel: channelId,
        text: firstChunk,
        blocks: finalBlocks,
        unfurl_links: false,
        unfurl_media: false,
        mrkdwn: true,
      };

      try {
        if (placeholderRef) {
          // Replace the "thinking…" placeholder in place.
          const res = await slackApiFetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...baseBody, ts: placeholderRef }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            error?: string;
          };
          if (!data.ok) {
            console.error("[slack] chat.update error:", data.error);
            // Fall back to a fresh post so the user still sees a reply
            await postFresh(token, channelId, threadTs, baseBody);
          }
        } else {
          await postFresh(token, channelId, threadTs, baseBody);
        }

        // Clear the AI-assistant "is thinking…" status now that we've
        // delivered the final answer. Empty status clears it.
        if (threadTs) {
          setSlackAssistantStatus(token, channelId, threadTs, "");
        }

        // Overflow chunks (rare) — post as plain follow-ups in the same thread
        for (const chunk of restChunks) {
          await postFresh(token, channelId, threadTs, {
            channel: channelId,
            text: chunk,
            unfurl_links: false,
            unfurl_media: false,
            mrkdwn: true,
          });
        }
      } catch (err) {
        console.error("[slack] Failed to send message:", err);
        throw err;
      }
    },

    async sendMessageToTarget(
      message: OutgoingMessage,
      target: OutboundTarget,
    ): Promise<void> {
      const targetContext: IncomingMessage = {
        platform: "slack",
        externalThreadId: `${target.tenantId ?? "unknown"}:${target.destination}:${target.threadRef ?? "root"}`,
        text: "",
        platformContext: {
          channelId: target.destination,
          threadTs: target.threadRef,
          teamId: target.tenantId,
        },
        tenantId: target.tenantId,
        timestamp: Date.now(),
      };
      const token = await resolveBotToken(targetContext);
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const chunks = splitNonEmptyMessage(message.text, SLACK_MAX_LENGTH);
      if (chunks.length === 0) return;
      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          channel: target.destination,
          text: chunk,
        };
        if (target.threadRef) body.thread_ts = target.threadRef;

        try {
          const res = await slackApiFetch(
            "https://slack.com/api/chat.postMessage",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json()) as { ok: boolean; error?: string };
          if (!data.ok) {
            throw new Error(data.error || "chat.postMessage failed");
          }
        } catch (err) {
          console.error("[slack] Failed to send proactive message:", err);
          throw err;
        }
      }
    },

    formatAgentResponse(
      text: string,
      opts?: { threadDeepLinkUrl?: string },
    ): OutgoingMessage {
      return {
        text: markdownToSlackMrkdwn(text),
        platformContext: opts?.threadDeepLinkUrl
          ? { threadDeepLinkUrl: opts.threadDeepLinkUrl }
          : {},
      };
    },

    async getStatus(_baseUrl?: string): Promise<IntegrationStatus> {
      const hasToken = !!(await resolveSecret("SLACK_BOT_TOKEN"));
      const hasSecret = !!(await resolveSecret("SLACK_SIGNING_SECRET"));
      const ctx = getRequestContext();
      const managedInstallations = ctx?.userEmail
        ? await listIntegrationInstallations(
            {
              userEmail: ctx.userEmail,
              orgId: ctx.orgId ?? null,
            },
            "slack",
          ).catch(() => [])
        : [];
      const connectedInstallations = managedInstallations.filter(
        (installation) => installation.status === "connected",
      );
      const configured =
        hasSecret && (hasToken || connectedInstallations.length > 0);

      return {
        platform: "slack",
        label: "Slack",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasToken,
          hasSecret,
          managedInstallationCount: connectedInstallations.length,
          managedInstallations: connectedInstallations.map((installation) => ({
            id: installation.id,
            teamId: installation.teamId,
            teamName: installation.teamName,
            enterpriseId: installation.enterpriseId,
            health: installation.health,
            scopes: installation.scopes,
          })),
        },
        error: !configured
          ? "Connect a Slack workspace with OAuth or save a bot token and signing secret"
          : undefined,
      };
    },
  };
}

/**
 * Parse a comma-separated env var into a Set of trimmed, non-empty values.
 * Returns null when the env var is unset or empty (so callers can
 * distinguish "no allowlist configured" from "empty allowlist").
 */
function parseAllowlistEnv(name: string): Set<string> | null {
  const raw = process.env[name];
  if (!raw) return null;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (values.length === 0) return null;
  return new Set(values);
}

async function resolveManagedSlackBotToken(
  incoming: IncomingMessage,
): Promise<string | undefined> {
  const teamId =
    typeof incoming.platformContext.teamId === "string"
      ? incoming.platformContext.teamId
      : incoming.tenantId;
  const apiAppId =
    typeof incoming.platformContext.apiAppId === "string"
      ? incoming.platformContext.apiAppId
      : undefined;
  const enterpriseId =
    typeof incoming.platformContext.enterpriseId === "string"
      ? incoming.platformContext.enterpriseId
      : undefined;
  if (!teamId && !enterpriseId) return undefined;
  try {
    let installation = apiAppId
      ? await getActiveIntegrationInstallationByKey(
          "slack",
          slackInstallationKey({ teamId, enterpriseId, apiAppId }),
        )
      : null;
    if (!installation && teamId) {
      installation = await getActiveIntegrationInstallationForTenant(
        "slack",
        teamId,
      );
    }
    if (!installation && enterpriseId) {
      installation = await getActiveIntegrationInstallationForTenant(
        "slack",
        enterpriseId,
      );
    }
    const key =
      installation?.installationKey ??
      slackInstallationKey({ teamId, enterpriseId, apiAppId });
    return (await resolveIntegrationTokenBundle("slack", key))?.accessToken;
  } catch {
    return undefined;
  }
}

let _missingAllowlistWarned = false;

/**
 * Enforce that an incoming Slack event comes from an allowlisted workspace.
 *
 * H1 in the webhook audit: the framework uses a SINGLE global
 * SLACK_SIGNING_SECRET for every workspace the Slack app is installed to,
 * so a valid signature alone doesn't prove the request belongs to the
 * tenant the deployment intends to serve. This helper layers a per-tenant
 * allowlist on top of signature verification.
 *
 * Behavior:
 * - If `SLACK_ALLOWED_TEAM_IDS` is set: reject any payload whose
 *   `team_id` isn't in the list.
 * - If `SLACK_ALLOWED_API_APP_IDS` is set: also reject payloads whose
 *   `api_app_id` isn't in the list (bot apps can be installed under the
 *   same Slack app id across multiple workspaces — pinning both keeps
 *   the surface tight when team_id allows multiple workspaces).
 * - If `SLACK_ALLOWED_TEAM_IDS` is unset/empty in production: reject the
 *   event. Production must fail closed so any workspace with the shared
 *   signing secret cannot drive the agent.
 * - If `SLACK_ALLOWED_TEAM_IDS` is unset/empty in dev / single-tenant: log a
 *   one-time warning and accept (current local setup behavior).
 *
 * Throws an h3 401 error when an allowlisted-but-mismatched payload is
 * received, which the integrations plugin surfaces to the caller as
 * "Unrecognized Slack workspace" without enqueuing the event.
 */
async function enforceWorkspaceAllowlist(payload: any): Promise<void> {
  const teamId =
    typeof payload?.team_id === "string" ? payload.team_id : undefined;
  const apiAppId =
    typeof payload?.api_app_id === "string" ? payload.api_app_id : undefined;

  const allowedTeamIds = parseAllowlistEnv("SLACK_ALLOWED_TEAM_IDS");
  const allowedAppIds = parseAllowlistEnv("SLACK_ALLOWED_API_APP_IDS");

  if (!allowedTeamIds) {
    if (process.env.NODE_ENV === "production") {
      let managed = false;
      try {
        const key = slackInstallationKey({ teamId, apiAppId });
        managed = !!(await getActiveIntegrationInstallationByKey("slack", key));
      } catch {}
      if (!managed) {
        throw createError({
          statusCode: 401,
          statusMessage: "Slack workspace is not connected",
        });
      }
    }
    if (!_missingAllowlistWarned) {
      _missingAllowlistWarned = true;
      console.warn(
        "[slack] SLACK_ALLOWED_TEAM_IDS not set — accepting events from any workspace whose signature matches SLACK_SIGNING_SECRET. " +
          "Set SLACK_ALLOWED_TEAM_IDS to a comma-separated list of allowed team_id values before deploying to production.",
      );
    }
  }

  if (allowedTeamIds) {
    if (!teamId || !allowedTeamIds.has(teamId)) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unrecognized Slack workspace",
      });
    }
  }

  if (allowedAppIds) {
    if (!apiAppId || !allowedAppIds.has(apiAppId)) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unrecognized Slack workspace",
      });
    }
  }
}

/**
 * Read the raw request body as a string and cache on the event context.
 *
 * This MUST read raw bytes from the request stream — never `JSON.stringify`
 * a parsed body, because Slack's HMAC is computed over the exact bytes Slack
 * sent. Re-stringifying a parsed object loses key ordering, whitespace, and
 * Unicode-escape choices, so the signature check would silently fail for
 * legitimate requests (M2 in the webhook security audit).
 *
 * h3 v2's body stream is consume-once, so we cache the raw string on the
 * event context after the first read. All call sites (handleVerification,
 * verifyWebhook, parseIncomingMessage) MUST go through this helper.
 */
async function readRawBodyCached(event: H3Event): Promise<string> {
  const cached = event.context.__rawBody;
  if (typeof cached === "string") return cached;
  // h3's readRawBody returns the bytes Slack actually sent, defaulting to
  // utf8-decoded. Returns undefined for empty bodies — we coerce to "" so
  // the HMAC check can proceed deterministically.
  const raw = (await readRawBody(event)) ?? "";
  event.context.__rawBody = raw;
  return raw;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function prefixWithinUtf8ByteLimit(text: string, maxLength: number): string {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const nextBytes = utf8ByteLength(char);
    if (bytes + nextBytes > maxLength) break;
    bytes += nextBytes;
    end += char.length;
  }
  return text.slice(0, end || 1);
}

/** Split a message into chunks that fit within the platform's byte limit. */
function splitMessage(text: string, maxLength: number): string[] {
  if (utf8ByteLength(text) <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (utf8ByteLength(remaining) <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const prefix = prefixWithinUtf8ByteLimit(remaining, maxLength);

    // Try to split at a newline
    let splitIdx = prefix.lastIndexOf("\n");
    if (splitIdx <= 0) {
      // Try to split at a space
      splitIdx = prefix.lastIndexOf(" ");
    }
    if (splitIdx <= 0) {
      splitIdx = prefix.length;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

/** Split a message and drop chunks Slack would render as blank messages. */
function splitNonEmptyMessage(text: string, maxLength: number): string[] {
  return splitMessage(text, maxLength).filter(
    (chunk) => chunk.trim().length > 0,
  );
}

/** Hard cap on input length we feed to the regex-based mrkdwn converter.
 *  L2 in the webhook audit: `\*\*(.+?)\*\*` with the `s` flag on a long
 *  string of asterisks can exhibit super-linear backtracking. Slack
 *  itself caps message bodies at 4000 chars (SLACK_MAX_LENGTH); we cap
 *  the input here at 10x that as a defensive bound for any caller that
 *  passes a longer rendering source through this helper before chunking. */
const MRKDWN_MAX_LENGTH = 40_000;

/**
 * Convert standard markdown to Slack's mrkdwn dialect.
 * - `[text](url)` → `<url|text>`
 * - `**bold**` → `*bold*` (Slack uses single asterisks for bold)
 *
 * Inputs longer than MRKDWN_MAX_LENGTH are truncated before the regex
 * pass to bound worst-case backtracking on pathological input (L2 in the
 * webhook audit).
 */
function markdownToSlackMrkdwn(text: string): string {
  const bounded =
    text.length > MRKDWN_MAX_LENGTH ? text.slice(0, MRKDWN_MAX_LENGTH) : text;
  return (
    bounded
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // Do not wrap bare URLs in Slack bold markers. Slack's autolinker can
      // treat the trailing `*` as part of the URL, producing a broken link.
      .replace(/\*\*<?(https?:\/\/[^\s>*]+)>?\*\*/g, "<$1>")
      // Bounded character class instead of `.+?` with the `s` flag — caps
      // each bold span at 5000 chars so an attacker can't construct a
      // pathological "**" sequence that exhibits super-linear backtracking.
      // Newlines are allowed because `[^*]` excludes only the asterisk
      // itself, so multi-line bold spans still match.
      .replace(/\*\*([^*]{1,5000})\*\*/g, "*$1*")
  );
}

/**
 * Optionally set Slack's native Agent status indicator (the small "is
 * thinking…" line under the message composer). The method uses chat:write;
 * Agent View itself is configured separately by the Slack app manifest.
 * Pure best-effort — failures never block the response.
 */
function setSlackAssistantStatus(
  token: string,
  channelId: string,
  threadTs: string,
  status: string,
): void {
  slackApiFetch("https://slack.com/api/assistant.threads.setStatus", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    }),
  }).catch(() => {});
}

/**
 * Block Kit payload for the final answer. We avoid auto-unfurl previews by
 * separating the deep-link out into a button instead of inlining it as a
 * `<url|text>` markdown link in the section body — that's what was producing
 * the giant "Agent-Native Dispatch" card in every thread reply.
 */
function buildResponseBlocks(
  text: string,
  opts: { threadDeepLinkUrl?: string },
): unknown[] {
  const sectionChunks = splitMessage(
    text || "_(no response)_",
    SLACK_SECTION_TEXT_MAX_LENGTH,
  );
  const blocks: any[] = sectionChunks.map((chunk) => ({
    type: "section",
    text: { type: "mrkdwn", text: chunk },
  }));
  if (opts.threadDeepLinkUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open thread", emoji: true },
          url: opts.threadDeepLinkUrl,
          action_id: "open_dispatch_thread",
        },
      ],
    });
  }
  return blocks;
}

/**
 * Post a fresh message to a thread. Used as the placeholder-fallback path
 * (e.g. when chat.update fails) and for follow-up overflow chunks.
 */
async function postFresh(
  token: string,
  channelId: string,
  threadTs: string | undefined,
  body: Record<string, unknown>,
): Promise<void> {
  const hasBlocks =
    Array.isArray(body.blocks) && (body.blocks as unknown[]).length > 0;
  if (
    typeof body.text === "string" &&
    body.text.trim().length === 0 &&
    !hasBlocks
  ) {
    return;
  }

  const payload: Record<string, unknown> = {
    ...body,
    channel: channelId,
  };
  if (threadTs && !payload.thread_ts) payload.thread_ts = threadTs;
  const res = await slackApiFetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error("[slack] chat.postMessage error:", data.error);
    throw new Error(data.error || "chat.postMessage failed");
  }
}

async function slackApiFetch(
  url: string,
  init: RequestInit,
  timeoutMs = SLACK_API_TIMEOUT_MS,
): Promise<Response> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  try {
    return await fetch(url, {
      ...init,
      signal: controller?.signal ?? init.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveSlackThreadPermalink(
  channelId: unknown,
  threadTs: unknown,
  resolvedToken?: string,
): Promise<string | undefined> {
  if (typeof channelId !== "string" || typeof threadTs !== "string") {
    return undefined;
  }
  const token = resolvedToken ?? (await resolveSecret("SLACK_BOT_TOKEN"));
  if (!token) return undefined;

  try {
    const url = new URL("https://slack.com/api/chat.getPermalink");
    url.searchParams.set("channel", channelId);
    url.searchParams.set("message_ts", threadTs);
    const res = await slackApiFetch(
      url.toString(),
      { headers: { Authorization: `Bearer ${token}` } },
      SLACK_PERMALINK_TIMEOUT_MS,
    );
    const data = (await res.json()) as {
      ok?: boolean;
      permalink?: unknown;
    };
    if (!data.ok || typeof data.permalink !== "string") return undefined;

    const permalink = new URL(data.permalink);
    const isSlackHost =
      permalink.hostname === "slack.com" ||
      permalink.hostname.endsWith(".slack.com");
    if (permalink.protocol !== "https:" || !isSlackHost) return undefined;
    return permalink.toString();
  } catch {
    return undefined;
  }
}

function boundedSlackText(value: unknown): string {
  return typeof value === "string"
    ? value.slice(0, SLACK_CONTEXT_TEXT_LIMIT)
    : "";
}

function normalizeSlackAgentContext(
  value: unknown,
  eventTeamId: string,
): {
  entities: Array<{ type: string; value: string; teamId?: string }>;
  channelId?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const rawEntities = (value as { entities?: unknown }).entities;
  if (!Array.isArray(rawEntities)) return null;
  const entities = rawEntities.slice(0, 10).flatMap((entity) => {
    if (!entity || typeof entity !== "object") return [];
    const record = entity as Record<string, unknown>;
    if (typeof record.type !== "string" || typeof record.value !== "string") {
      return [];
    }
    const teamId =
      typeof record.team_id === "string" ? record.team_id : undefined;
    if (teamId && eventTeamId !== "unknown" && teamId !== eventTeamId) {
      return [];
    }
    return [
      {
        type: record.type.slice(0, 100),
        value: record.value.slice(0, 200),
        ...(teamId ? { teamId } : {}),
      },
    ];
  });
  if (!entities.length) return null;
  const channelId = entities.find(
    (entity) =>
      entity.type === "slack#/types/channel_id" &&
      /^[CDG][A-Z0-9]+$/.test(entity.value),
  )?.value;
  return { entities, ...(channelId ? { channelId } : {}) };
}

function slackFileReference(value: unknown): IntegrationFileReference | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (typeof file.id !== "string") return null;
  return {
    id: file.id,
    ...(typeof file.name === "string" ? { name: file.name } : {}),
    ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
    ...(typeof file.size === "number" ? { size: file.size } : {}),
    ...(typeof file.permalink === "string"
      ? { permalink: file.permalink }
      : {}),
    ...(typeof file.url_private_download === "string"
      ? { downloadUrl: file.url_private_download }
      : {}),
  };
}

async function slackJson(
  token: string,
  method: string,
  params: Record<string, string>,
  timeoutMs = 2_000,
): Promise<Record<string, any> | null> {
  try {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await slackApiFetch(
      url.toString(),
      { headers: { Authorization: `Bearer ${token}` } },
      timeoutMs,
    );
    const body = (await response.json()) as Record<string, any>;
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

async function hydrateSlackContext(
  token: string,
  incoming: IncomingMessage,
): Promise<IncomingMessage> {
  const channelId = incoming.platformContext.channelId;
  const threadTs = incoming.platformContext.threadTs;
  const senderId = incoming.senderId;
  if (typeof channelId !== "string" || typeof threadTs !== "string") {
    return incoming;
  }

  const [thread, history, pins, conversation, user] = await Promise.all([
    slackJson(token, "conversations.replies", {
      channel: channelId,
      ts: threadTs,
      limit: String(SLACK_CONTEXT_MESSAGE_LIMIT),
    }),
    slackJson(token, "conversations.history", {
      channel: channelId,
      latest: String(incoming.platformContext.messageTs ?? threadTs),
      inclusive: "true",
      limit: String(SLACK_CONTEXT_MESSAGE_LIMIT),
    }),
    slackJson(token, "pins.list", { channel: channelId }),
    slackJson(token, "conversations.info", { channel: channelId }),
    senderId ? slackJson(token, "users.info", { user: senderId }) : null,
  ]);

  // Agent View can attach the Slack surface the user is currently viewing to
  // a DM. Treat it only as a context hint: Slack requires us to prove the bot
  // can access the referenced channel with conversations.info before reading
  // any history from it.
  const activeContextChannelId =
    typeof incoming.platformContext.activeContextChannelId === "string"
      ? incoming.platformContext.activeContextChannelId
      : null;
  const activeContextConversation =
    activeContextChannelId && activeContextChannelId !== channelId
      ? await slackJson(token, "conversations.info", {
          channel: activeContextChannelId,
        })
      : null;
  const activeContextHistory = activeContextConversation
    ? await slackJson(token, "conversations.history", {
        channel: activeContextChannelId!,
        limit: "5",
      })
    : null;
  const activeContextName =
    typeof activeContextConversation?.channel?.name === "string"
      ? activeContextConversation.channel.name
      : null;
  const activeContextMessages = Array.isArray(activeContextHistory?.messages)
    ? activeContextHistory.messages.map((message: Record<string, any>) => ({
        ...message,
        text: `[Active Slack context${activeContextName ? ` #${activeContextName}` : ""}] ${boundedSlackText(message.text)}`,
      }))
    : [];

  const rawMessages = [
    ...(Array.isArray(history?.messages) ? history.messages : []),
    ...(Array.isArray(pins?.items)
      ? pins.items
          .map((item: Record<string, any>) => item.message)
          .filter(Boolean)
      : []),
    ...(Array.isArray(thread?.messages) ? thread.messages : []),
    ...activeContextMessages,
  ];
  const uniqueMessages = [
    ...new Map(
      rawMessages.map((message: Record<string, any>, index) => [
        typeof message.ts === "string" ? message.ts : `unknown:${index}`,
        message,
      ]),
    ).values(),
  ].slice(-SLACK_CONTEXT_MESSAGE_LIMIT);

  const messages: IntegrationContextMessage[] = uniqueMessages.length
    ? uniqueMessages.map((message: Record<string, any>) => {
        const files = Array.isArray(message.files)
          ? message.files
              .map(slackFileReference)
              .filter(
                (
                  file: IntegrationFileReference | null,
                ): file is IntegrationFileReference => file !== null,
              )
          : undefined;
        const reactions = Array.isArray(message.reactions)
          ? message.reactions
              .filter(
                (reaction: any) =>
                  typeof reaction?.name === "string" &&
                  typeof reaction?.count === "number",
              )
              .map((reaction: any) => ({
                name: reaction.name,
                count: reaction.count,
              }))
          : undefined;
        return {
          ...(typeof message.user === "string"
            ? { senderId: message.user }
            : {}),
          text: boundedSlackText(message.text),
          timestamp:
            typeof message.ts === "string"
              ? Math.floor(parseFloat(message.ts) * 1000)
              : incoming.timestamp,
          ...(reactions?.length ? { reactions } : {}),
          ...(files?.length ? { files } : {}),
        };
      })
    : [];

  const profile = user?.user?.profile;
  const isGuest = user?.user?.is_restricted === true;
  const isExternal = user?.user?.is_ultra_restricted === true;
  const isPrivate = conversation?.channel?.is_private === true;
  const isExternalShared = conversation?.channel?.is_ext_shared === true;
  const isMpim = conversation?.channel?.is_mpim === true;
  const isIm = conversation?.channel?.is_im === true;
  const conversationType = isIm
    ? "dm"
    : isMpim
      ? "group_dm"
      : isPrivate
        ? "private_channel"
        : "channel";

  const attachedFiles = messages.flatMap((message) => message.files ?? []);
  const detailedFiles = await Promise.all(
    [...new Set(attachedFiles.map((file) => file.id))]
      .slice(0, 5)
      .map(async (fileId) => {
        const result = await slackJson(token, "files.info", { file: fileId });
        return slackFileReference(result?.file);
      }),
  );
  const fileById = new Map(
    detailedFiles
      .filter((file): file is IntegrationFileReference => file !== null)
      .map((file) => [file.id, file]),
  );
  const hydratedMessages = messages.map((message) => ({
    ...message,
    ...(message.files?.length
      ? {
          files: message.files.map((file) => ({
            ...file,
            ...(fileById.get(file.id) ?? {}),
          })),
        }
      : {}),
  }));
  const hydratedFiles = hydratedMessages.flatMap(
    (message) => message.files ?? [],
  );
  return {
    ...incoming,
    ...(typeof profile?.display_name === "string" && profile.display_name
      ? { senderName: profile.display_name }
      : typeof profile?.real_name === "string" && profile.real_name
        ? { senderName: profile.real_name }
        : {}),
    ...(typeof profile?.email === "string"
      ? { senderEmail: profile.email, senderVerified: true }
      : {}),
    conversationType,
    actorTrust: {
      memberType: isExternal ? "external" : isGuest ? "guest" : "member",
      verified: true,
    },
    contextMessages: hydratedMessages,
    ...(hydratedFiles.length ? { files: hydratedFiles.slice(0, 20) } : {}),
    platformContext: {
      ...incoming.platformContext,
      channelName:
        typeof conversation?.channel?.name === "string"
          ? conversation.channel.name
          : undefined,
      isExternalShared,
      ...(activeContextChannelId
        ? {
            activeContextChannelId,
            ...(activeContextName
              ? { activeContextChannelName: activeContextName }
              : {}),
          }
        : {}),
    },
  };
}

function shortTaskTitle(value: unknown): string {
  const text = typeof value === "string" ? value : "Working";
  return text.replace(/[-_]/g, " ").slice(0, 200);
}

function delegatedTaskTitle(agent: unknown): string {
  return `Contact ${shortTaskTitle(agent)}`;
}

function formatElapsedSeconds(elapsedSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatProgressState(state: string): string {
  if (state === "submitted") return "Queued";
  if (state === "working") return "Working";
  return shortTaskTitle(state);
}

function delegatedProgressDetails(
  agent: unknown,
  state: string,
  elapsedSeconds: number,
  detail?: string,
): string {
  const elapsed = formatElapsedSeconds(elapsedSeconds);
  const progress = `${formatProgressState(state)} · ${elapsed}`;
  const update = detail ? shortTaskTitle(detail) : "";

  if (elapsedSeconds >= SLACK_CALM_PROGRESS_THRESHOLD_SECONDS) {
    const agentName = shortTaskTitle(agent);
    const context = update ? ` — ${update}.` : ".";
    return `${progress}${context} This is taking longer than usual, but ${agentName} is still working. I’ll post the result here.`;
  }

  return update ? `${progress} — ${update}` : progress;
}

async function postSlackJson(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await slackApiFetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, any>;
  if (!data.ok) throw new Error(data.error || `${method} failed`);
  return data;
}

function streamFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return /^[a-z0-9_:-]{1,80}$/i.test(message) ? message : "unknown";
}

function streamChunkType(chunk: Record<string, unknown>): string {
  const type = chunk.type;
  return type === "task_update" ||
    type === "plan_update" ||
    type === "markdown_text" ||
    type === "blocks"
    ? type
    : "unknown";
}

async function startSlackRunProgress(
  token: string,
  incoming: IncomingMessage,
): Promise<PlatformRunProgress | null> {
  const channel = incoming.platformContext.channelId;
  const threadTs = incoming.platformContext.threadTs;
  if (typeof channel !== "string" || typeof threadTs !== "string") return null;

  let started: Record<string, any>;
  try {
    started = await postSlackJson(token, "chat.startStream", {
      channel,
      thread_ts: threadTs,
      ...(incoming.tenantId ? { recipient_team_id: incoming.tenantId } : {}),
      ...(incoming.senderId ? { recipient_user_id: incoming.senderId } : {}),
      task_display_mode: "plan",
      markdown_text: "I’m looking into this for you.",
      chunks: [
        {
          type: "plan_update",
          title: "I’m looking into this for you",
        },
        {
          type: "task_update",
          id: "agent-native:context",
          title: "Review the request",
          status: "in_progress",
          details: "Finding the information needed for an answer",
        },
      ],
    });
  } catch (error) {
    console.warn("[slack] chat.startStream failed; using standard reply", {
      errorCode: streamFailureCode(error),
      isDirectMessage: incoming.conversationType === "dm",
      hasRecipientTeam: Boolean(incoming.tenantId),
      hasRecipientUser: Boolean(incoming.senderId),
    });
    return null;
  }

  const streamTs = started.ts;
  if (typeof streamTs !== "string") return null;
  return createSlackRunProgress(token, incoming, channel, threadTs, streamTs);
}

function isSlackStreamProgressRef(ref: PlatformRunProgressRef): boolean {
  return (
    ref.kind === "slack-stream" && /^\d{1,20}\.\d{1,9}$/.test(ref.streamTs)
  );
}

async function resumeSlackRunProgress(
  token: string,
  incoming: IncomingMessage,
  streamTs: string,
): Promise<PlatformRunProgress | null> {
  const channel = incoming.platformContext.channelId;
  const threadTs = incoming.platformContext.threadTs;
  if (typeof channel !== "string" || typeof threadTs !== "string") return null;
  return createSlackRunProgress(token, incoming, channel, threadTs, streamTs);
}

function createSlackRunProgress(
  token: string,
  incoming: IncomingMessage,
  channel: string,
  threadTs: string,
  streamTs: string,
): PlatformRunProgress {
  const tasks = new Map<string, { title: string; status: string }>();
  const toolTaskIds = new Map<string, string>();
  const agentTaskIds = new Map<string, string>();
  tasks.set("agent-native:context", {
    title: "Review the request",
    status: "in_progress",
  });
  let sequence = 0;
  let lastWriteAt = 0;
  let pending: Record<string, unknown> | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let approvalControls: { approve: string; deny: string } | null = null;
  let cancelControl: string | null = null;

  const append = async (chunk: Record<string, unknown>) => {
    const now = Date.now();
    const write = async (value: Record<string, unknown>) => {
      lastWriteAt = Date.now();
      try {
        await postSlackJson(token, "chat.appendStream", {
          channel,
          ts: streamTs,
          markdown_text: "Progress updated.",
          chunks: [value],
        });
      } catch (error) {
        console.warn(
          "[slack] chat.appendStream failed; progress may be stale",
          {
            chunkType: streamChunkType(value),
            errorCode: streamFailureCode(error),
          },
        );
      }
    };
    if (now - lastWriteAt >= 900) {
      await write(chunk);
      return;
    }
    pending = chunk;
    if (!pendingTimer) {
      pendingTimer = setTimeout(
        () => {
          const value = pending;
          pending = null;
          pendingTimer = null;
          if (value) void write(value);
        },
        900 - (now - lastWriteAt),
      );
    }
  };

  const taskId = (prefix: string, explicit?: string) =>
    `${prefix}:${explicit || ++sequence}`.slice(0, 240);

  return {
    ref: { kind: "slack-stream", streamTs },
    async onEvent(event) {
      if (!cancelControl) {
        const context = getIntegrationRequestContext();
        const ownerEmail = getRequestContext()?.userEmail;
        if (
          context?.lineage?.runId &&
          ownerEmail &&
          incoming.senderId &&
          incoming.tenantId
        ) {
          cancelControl = await createIntegrationControl({
            action: "cancel",
            ownerEmail,
            orgId: getRequestContext()?.orgId ?? null,
            requesterId: incoming.senderId,
            teamId: incoming.tenantId,
            apiAppId:
              typeof incoming.platformContext.apiAppId === "string"
                ? incoming.platformContext.apiAppId
                : null,
            channelId: channel,
            messageTs: streamTs,
            runId: context.lineage.runId,
            incoming,
          });
          await append({
            type: "blocks",
            blocks: [
              {
                type: "actions",
                block_id: `agent-native-running-${Date.now()}`,
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Cancel" },
                    style: "danger",
                    action_id: "agent_native_cancel",
                    value: cancelControl,
                  },
                ],
              },
            ],
          });
        }
      }
      if (event.type === "approval_required") {
        const context = getIntegrationRequestContext();
        const ownerEmail = getRequestContext()?.userEmail;
        if (context && ownerEmail && incoming.senderId && incoming.tenantId) {
          const common = {
            ownerEmail,
            orgId: getRequestContext()?.orgId ?? null,
            requesterId: incoming.senderId,
            teamId: incoming.tenantId,
            apiAppId:
              typeof incoming.platformContext.apiAppId === "string"
                ? incoming.platformContext.apiAppId
                : null,
            channelId: channel,
            messageTs: streamTs,
            runId: context.lineage?.runId ?? null,
            approvalKey: event.approvalKey,
            incoming,
          };
          const [approve, deny] = await Promise.all([
            createIntegrationControl({ ...common, action: "approve" }),
            createIntegrationControl({ ...common, action: "deny" }),
          ]);
          approvalControls = { approve, deny };
        }
        await append({
          type: "task_update",
          id: "agent-native:approval",
          title: `Approve ${shortTaskTitle(event.tool)}`,
          status: "pending",
          details: "Waiting for the requester",
        });
      } else if (event.type === "tool_start") {
        const key = event.id || event.tool;
        const id = taskId("tool", event.id);
        toolTaskIds.set(key, id);
        const title = shortTaskTitle(event.tool);
        tasks.set(id, { title, status: "in_progress" });
        await append({
          type: "task_update",
          id,
          title,
          status: "in_progress",
        });
      } else if (event.type === "tool_done") {
        const key = event.id || event.tool;
        const id = toolTaskIds.get(key) ?? taskId("tool", event.id);
        const title = tasks.get(id)?.title ?? shortTaskTitle(event.tool);
        tasks.set(id, {
          title,
          status: event.isError ? "error" : "complete",
        });
        await append({
          type: "task_update",
          id,
          title,
          status: event.isError ? "error" : "complete",
        });
      } else if (event.type === "agent_call") {
        const id =
          agentTaskIds.get(event.agent) ?? taskId("agent", event.agent);
        agentTaskIds.set(event.agent, id);
        const status =
          event.status === "start"
            ? "in_progress"
            : event.status === "done"
              ? "complete"
              : "error";
        const title = delegatedTaskTitle(event.agent);
        tasks.set(id, { title, status });
        await append({
          type: "task_update",
          id,
          title,
          status,
          ...(event.status === "start"
            ? {
                details: `I’m contacting ${shortTaskTitle(event.agent)} for an answer.`,
              }
            : {}),
        });
      } else if (event.type === "agent_call_progress") {
        // A2A calls can stay healthy for minutes. Keep the same native Slack
        // task card alive with each real downstream poll rather than creating
        // a new card per tick or leaving the user with a stale spinner.
        const id =
          agentTaskIds.get(event.agent) ?? taskId("agent", event.agent);
        agentTaskIds.set(event.agent, id);
        const title = delegatedTaskTitle(event.agent);
        const details = delegatedProgressDetails(
          event.agent,
          event.state,
          event.elapsedSeconds,
          event.detail,
        );
        tasks.set(id, { title, status: "in_progress" });
        await append({
          type: "task_update",
          id,
          title,
          status: "in_progress",
          details,
        });
      } else if (event.type === "activity") {
        await append({
          type: "task_update",
          id: "agent-native:context",
          title: "Review the request",
          status: "in_progress",
          details: `Working · ${shortTaskTitle(event.label)}`,
        });
      }
    },
    async complete(message) {
      if (pendingTimer) clearTimeout(pendingTimer);
      const finalChunks = [...tasks.entries()].map(([id, task]) => ({
        type: "task_update",
        id,
        title: task.title,
        status: task.status === "in_progress" ? "complete" : task.status,
      }));
      const messageBlocks = Array.isArray(message.platformContext.blocks)
        ? message.platformContext.blocks
        : [];
      const controlBlocks = approvalControls
        ? [
            {
              type: "actions",
              block_id: `agent-native-approval-${Date.now()}`,
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Approve" },
                  style: "primary",
                  action_id: "agent_native_approve",
                  value: approvalControls.approve,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "Deny" },
                  style: "danger",
                  action_id: "agent_native_deny",
                  value: approvalControls.deny,
                },
              ],
            },
          ]
        : [];
      await postSlackJson(token, "chat.stopStream", {
        channel,
        ts: streamTs,
        markdown_text: message.text || "Done.",
        ...(finalChunks.length ? { chunks: finalChunks } : {}),
        ...(messageBlocks.length || controlBlocks.length
          ? { blocks: [...messageBlocks, ...controlBlocks].slice(0, 50) }
          : {}),
      });
      setSlackAssistantStatus(token, channel, threadTs, "");
    },
    async fail(message) {
      if (pendingTimer) clearTimeout(pendingTimer);
      await postSlackJson(token, "chat.stopStream", {
        channel,
        ts: streamTs,
        markdown_text: message.slice(0, SLACK_MAX_LENGTH),
      }).catch(() => {});
      setSlackAssistantStatus(token, channel, threadTs, "");
    },
  };
}
