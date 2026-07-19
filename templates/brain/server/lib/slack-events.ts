import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { parseJson } from "./brain.js";
import { enqueueBrainOperation } from "./ingest-queue.js";
import { resolveSourceCredential } from "./source-credentials.js";

export interface SlackEventsEnvelope {
  type?: string;
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    deleted_ts?: string;
    item?: { type?: string; channel?: string; ts?: string };
  };
}

type SlackSource = typeof schema.brainSources.$inferSelect;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function configuredString(
  config: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const candidate of [config, objectValue(config.slack)]) {
    for (const key of keys) {
      const value = stringValue(candidate[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function configuredChannelIds(config: Record<string, unknown>) {
  const result = new Set<string>();
  for (const candidate of [config, objectValue(config.slack)]) {
    for (const key of [
      "channelIds",
      "channels",
      "allowedChannels",
      "allowlistedChannels",
      "allowList",
    ]) {
      const raw = candidate[key];
      const values =
        typeof raw === "string"
          ? raw.split(",")
          : Array.isArray(raw)
            ? raw.filter((value): value is string => typeof value === "string")
            : [];
      for (const value of values) {
        const id = value.trim().replace(/^#/, "");
        if (/^[CG][A-Z0-9]+$/i.test(id)) result.add(id);
      }
    }
  }
  return result;
}

function includesPublicChannels(config: Record<string, unknown>) {
  for (const candidate of [config, objectValue(config.slack)]) {
    const value = candidate.includePublicChannels;
    if (value === true) return true;
    if (
      typeof value === "string" &&
      ["true", "1", "yes", "on"].includes(value.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

function eventLocation(payload: SlackEventsEnvelope) {
  const event = payload.event;
  if (!event) return null;
  if (event.type === "message") {
    const threadTs = event.thread_ts ?? event.ts ?? event.deleted_ts;
    return event.channel && threadTs
      ? { channelId: event.channel, threadTs }
      : null;
  }
  if (
    (event.type === "reaction_added" || event.type === "reaction_removed") &&
    event.item?.type === "message" &&
    event.item.channel &&
    event.item.ts
  ) {
    return { channelId: event.item.channel, threadTs: event.item.ts };
  }
  return null;
}

function sourceMatchesEvent(
  source: SlackSource,
  payload: SlackEventsEnvelope,
  location: { channelId: string; threadTs: string } | null,
) {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const teamId = configuredString(config, ["slackTeamId", "teamId"]);
  const appId = configuredString(config, ["slackAppId", "appId"]);
  if (!teamId || teamId !== payload.team_id) return false;
  if (appId && appId !== payload.api_app_id) return false;
  if (!location) return payload.type === "url_verification";
  return (
    configuredChannelIds(config).has(location.channelId) ||
    (includesPublicChannels(config) && /^C[A-Z0-9]+$/i.test(location.channelId))
  );
}

export function parseSlackEventsEnvelope(
  rawBody: string,
): SlackEventsEnvelope | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as SlackEventsEnvelope)
      : null;
  } catch {
    return null;
  }
}

export function verifySlackEventSignature(input: {
  rawBody: string;
  timestamp?: string;
  signature?: string;
  signingSecret?: string;
  nowMs?: number;
}) {
  if (!input.timestamp || !input.signature || !input.signingSecret)
    return false;
  const timestamp = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs((input.nowMs ?? Date.now()) / 1_000 - timestamp) > 300)
    return false;
  const expected = `v0=${crypto
    .createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(input.signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

async function matchingSlackSource(
  payload: SlackEventsEnvelope,
  location: { channelId: string; threadTs: string } | null,
) {
  const sources = await getDb()
    .select()
    .from(schema.brainSources)
    // guard:allow-unscoped — Slack's signed Events API has no user session;
    // each candidate must match its configured workspace and channel before use.
    .where(
      and(
        eq(schema.brainSources.provider, "slack"),
        eq(schema.brainSources.status, "active"),
      ),
    );
  return (
    sources.find((source) => sourceMatchesEvent(source, payload, location)) ??
    null
  );
}

async function sourceSigningSecret(source: SlackSource) {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  return resolveSourceCredential({
    provider: "slack",
    key: "SLACK_SIGNING_SECRET",
    ctx: { userEmail: source.ownerEmail, orgId: source.orgId },
    workspaceConnectionId: configuredString(config, ["workspaceConnectionId"]),
  });
}

/**
 * Verify a Brain Slack event and enqueue an ID-only refresh operation. The raw
 * event body is never stored, logged, or passed to the queue worker.
 */
export async function enqueueSlackThreadRefreshFromEvent(input: {
  rawBody: string;
  timestamp?: string;
  signature?: string;
}): Promise<
  | { status: "invalid" | "ignored" | "queued"; challenge?: string }
  | { status: "missing-signing-secret" }
> {
  const payload = parseSlackEventsEnvelope(input.rawBody);
  if (!payload?.team_id) return { status: "invalid" };
  const location = eventLocation(payload);
  const source = await matchingSlackSource(payload, location);
  if (!source) return { status: "ignored" };
  const signingSecret = await sourceSigningSecret(source);
  if (!signingSecret) return { status: "missing-signing-secret" };
  if (
    !verifySlackEventSignature({
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      signature: input.signature,
      signingSecret,
    })
  ) {
    return { status: "invalid" };
  }
  if (
    payload.type === "url_verification" &&
    typeof payload.challenge === "string"
  ) {
    return { status: "queued", challenge: payload.challenge };
  }
  if (!location) return { status: "ignored" };
  await enqueueBrainOperation({
    operation: "slack-thread-refresh",
    dedupeKey: `slack-thread-refresh:${source.id}:${location.channelId}:${location.threadTs}`,
    sourceId: source.id,
    priority: 20,
    payload: {
      teamId: payload.team_id,
      channelId: location.channelId,
      threadTs: location.threadTs,
    },
  });
  return { status: "queued" };
}
