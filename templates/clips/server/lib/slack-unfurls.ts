import crypto from "node:crypto";

import { AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE } from "@agent-native/core/shared";
import { eq } from "drizzle-orm";

import {
  clipsShareDescription,
  displayRecordingTitle,
} from "../../shared/share-meta.js";
import { getDb, schema } from "../db/index.js";

const SLACK_API_URL = "https://slack.com/api/chat.unfurl";
const MAX_UNFURL_LINKS = 5;

export type SlackLinkSharedPayload = {
  type?: string;
  team_id?: string;
  api_app_id?: string;
  event?: {
    type?: string;
    channel?: string;
    message_ts?: string;
    links?: Array<{ url?: string; domain?: string }>;
  };
};

type SlackUnfurlRecording = {
  id: string;
  title: string;
  description: string;
  durationMs: number;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  visibility: string | null;
  status: string | null;
  password: string | null;
  archivedAt: string | null;
  trashedAt: string | null;
  expiresAt: string | null;
  videoUrl: string | null;
};

export type SlackVideoBlock = {
  type: "video";
  title: { type: "plain_text"; text: string; emoji: true };
  title_url: string;
  description: { type: "plain_text"; text: string; emoji: true };
  video_url: string;
  thumbnail_url: string;
  alt_text: string;
  provider_name: "Clips";
};

export type ChatUnfurlPayload = {
  channel: string;
  ts: string;
  unfurls: Record<string, { blocks: SlackVideoBlock[] }>;
};

export type SlackAllowlistValidation =
  | { ok: true }
  | { ok: false; status: 401; error: string };

function parseAllowlist(value: string | undefined): Set<string> | null {
  const values = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

export function validateSlackEventAllowlist(
  payload: SlackLinkSharedPayload,
  env: Partial<
    Record<
      "NODE_ENV" | "SLACK_ALLOWED_TEAM_IDS" | "SLACK_ALLOWED_API_APP_IDS",
      string | undefined
    >
  > = process.env,
): SlackAllowlistValidation {
  const allowedTeamIds = parseAllowlist(env.SLACK_ALLOWED_TEAM_IDS);
  const allowedAppIds = parseAllowlist(env.SLACK_ALLOWED_API_APP_IDS);

  if (!allowedTeamIds && env.NODE_ENV === "production") {
    return {
      ok: false,
      status: 401,
      error: "Slack workspace allowlist is not configured",
    };
  }

  if (
    allowedTeamIds &&
    (!payload.team_id || !allowedTeamIds.has(payload.team_id))
  ) {
    return { ok: false, status: 401, error: "Unrecognized Slack workspace" };
  }

  if (
    allowedAppIds &&
    (!payload.api_app_id || !allowedAppIds.has(payload.api_app_id))
  ) {
    return { ok: false, status: 401, error: "Unrecognized Slack app" };
  }

  return { ok: true };
}

export function verifySlackSignature(options: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  signingSecret: string | undefined;
  nowMs?: number;
}): boolean {
  const {
    rawBody,
    timestamp,
    signature,
    signingSecret,
    nowMs = Date.now(),
  } = options;
  if (!timestamp || !signature || !signingSecret) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > 300) return false;

  const expected =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

export function parseSlackJsonPayload(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export function slackUrlVerificationChallenge(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { type?: unknown; challenge?: unknown };
  return body.type === "url_verification" && typeof body.challenge === "string"
    ? body.challenge
    : null;
}

export function extractShareLink(urlValue: string): {
  id: string;
  origin: string;
  basePath: string;
} | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const shareIndex = parts.indexOf("share");
  const recordingIndex = parts.indexOf("r");
  const resourceIndex = shareIndex >= 0 ? shareIndex : recordingIndex;
  const id = resourceIndex >= 0 ? parts[resourceIndex + 1] : undefined;
  if (!id) return null;

  return {
    id: decodeURIComponent(id),
    origin: url.origin,
    basePath:
      resourceIndex > 0 ? `/${parts.slice(0, resourceIndex).join("/")}` : "",
  };
}

