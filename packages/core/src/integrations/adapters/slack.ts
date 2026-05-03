import type { H3Event } from "h3";
import { createError, getHeader, readRawBody } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  OutboundTarget,
} from "../types.js";
import type { EnvKeyConfig } from "../../server/create-server.js";
import { getIntegrationConfig } from "../config-store.js";

/** Slack's max message length */
const SLACK_MAX_LENGTH = 4000;
const SLACK_API_TIMEOUT_MS = 10_000;

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
 *   accepts events from. Strongly recommended in multi-tenant deployments
 *   to prevent cross-workspace event injection (H1 in the webhook audit):
 *   the global `SLACK_SIGNING_SECRET` is the same key for every workspace
 *   the app is installed to, so without an allowlist any installed
 *   workspace can drive the agent. When unset the adapter accepts events
 *   from any workspace — fine for single-tenant dev, unsafe for prod.
 * - SLACK_ALLOWED_API_APP_IDS — Comma-separated list of Slack app IDs
 *   (`api_app_id`) to additionally pin events to. Useful when the same
 *   signing secret rotation surfaces multiple app installs.
 */
export function slackAdapter(): PlatformAdapter {
  return {
    platform: "slack",
    label: "Slack",

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "SLACK_BOT_TOKEN",
          label: "Slack Bot Token",
          required: true,
          helpText:
            "In your Slack app's left nav: OAuth & Permissions → Bot User OAuth Token (starts with `xoxb-`).",
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
      const signingSecret = process.env.SLACK_SIGNING_SECRET;
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
      enforceWorkspaceAllowlist(payload);

      // Handle Events API wrapper
      if (payload.type === "event_callback") {
        const e = payload.event;
        if (!e) return null;

        // Ignore bot messages
        if (e.bot_id || e.subtype === "bot_message") return null;
        // Ignore message edits and deletes
        if (e.subtype === "message_changed" || e.subtype === "message_deleted")
          return null;

        // Handle both direct messages and app_mentions
        const text = e.text?.trim();
        if (!text) return null;

        // Remove bot mention from text (e.g., "<@U123> do something" → "do something")
        const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
        if (!cleanText) return null;

        // Thread ID: use thread_ts if in a thread, otherwise message ts
        const threadTs = e.thread_ts || e.ts;
        const externalThreadId = `${e.channel}:${threadTs}`;

        return {
          platform: "slack",
          externalThreadId,
          text: cleanText,
          senderName: e.user,
          senderId: e.user,
          platformContext: {
            channelId: e.channel,
            threadTs: threadTs,
            messageTs: e.ts,
            teamId: payload.team_id,
            eventId: payload.event_id,
          },
          timestamp: Math.floor(parseFloat(e.ts) * 1000),
        };
      }

      return null;
    },

    async postProcessingPlaceholder(
      incoming: IncomingMessage,
    ): Promise<{ placeholderRef: string } | null> {
      // No placeholder reply in the thread — Slack's native assistant
      // status bar ("agent-native is thinking…", below the composer) is the
      // loading affordance. A second visible "Working on it…" reply was
      // redundant and added an extra chunk that we then had to overwrite.
      // We just set the native status and return null so sendResponse posts
      // the final reply as a fresh message.
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) return null;

      const channelId = incoming.platformContext.channelId as string;
      const threadTs = incoming.platformContext.threadTs as string;
      if (!channelId || !threadTs) return null;

      // Best-effort: flip the native AI-assistant "is thinking…" status bar
      // in the channel input area. Requires `assistant:write` scope on the
      // app — otherwise silently no-ops.
      setSlackAssistantStatus(token, channelId, threadTs, "is thinking…");
      return null;
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
      opts?: { placeholderRef?: string },
    ): Promise<void> {
      const token = process.env.SLACK_BOT_TOKEN;
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
      const chunks = splitMessage(message.text, SLACK_MAX_LENGTH);
      const firstChunk = chunks[0] ?? "";
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
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const chunks = splitMessage(message.text, SLACK_MAX_LENGTH);
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

    async getStatus(baseUrl?: string): Promise<IntegrationStatus> {
      const hasToken = !!process.env.SLACK_BOT_TOKEN;
      const hasSecret = !!process.env.SLACK_SIGNING_SECRET;
      const configured = hasToken && hasSecret;

      return {
        platform: "slack",
        label: "Slack",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasToken,
          hasSecret,
        },
        error: !configured
          ? "Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in your environment"
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
 * - If neither is set AND `NODE_ENV === "production"`: log a one-time
 *   warning recommending the env var be configured. Continue (preserves
 *   existing behavior to avoid breaking single-tenant prod deployments
 *   that have always run without an allowlist).
 * - If neither is set in dev / single-tenant: accept (current behavior).
 *
 * Throws an h3 401 error when an allowlisted-but-mismatched payload is
 * received, which the integrations plugin surfaces to the caller as
 * "Unrecognized Slack workspace" without enqueuing the event.
 */
function enforceWorkspaceAllowlist(payload: any): void {
  const teamId =
    typeof payload?.team_id === "string" ? payload.team_id : undefined;
  const apiAppId =
    typeof payload?.api_app_id === "string" ? payload.api_app_id : undefined;

  const allowedTeamIds = parseAllowlistEnv("SLACK_ALLOWED_TEAM_IDS");
  const allowedAppIds = parseAllowlistEnv("SLACK_ALLOWED_API_APP_IDS");

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

  if (
    !allowedTeamIds &&
    !allowedAppIds &&
    process.env.NODE_ENV === "production" &&
    !_missingAllowlistWarned
  ) {
    _missingAllowlistWarned = true;
    console.warn(
      "[slack] SLACK_ALLOWED_TEAM_IDS not set in production — accepting events from any workspace whose signature matches SLACK_SIGNING_SECRET. " +
        "Set SLACK_ALLOWED_TEAM_IDS to a comma-separated list of allowed team_id values to prevent cross-workspace event injection (H1 in the webhook audit).",
    );
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

/** Split a message into chunks that fit within the platform's limit */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      // Try to split at a space
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
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
 * Optionally set Slack's native AI-assistant status indicator (the small
 * "is thinking…" line under the message composer) for an app configured
 * with the `assistant:write` scope. Pure best-effort — fails silently for
 * apps that aren't set up as AI assistants.
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
  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: text || "_(no response)_" },
    },
  ];
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
): Promise<Response> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), SLACK_API_TIMEOUT_MS)
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