function appPath(path: string, basePath: string): string {
  const base = basePath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

function absoluteUrl(value: string | null | undefined, origin: string): string {
  if (!value) return AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE;
  try {
    return new URL(value, origin).toString();
  } catch {
    return AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE;
  }
}

function isExpired(value: string | null): boolean {
  if (!value) return false;
  const expires = new Date(value).getTime();
  return Number.isFinite(expires) && expires < Date.now();
}

function formatSlackDuration(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function isSlackPlayableRecording(
  recording: SlackUnfurlRecording,
): boolean {
  return (
    recording.visibility === "public" &&
    recording.status === "ready" &&
    !recording.password &&
    !recording.archivedAt &&
    !recording.trashedAt &&
    !isExpired(recording.expiresAt) &&
    Boolean(recording.videoUrl)
  );
}

export function buildSlackVideoBlock(options: {
  recording: SlackUnfurlRecording;
  origin: string;
  basePath?: string;
}): SlackVideoBlock | null {
  const { recording, origin, basePath = "" } = options;
  if (!isSlackPlayableRecording(recording)) return null;

  const shareUrl = new URL(
    appPath(`/share/${encodeURIComponent(recording.id)}`, basePath),
    origin,
  ).toString();
  const videoUrl = new URL(
    appPath(`/embed/${encodeURIComponent(recording.id)}?autoplay=1`, basePath),
    origin,
  ).toString();
  const title = displayRecordingTitle(recording.title);
  const shareDescription = clipsShareDescription(recording);
  const duration = formatSlackDuration(recording.durationMs);
  const description = duration
    ? `${duration} · ${shareDescription}`
    : shareDescription;
  const thumbnailUrl = absoluteUrl(
    recording.thumbnailUrl || recording.animatedThumbnailUrl,
    origin,
  );

  return {
    type: "video",
    title: { type: "plain_text", text: title, emoji: true },
    title_url: shareUrl,
    description: { type: "plain_text", text: description, emoji: true },
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    alt_text: title,
    provider_name: "Clips",
  };
}

export async function loadSlackVideoBlockForUrl(
  url: string,
): Promise<SlackVideoBlock | null> {
  const share = extractShareLink(url);
  if (!share) return null;

  const [recording] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      description: schema.recordings.description,
      durationMs: schema.recordings.durationMs,
      thumbnailUrl: schema.recordings.thumbnailUrl,
      animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
      visibility: schema.recordings.visibility,
      status: schema.recordings.status,
      password: schema.recordings.password,
      archivedAt: schema.recordings.archivedAt,
      trashedAt: schema.recordings.trashedAt,
      expiresAt: schema.recordings.expiresAt,
      videoUrl: schema.recordings.videoUrl,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, share.id))
    .limit(1);

  return recording
    ? buildSlackVideoBlock({
        recording,
        origin: share.origin,
        basePath: share.basePath,
      })
    : null;
}

export async function buildChatUnfurlPayload(
  payload: SlackLinkSharedPayload,
  resolveBlockForUrl: (url: string) => Promise<SlackVideoBlock | null>,
): Promise<ChatUnfurlPayload | null> {
  if (
    payload.type !== "event_callback" ||
    payload.event?.type !== "link_shared"
  ) {
    return null;
  }
  const channel = payload.event.channel;
  const ts = payload.event.message_ts;
  if (!channel || !ts) return null;

  const unfurls: ChatUnfurlPayload["unfurls"] = {};
  const links = payload.event.links ?? [];
  for (const link of links.slice(0, MAX_UNFURL_LINKS)) {
    if (!link.url || unfurls[link.url]) continue;
    const block = await resolveBlockForUrl(link.url);
    if (block) unfurls[link.url] = { blocks: [block] };
  }

  return Object.keys(unfurls).length > 0 ? { channel, ts, unfurls } : null;
}

export async function postSlackUnfurl(options: {
  token: string;
  payload: ChatUnfurlPayload;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { token, payload, fetchImpl = fetch } = options;
  const res = await fetchImpl(SLACK_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Slack unfurl failed (${res.status})`);
  }
}

export async function handleSlackLinkSharedPayload(
  payload: SlackLinkSharedPayload,
  token: string,
): Promise<void> {
  const unfurlPayload = await buildChatUnfurlPayload(
    payload,
    loadSlackVideoBlockForUrl,
  );
  if (!unfurlPayload) return;
  await postSlackUnfurl({ token, payload: unfurlPayload });
}
