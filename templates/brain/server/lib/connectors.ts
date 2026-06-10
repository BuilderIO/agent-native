import { and, desc, eq } from "drizzle-orm";
import { getCredentialContext } from "@agent-native/core/server";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../db/index.js";
import {
  inspectSourceCredentialAvailability,
  resolveSourceCredential,
} from "./source-credentials.js";
import {
  createCapture,
  nanoid,
  nowIso,
  parseJson,
  serializeCapture,
  stableJson,
} from "./brain.js";
import type {
  BrainCaptureKind,
  BrainSourceProvider,
} from "../../shared/types.js";

export interface ConnectorSyncResult {
  runId: string;
  sourceId: string;
  provider: BrainSourceProvider;
  status: "success" | "error";
  capturesCreated: number;
  captures: Array<ReturnType<typeof serializeCapture>>;
  message: string;
  stats?: Record<string, unknown>;
}

export interface SlackPilotOptions {
  readHistory?: boolean;
  channelRefs?: string[];
  resolveNames?: boolean;
  historyLimit?: number;
  maxChannels?: number;
  permalinkLimit?: number;
  recentDays?: number;
  oldest?: string;
}

export interface SlackPilotReport {
  sourceId: string;
  sourceTitle: string;
  ok: boolean;
  status: "validated" | "blocked" | "synced" | "error";
  historyRead: boolean;
  credential: {
    ok: boolean;
    team?: string | null;
    teamId?: string | null;
    workspaceUrl?: string | null;
    botUser?: string | null;
    error?: string | null;
  };
  guardrails: {
    historyReadRequested: boolean;
    maxChannels: number;
    historyLimit: number;
    pagesPerChannel: number;
    permalinkLimit: number;
    autoSync: false;
    oldest?: string;
  };
  channelValidation: {
    requested: number;
    checked: number;
    ok: number;
    excluded: number;
    missing: number;
    skipped: number;
    channels: Array<{
      ref: string;
      id?: string;
      name?: string;
      status: "ok" | "excluded" | "missing" | "skipped";
      message: string;
      directExcluded?: boolean;
      archived?: boolean;
      privateChannel?: boolean;
    }>;
  };
  sync?: {
    runId: string;
    status: "success" | "error";
    message: string;
    stats?: Record<string, unknown>;
  };
  capturesCreated: number;
  captures: Array<{
    id: string;
    title: string;
    capturedAt: string;
    sourceUrl?: string | null;
  }>;
  proposals: {
    total: number;
    pending: number;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
    }>;
  };
  currentKnowledge: {
    total: number;
    published: number;
    draft: number;
    redacted: number;
    archived: number;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      updatedAt: string;
    }>;
  };
  privacyExclusions: string[];
  nextSteps: string[];
}

type SourceRow = typeof schema.brainSources.$inferSelect;

interface Connector {
  sync(source: SourceRow): Promise<ConnectorSyncResult>;
}

interface RetryCursor {
  provider: BrainSourceProvider;
  endpoint: string;
  retryAfterSeconds: number;
  retryAfterAt: string;
  encounteredAt: string;
}

interface SlackChannelCursor {
  latestTs?: string;
  pageCursor?: string;
  pendingLatestTs?: string;
}

interface SlackSyncCursor {
  channels?: Record<string, SlackChannelCursor>;
  retry?: RetryCursor;
  lastRunAt?: string;
}

interface GranolaSyncCursor {
  cursor?: string | null;
  updatedAfter?: string;
  retry?: RetryCursor;
  lastRunAt?: string;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_archived?: boolean;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackHistoryResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackInfoResponse {
  channel?: SlackChannel;
}

interface SlackListResponse {
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

interface SlackPermalinkResponse {
  permalink?: string;
}

interface SlackAuthTestResponse {
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

interface GranolaListNote {
  id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  web_url?: string;
  owner?: unknown;
}

interface GranolaListResponse {
  notes?: GranolaListNote[];
  hasMore?: boolean;
  has_more?: boolean;
  cursor?: string | null;
}

interface GranolaNote extends GranolaListNote {
  summary_text?: string;
  summary_markdown?: string;
  summary?: unknown;
  transcript?: unknown;
  attendees?: unknown;
  calendar_event?: unknown;
  folder_membership?: unknown;
}

interface GitHubRepoCursor {
  updatedAfter?: string;
}

interface GitHubSyncCursor {
  repositories?: Record<string, GitHubRepoCursor>;
  retry?: RetryCursor;
  lastRunAt?: string;
}

interface GitHubLabel {
  name?: string;
  color?: string;
  description?: string | null;
}

interface GitHubLinkedRef {
  repo: string;
  number: number;
  type?: "issue" | "pull";
  url: string;
  linkedFrom?: {
    sourceId: string;
    captureId: string;
    captureTitle: string;
    sourceUrl?: string | null;
  };
}

interface GitHubIssueOrPull {
  id?: number;
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  state?: string;
  locked?: boolean;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  user?: {
    login?: string;
    html_url?: string;
  } | null;
  labels?: Array<string | GitHubLabel>;
  pull_request?: {
    html_url?: string;
    merged_at?: string | null;
    diff_url?: string;
    patch_url?: string;
    url?: string;
  };
}

interface GitHubPullDetails {
  html_url?: string;
  merged?: boolean;
  merged_at?: string | null;
  draft?: boolean;
  mergeable_state?: string | null;
  comments?: number;
  review_comments?: number;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

interface GitHubIssueComment {
  id?: number;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: {
    login?: string;
    html_url?: string;
  } | null;
}

interface GitHubPullReview {
  id?: number;
  state?: string;
  body?: string | null;
  html_url?: string;
  submitted_at?: string;
  user?: {
    login?: string;
    html_url?: string;
  } | null;
}

interface GitHubContext {
  pull?: GitHubPullDetails | null;
  comments: GitHubIssueComment[];
  reviews: GitHubPullReview[];
}

class ConnectorRateLimitError extends Error {
  constructor(
    public provider: BrainSourceProvider,
    public endpoint: string,
    public retryAfterSeconds: number,
  ) {
    super(
      `${provider} rate limited ${endpoint}; retry after ${retryAfterSeconds}s`,
    );
  }
}

function transcriptItems(config: Record<string, unknown>) {
  const raw = config.transcripts ?? config.sampleTranscripts ?? config.messages;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { title: "Imported capture", content: item };
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const content =
        typeof record.content === "string"
          ? record.content
          : typeof record.text === "string"
            ? record.text
            : "";
      if (!content.trim()) return null;
      return {
        externalId:
          typeof record.externalId === "string" ? record.externalId : undefined,
        title:
          typeof record.title === "string" ? record.title : "Imported capture",
        content,
        kind:
          typeof record.kind === "string"
            ? (record.kind as BrainCaptureKind)
            : "transcript",
        capturedAt:
          typeof record.capturedAt === "string" ? record.capturedAt : undefined,
        metadata:
          typeof record.metadata === "object" && record.metadata
            ? (record.metadata as Record<string, unknown>)
            : {},
      };
    })
    .filter(Boolean) as Array<{
    title: string;
    content: string;
    kind: BrainCaptureKind;
    capturedAt?: string;
    metadata: Record<string, unknown>;
    externalId?: string;
  }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function configuredList(
  config: Record<string, unknown>,
  keys: string[],
  nestedKey?: string,
): string[] {
  const values: string[] = [];
  const configs = nestedKey
    ? [config, objectValue(config[nestedKey])]
    : [config];

  for (const itemConfig of configs) {
    for (const key of keys) {
      const raw = itemConfig[key];
      if (typeof raw === "string") {
        values.push(...raw.split(","));
      } else if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string") values.push(item);
        }
      }
    }
  }

  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.replace(/^#/, "")),
    ),
  );
}

export function slackChannelRefsFromConfig(config: Record<string, unknown>) {
  return configuredList(
    config,
    [
      "channelIds",
      "channels",
      "allowedChannels",
      "allowlistedChannels",
      "allowList",
    ],
    "slack",
  );
}

function configuredNumber(
  config: Record<string, unknown>,
  keys: string[],
  fallback: number,
  options: { min: number; max: number; nestedKey?: string },
): number {
  const configs = options.nestedKey
    ? [config, objectValue(config[options.nestedKey])]
    : [config];
  for (const itemConfig of configs) {
    for (const key of keys) {
      const raw = itemConfig[key];
      const value =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw)
            : Number.NaN;
      if (Number.isFinite(value)) {
        return Math.max(options.min, Math.min(options.max, Math.floor(value)));
      }
    }
  }
  return fallback;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function removeSlackHistoryConfig(config: Record<string, unknown>) {
  const next = { ...config };
  for (const key of [
    "channelIds",
    "channels",
    "allowedChannels",
    "allowlistedChannels",
    "allowList",
    "transcripts",
    "sampleTranscripts",
    "messages",
    "fixture",
    "testFixture",
    "useConfiguredItems",
  ]) {
    delete next[key];
  }
  const nestedSlack = objectValue(next.slack);
  for (const key of [
    "channelIds",
    "channels",
    "allowedChannels",
    "allowlistedChannels",
    "allowList",
  ]) {
    delete nestedSlack[key];
  }
  next.slack = nestedSlack;
  return next;
}

function sourceUrlFromCapture(
  capture: ReturnType<typeof serializeCapture>,
): string | null {
  const raw = capture.metadata as Record<string, unknown>;
  return typeof raw.sourceUrl === "string"
    ? raw.sourceUrl
    : typeof raw.permalink === "string"
      ? raw.permalink
      : null;
}

async function summarizeSlackPilotSource(sourceId: string) {
  const db = getDb();
  const [knowledgeRows, proposalRows] = await Promise.all([
    db
      .select()
      .from(schema.brainKnowledge)
      .where(
        and(
          accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
          eq(schema.brainKnowledge.sourceId, sourceId),
        ),
      ),
    db
      .select()
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          eq(schema.brainProposals.sourceId, sourceId),
        ),
      ),
  ]);

  const sortRecent = <T extends { updatedAt?: unknown; createdAt?: unknown }>(
    rows: T[],
  ) =>
    [...rows].sort((a, b) =>
      String(b.updatedAt ?? b.createdAt ?? "").localeCompare(
        String(a.updatedAt ?? a.createdAt ?? ""),
      ),
    );

  return {
    proposals: {
      total: proposalRows.length,
      pending: proposalRows.filter((row) => row.status === "pending").length,
      recent: sortRecent(proposalRows)
        .slice(0, 3)
        .map((row) => ({
          id: String(row.id),
          title: String(row.title),
          status: String(row.status),
          createdAt: String(row.createdAt),
        })),
    },
    currentKnowledge: {
      total: knowledgeRows.length,
      published: knowledgeRows.filter((row) => row.status === "published")
        .length,
      draft: knowledgeRows.filter((row) => row.status === "draft").length,
      redacted: knowledgeRows.filter((row) => row.status === "redacted").length,
      archived: knowledgeRows.filter((row) => row.status === "archived").length,
      recent: sortRecent(knowledgeRows)
        .slice(0, 3)
        .map((row) => ({
          id: String(row.id),
          title: String(row.title),
          status: String(row.status),
          updatedAt: String(row.updatedAt),
        })),
    },
  };
}

function isFixtureConfig(config: Record<string, unknown>) {
  return (
    config.fixture === true ||
    config.testFixture === true ||
    config.useConfiguredItems === true
  );
}

async function requireConnectorCredential(
  key: string,
  label: string,
  provider: BrainSourceProvider,
  config?: Record<string, unknown>,
): Promise<string> {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      `${label} sync requires an authenticated credential context`,
    );
  }
  const workspaceConnectionId =
    typeof config?.workspaceConnectionId === "string"
      ? config.workspaceConnectionId
      : undefined;
  const value = await resolveSourceCredential({
    provider,
    key,
    ctx,
    workspaceConnectionId,
  });
  if (!value) {
    if (workspaceConnectionId?.trim()) {
      const availability = await inspectSourceCredentialAvailability({
        provider,
        key,
        ctx,
        workspaceConnectionId,
      });
      throw new Error(
        availability.missingMessage ??
          `${label} credential ${key} is not configured`,
      );
    }
    throw new Error(`${label} credential ${key} is not configured`);
  }
  return value;
}

function retryCursor(
  error: ConnectorRateLimitError,
  provider: BrainSourceProvider,
): RetryCursor {
  const now = Date.now();
  return {
    provider,
    endpoint: error.endpoint,
    retryAfterSeconds: error.retryAfterSeconds,
    retryAfterAt: new Date(now + error.retryAfterSeconds * 1000).toISOString(),
    encounteredAt: new Date(now).toISOString(),
  };
}

function retryAfterSeconds(headers: Headers): number {
  const raw = headers.get("retry-after");
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
}

function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function slackTsFromDateish(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return (ms / 1000).toFixed(6);
}

function isoFromSlackTs(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function newestSlackTs(messages: SlackMessage[]): string | undefined {
  const timestamps = messages
    .map((message) => message.ts)
    .filter((ts): ts is string => typeof ts === "string" && ts.length > 0)
    .sort((a, b) => Number(b) - Number(a));
  return timestamps[0];
}

function readableJson(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  for (const key of ["markdown", "text", "content", "summary"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return JSON.stringify(value, null, 2);
}

function slackUserLabel(message: SlackMessage): string {
  return message.username ?? message.user ?? message.bot_id ?? "unknown";
}

function slackDirectConversationFromRef(
  channelRef: string,
): SlackChannel | null {
  const normalized = channelRef.trim().replace(/^#/, "");
  if (!/^D[A-Z0-9]+$/i.test(normalized)) return null;
  return { id: normalized.toUpperCase(), is_im: true };
}

export function isSlackDirectConversation(channel: SlackChannel): boolean {
  return channel.is_im === true || channel.is_mpim === true;
}

function isUsableSlackChannel(channel: SlackChannel): boolean {
  return (
    !isSlackDirectConversation(channel) &&
    channel.is_archived !== true &&
    (channel.is_channel === true || channel.is_group === true)
  );
}

function normalizeSlackMessageContent(
  channel: SlackChannel,
  message: SlackMessage,
): string {
  const label = slackUserLabel(message);
  const time = isoFromSlackTs(message.ts) ?? message.ts ?? "unknown time";
  const thread =
    message.thread_ts && message.thread_ts !== message.ts
      ? `\nThread: ${message.thread_ts}`
      : "";
  return [
    `Slack #${channel.name ?? channel.id} at ${time}`,
    `User: ${label}${thread}`,
    "",
    message.text ?? "",
  ].join("\n");
}

async function slackApi<T>(
  token: string,
  method: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const url = buildUrl(`https://slack.com/api/${method}`, params);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 429) {
    throw new ConnectorRateLimitError(
      "slack",
      method,
      retryAfterSeconds(response.headers),
    );
  }
  if (!response.ok) {
    throw new Error(`Slack ${method} failed (${response.status})`);
  }
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    needed?: string;
    provided?: string;
  };
  if (data.ok === false) {
    if (data.error === "ratelimited") {
      throw new ConnectorRateLimitError("slack", method, 60);
    }
    const details = [
      data.needed ? `needed: ${data.needed}` : null,
      data.provided ? `provided: ${data.provided}` : null,
    ].filter(Boolean);
    throw new Error(
      `Slack ${method} failed: ${data.error ?? "unknown"}${details.length ? ` (${details.join("; ")})` : ""}`,
    );
  }
  return data as T;
}

async function resolveSlackChannelByName(
  token: string,
  name: string,
): Promise<SlackChannel | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const data = await slackApi<SlackListResponse>(
      token,
      "conversations.list",
      {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      },
    );
    const match = (data.channels ?? []).find(
      (channel) => channel.name?.toLowerCase() === name.toLowerCase(),
    );
    if (match) return match;
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
}

async function resolveSlackChannel(
  token: string,
  channelRef: string,
): Promise<SlackChannel | null> {
  const directConversation = slackDirectConversationFromRef(channelRef);
  if (directConversation) return directConversation;

  const looksLikeId = /^[CG][A-Z0-9]+$/i.test(channelRef);
  if (looksLikeId) {
    const data = await slackApi<SlackInfoResponse>(
      token,
      "conversations.info",
      { channel: channelRef },
    );
    return data.channel ?? null;
  }
  const byName = await resolveSlackChannelByName(token, channelRef);
  if (!byName) return null;
  const data = await slackApi<SlackInfoResponse>(token, "conversations.info", {
    channel: byName.id,
  });
  return data.channel ?? byName;
}

async function slackPermalink(
  token: string,
  channelId: string,
  ts: string | undefined,
): Promise<string | null> {
  if (!ts) return null;
  const data = await slackApi<SlackPermalinkResponse>(
    token,
    "chat.getPermalink",
    { channel: channelId, message_ts: ts },
  );
  return data.permalink ?? null;
}

export async function testSlackConnection(
  options: {
    channelRefs?: string[];
    resolveNames?: boolean;
    workspaceConnectionId?: string;
  } = {},
) {
  const token = await requireConnectorCredential(
    "SLACK_BOT_TOKEN",
    "Slack",
    "slack",
    { workspaceConnectionId: options.workspaceConnectionId },
  );
  const auth = await slackApi<SlackAuthTestResponse>(token, "auth.test");
  const channelRefs = Array.from(
    new Set(
      (options.channelRefs ?? [])
        .map((ref) => ref.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ).slice(0, 25);
  const channels = [];

  for (const ref of channelRefs) {
    const directConversation = slackDirectConversationFromRef(ref);
    if (directConversation) {
      channels.push({
        ref,
        id: directConversation.id,
        status: "excluded" as const,
        message: "DMs and MPIMs are structurally excluded.",
        directExcluded: true,
        archived: false,
        privateChannel: false,
      });
      continue;
    }

    const looksLikeId = /^[CG][A-Z0-9]+$/i.test(ref);
    if (!looksLikeId && !options.resolveNames) {
      channels.push({
        ref,
        status: "skipped" as const,
        message:
          "Name resolution was disabled. Pass a Slack channel ID or set resolveNames=true.",
      });
      continue;
    }

    const channel = await resolveSlackChannel(token, ref);
    if (!channel) {
      channels.push({
        ref,
        status: "missing" as const,
        message: "Slack did not return a matching channel.",
      });
      continue;
    }

    const directExcluded = isSlackDirectConversation(channel);
    const usable = isUsableSlackChannel(channel);
    channels.push({
      ref,
      id: channel.id,
      name: channel.name,
      status: usable ? ("ok" as const) : ("excluded" as const),
      directExcluded,
      archived: channel.is_archived === true,
      privateChannel: channel.is_group === true,
      message: usable
        ? "Channel can be allow-listed for Brain sync."
        : directExcluded
          ? "DMs and MPIMs are structurally excluded."
          : "Channel is archived or not a supported channel type.",
    });
  }

  return {
    ok: true,
    team: auth.team ?? null,
    teamId: auth.team_id ?? null,
    workspaceUrl: auth.url ?? null,
    botUser: auth.user ?? null,
    botUserId: auth.user_id ?? null,
    botId: auth.bot_id ?? null,
    checkedChannels: channels.length,
    channels,
    historyRead: false,
  };
}

function slackPilotPrivacyExclusions(
  validation: SlackPilotReport["channelValidation"],
  readHistory: boolean,
) {
  const exclusions = [
    "DMs and MPIMs are structurally excluded before any history read.",
    "Only explicitly allow-listed public or private channels are eligible.",
  ];
  if (validation.excluded > 0) {
    exclusions.push(
      `${validation.excluded} channel reference(s) were excluded as unsupported or archived.`,
    );
  }
  if (validation.missing > 0) {
    exclusions.push(
      `${validation.missing} channel reference(s) were not found by Slack.`,
    );
  }
  if (validation.skipped > 0) {
    exclusions.push(
      `${validation.skipped} channel name(s) were skipped because name resolution was not enabled.`,
    );
  }
  if (!readHistory) {
    exclusions.push("No Slack message history was read for this pilot report.");
  }
  return exclusions;
}

function slackPilotNextSteps(report: {
  status: SlackPilotReport["status"];
  historyRead: boolean;
  channelValidation: SlackPilotReport["channelValidation"];
  capturesCreated: number;
}) {
  if (report.channelValidation.requested === 0) {
    return [
      "Add one or two Slack channel IDs to the source allow-list.",
      "Run the pilot again before attempting any history sync.",
    ];
  }
  if (report.channelValidation.ok === 0) {
    return [
      "Fix the channel allow-list or enable name resolution for channel names.",
      "Confirm the Slack bot is a member of each private channel.",
    ];
  }
  if (!report.historyRead) {
    return [
      "Review the validated channel list.",
      "Run Pilot sync only if these channels should read a tiny recent sample.",
    ];
  }
  if (report.capturesCreated > 0) {
    return [
      "Review the new raw captures and distill only durable company knowledge.",
      "Keep regular sync disabled until the source rules look right.",
    ];
  }
  return [
    "No new messages were captured; check channel membership and recent activity.",
    "Widen the source window deliberately if the pilot needs older messages.",
  ];
}

export async function runSlackPilot(
  source: SourceRow,
  options: SlackPilotOptions = {},
): Promise<SlackPilotReport> {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const requestedRefs = Array.from(
    new Set(
      (options.channelRefs?.length
        ? options.channelRefs
        : slackChannelRefsFromConfig(config)
      )
        .map((ref) => ref.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  );
  const maxChannels = clampInteger(options.maxChannels, 2, 1, 2);
  const historyLimit = clampInteger(options.historyLimit, 10, 1, 10);
  const permalinkLimit = clampInteger(options.permalinkLimit, 10, 0, 10);
  const recentDays = clampInteger(options.recentDays, 14, 1, 30);
  const oldest = options.oldest ?? daysAgoIso(recentDays);
  const baseGuardrails = {
    historyReadRequested: options.readHistory === true,
    maxChannels,
    historyLimit,
    pagesPerChannel: 1,
    permalinkLimit,
    autoSync: false as const,
    oldest,
  };
  const sourceSummary = await summarizeSlackPilotSource(source.id);

  let credential;
  try {
    credential = await testSlackConnection({
      channelRefs: requestedRefs,
      resolveNames: options.resolveNames === true,
      workspaceConnectionId:
        typeof config.workspaceConnectionId === "string"
          ? config.workspaceConnectionId
          : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const channelValidation = {
      requested: requestedRefs.length,
      checked: 0,
      ok: 0,
      excluded: 0,
      missing: 0,
      skipped: 0,
      channels: [],
    };
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      ok: false,
      status: "error",
      historyRead: false,
      credential: { ok: false, error: message },
      guardrails: baseGuardrails,
      channelValidation,
      capturesCreated: 0,
      captures: [],
      ...sourceSummary,
      privacyExclusions: slackPilotPrivacyExclusions(channelValidation, false),
      nextSteps: [
        "Fix the Slack credential before validating channel allow-lists.",
        "Then rerun the pilot with history reads still off.",
      ],
    };
  }

  const channels = credential.channels;
  const channelValidation = {
    requested: requestedRefs.length,
    checked: credential.checkedChannels,
    ok: channels.filter((channel) => channel.status === "ok").length,
    excluded: channels.filter((channel) => channel.status === "excluded")
      .length,
    missing: channels.filter((channel) => channel.status === "missing").length,
    skipped: channels.filter((channel) => channel.status === "skipped").length,
    channels,
  };

  if (requestedRefs.length === 0 || !options.readHistory) {
    const blocked = requestedRefs.length === 0;
    const partial = {
      status: blocked ? ("blocked" as const) : ("validated" as const),
      historyRead: false,
      channelValidation,
      capturesCreated: 0,
    };
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      ok: !blocked,
      ...partial,
      credential: {
        ok: true,
        team: credential.team,
        teamId: credential.teamId,
        workspaceUrl: credential.workspaceUrl,
        botUser: credential.botUser,
      },
      guardrails: baseGuardrails,
      captures: [],
      ...sourceSummary,
      privacyExclusions: slackPilotPrivacyExclusions(channelValidation, false),
      nextSteps: slackPilotNextSteps(partial),
    };
  }

  const validatedChannelIds = channels
    .filter(
      (channel): channel is (typeof channels)[number] & { id: string } =>
        channel.status === "ok" && typeof channel.id === "string",
    )
    .map((channel) => channel.id)
    .slice(0, maxChannels);

  if (validatedChannelIds.length === 0) {
    const partial = {
      status: "blocked" as const,
      historyRead: false,
      channelValidation,
      capturesCreated: 0,
    };
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      ok: false,
      ...partial,
      credential: {
        ok: true,
        team: credential.team,
        teamId: credential.teamId,
        workspaceUrl: credential.workspaceUrl,
        botUser: credential.botUser,
      },
      guardrails: baseGuardrails,
      captures: [],
      ...sourceSummary,
      privacyExclusions: slackPilotPrivacyExclusions(channelValidation, false),
      nextSteps: slackPilotNextSteps(partial),
    };
  }

  const boundedConfig = {
    ...removeSlackHistoryConfig(config),
    channelIds: validatedChannelIds,
    historyLimit,
    maxChannelsPerSync: maxChannels,
    pagesPerChannel: 1,
    permalinkLimit,
    autoSync: false,
    oldest,
    slack: {
      ...objectValue(removeSlackHistoryConfig(config).slack),
      channelIds: validatedChannelIds,
      historyLimit,
      maxChannelsPerSync: maxChannels,
      pagesPerChannel: 1,
      permalinkLimit,
      autoSync: false,
      oldest,
    },
  };
  const sync = await runConnectorSync({
    ...source,
    configJson: stableJson(boundedConfig),
  });
  const updatedSummary = await summarizeSlackPilotSource(source.id);
  const captures = sync.captures.map((capture) => ({
    id: capture.id,
    title: capture.title,
    capturedAt: capture.capturedAt,
    sourceUrl: sourceUrlFromCapture(capture),
  }));
  const partial = {
    status:
      sync.status === "success" ? ("synced" as const) : ("error" as const),
    historyRead: true,
    channelValidation,
    capturesCreated: sync.capturesCreated,
  };

  return {
    sourceId: source.id,
    sourceTitle: source.title,
    ok: sync.status === "success",
    ...partial,
    credential: {
      ok: true,
      team: credential.team,
      teamId: credential.teamId,
      workspaceUrl: credential.workspaceUrl,
      botUser: credential.botUser,
    },
    guardrails: baseGuardrails,
    sync: {
      runId: sync.runId,
      status: sync.status,
      message: sync.message,
      stats: sync.stats,
    },
    captures,
    ...updatedSummary,
    privacyExclusions: slackPilotPrivacyExclusions(channelValidation, true),
    nextSteps: slackPilotNextSteps(partial),
  };
}

function granolaSpeakerLabel(item: Record<string, unknown>): string {
  const speaker = objectValue(item.speaker);
  const label =
    speaker.diarization_label ??
    speaker.name ??
    speaker.source ??
    item.speaker ??
    "speaker";
  return String(label);
}

function granolaTranscriptLines(transcript: unknown): string[] {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!text) return "";
      const start =
        typeof record.start_time === "string" ? ` ${record.start_time}` : "";
      return `[${granolaSpeakerLabel(record)}${start}] ${text}`;
    })
    .filter(Boolean);
}

export function normalizeGranolaNote(note: GranolaNote) {
  const calendar = objectValue(note.calendar_event);
  const title =
    note.title ??
    (typeof calendar.event_title === "string"
      ? calendar.event_title
      : "Granola meeting note");
  const summary =
    note.summary_markdown ??
    note.summary_text ??
    readableJson(note.summary).trim();
  const transcriptLines = granolaTranscriptLines(note.transcript);
  const body = [
    summary ? `Summary\n${summary}` : "",
    transcriptLines.length ? `Transcript\n${transcriptLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    externalId: note.id ? `granola:${note.id}` : undefined,
    title,
    content: body || summary || title,
    capturedAt:
      (typeof calendar.scheduled_start_time === "string"
        ? calendar.scheduled_start_time
        : undefined) ??
      note.created_at ??
      nowIso(),
    metadata: {
      provider: "granola",
      granolaNoteId: note.id,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      scheduledStartTime:
        typeof calendar.scheduled_start_time === "string"
          ? calendar.scheduled_start_time
          : undefined,
      attendeesCount: Array.isArray(note.attendees)
        ? note.attendees.length
        : undefined,
      transcriptSegmentCount: Array.isArray(note.transcript)
        ? note.transcript.length
        : undefined,
      hasOwner: Boolean(note.owner),
      hasFolders: Boolean(note.folder_membership),
    },
  };
}

async function granolaApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const url = buildUrl(`https://public-api.granola.ai/v1${path}`, params);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 429) {
    throw new ConnectorRateLimitError(
      "granola",
      path,
      retryAfterSeconds(response.headers),
    );
  }
  if (!response.ok) {
    throw new Error(`Granola ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function githubRepoFromValue(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/, "");
  if (!trimmed) return null;
  const withoutProtocol = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "");
  const [owner, repo] = withoutProtocol.split("/");
  if (!owner || !repo) return null;
  const cleanRepo = repo.split(/[?#]/)[0];
  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(cleanRepo)
  ) {
    return null;
  }
  return `${owner}/${cleanRepo}`;
}

function githubReposFromConfig(config: Record<string, unknown>): string[] {
  return configuredList(config, ["repositories", "repos"], "github")
    .map(githubRepoFromValue)
    .filter((repo): repo is string => Boolean(repo));
}

function githubLinkedSourceIdsFromConfig(config: Record<string, unknown>) {
  return configuredList(
    config,
    ["linkedSourceIds", "linkedSlackSourceIds", "slackSourceIds", "sourceIds"],
    "github",
  );
}

function configuredBoolean(
  config: Record<string, unknown>,
  keys: string[],
  fallback: boolean,
  nestedKey?: string,
): boolean {
  const configs = nestedKey
    ? [config, objectValue(config[nestedKey])]
    : [config];
  for (const itemConfig of configs) {
    for (const key of keys) {
      const raw = itemConfig[key];
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") {
        if (raw.toLowerCase() === "true") return true;
        if (raw.toLowerCase() === "false") return false;
      }
    }
  }
  return fallback;
}

function githubStateFromConfig(config: Record<string, unknown>) {
  const raw =
    (typeof config.state === "string" ? config.state : undefined) ??
    (typeof objectValue(config.github).state === "string"
      ? String(objectValue(config.github).state)
      : undefined);
  return raw === "open" || raw === "closed" || raw === "all" ? raw : "all";
}

function githubRetryAfterSeconds(headers: Headers): number {
  const retryAfter = retryAfterSeconds(headers);
  if (retryAfter !== 60) return retryAfter;
  const reset = headers.get("x-ratelimit-reset");
  const resetMs = reset ? Number(reset) * 1000 : Number.NaN;
  if (Number.isFinite(resetMs) && resetMs > Date.now()) {
    return Math.ceil((resetMs - Date.now()) / 1000);
  }
  return retryAfter;
}

function githubLabels(labels: GitHubIssueOrPull["labels"]): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((label): label is string => Boolean(label));
}

function textExcerpt(value: string | null | undefined, maxLength: number) {
  const trimmed = (value ?? "").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function sourceUrlFromMetadataRecord(metadata: Record<string, unknown>) {
  for (const key of ["sourceUrl", "url", "permalink", "webUrl", "web_url"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function summarizeGitHubComments(comments: GitHubIssueComment[]) {
  return comments
    .filter((comment) => comment.body?.trim())
    .slice(0, 5)
    .map((comment) => {
      const author = comment.user?.login ?? "unknown";
      const at = comment.updated_at ?? comment.created_at ?? "unknown time";
      return `- ${author} at ${at}: ${textExcerpt(comment.body, 280)}`;
    });
}

function summarizeGitHubReviews(reviews: GitHubPullReview[]) {
  return reviews.slice(0, 5).map((review) => {
    const author = review.user?.login ?? "unknown";
    const state = review.state ?? "reviewed";
    const at = review.submitted_at ?? "unknown time";
    const body = textExcerpt(review.body, 220);
    return `- ${author} ${state.toLowerCase()} at ${at}${body ? `: ${body}` : ""}`;
  });
}

function gitHubRefKey(ref: GitHubLinkedRef) {
  return `${ref.repo}:${ref.number}`;
}

function githubRefsFromText(
  text: string,
  linkedFrom?: GitHubLinkedRef["linkedFrom"],
): GitHubLinkedRef[] {
  const refs: GitHubLinkedRef[] = [];
  const pattern =
    /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)/gi;
  for (const match of text.matchAll(pattern)) {
    const repo = githubRepoFromValue(`${match[1]}/${match[2]}`);
    const number = Number(match[4]);
    if (!repo || !Number.isInteger(number) || number <= 0) continue;
    refs.push({
      repo,
      number,
      type: match[3]?.toLowerCase() === "pull" ? "pull" : "issue",
      url: `https://github.com/${repo}/${match[3]}/${number}`,
      linkedFrom,
    });
  }
  return refs;
}

function normalizeGitHubIssue(
  repo: string,
  item: GitHubIssueOrPull,
  context: GitHubContext = { comments: [], reviews: [] },
  linkedFrom?: GitHubLinkedRef["linkedFrom"],
) {
  const isPullRequest = Boolean(item.pull_request);
  const number = item.number ?? item.id ?? "unknown";
  const labels = githubLabels(item.labels);
  const sourceUrl = item.html_url ?? item.pull_request?.html_url ?? null;
  const merged =
    context.pull?.merged ??
    Boolean(item.pull_request?.merged_at ?? context.pull?.merged_at);
  const mergedAt = context.pull?.merged_at ?? item.pull_request?.merged_at;
  const title =
    item.title ??
    `${repo} ${isPullRequest ? "pull request" : "issue"} #${number}`;
  const author = item.user?.login ?? "unknown";
  const bodyExcerpt = textExcerpt(item.body, 4000);
  const commentSummary = summarizeGitHubComments(context.comments);
  const reviewSummary = summarizeGitHubReviews(context.reviews);
  const header = [
    `GitHub ${repo} ${isPullRequest ? "pull request" : "issue"} #${number}`,
    `State: ${item.state ?? "unknown"}`,
    isPullRequest
      ? `Merged: ${merged ? "yes" : "no"}${mergedAt ? ` (${mergedAt})` : ""}`
      : "",
    `Author: ${author}`,
    labels.length ? `Labels: ${labels.join(", ")}` : "",
    item.created_at ? `Created: ${item.created_at}` : "",
    item.updated_at ? `Updated: ${item.updated_at}` : "",
    item.closed_at ? `Closed: ${item.closed_at}` : "",
    sourceUrl ? `URL: ${sourceUrl}` : "",
    linkedFrom
      ? `Linked from Slack capture: ${linkedFrom.captureTitle} (${linkedFrom.captureId})`
      : "",
    linkedFrom?.sourceUrl ? `Slack URL: ${linkedFrom.sourceUrl}` : "",
  ].filter(Boolean);
  const content = [
    header.join("\n"),
    "",
    `Title\n${title}`,
    "",
    bodyExcerpt ? `Body excerpt\n${bodyExcerpt}` : "Body excerpt\n(No body)",
    commentSummary.length
      ? `Comment summary\n${commentSummary.join("\n")}`
      : "",
    reviewSummary.length ? `Review summary\n${reviewSummary.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    externalId: `github:${repo}:${isPullRequest ? "pull" : "issue"}:${number}`,
    title,
    kind: isPullRequest ? ("document" as const) : ("note" as const),
    content,
    capturedAt: item.updated_at ?? item.created_at ?? nowIso(),
    metadata: {
      provider: "github",
      connector: "github",
      repository: repo,
      number: item.number,
      githubId: item.id,
      type: isPullRequest ? "pull_request" : "issue",
      state: item.state,
      merged: isPullRequest ? merged : undefined,
      mergedAt,
      author,
      authorUrl: item.user?.html_url,
      labels,
      bodyExcerpt,
      sourceUrl,
      htmlUrl: item.html_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      closedAt: item.closed_at,
      linkedFrom,
      pullRequest: {
        ...item.pull_request,
        details: context.pull,
      },
      comments: context.comments.map((comment) => ({
        id: comment.id,
        author: comment.user?.login,
        authorUrl: comment.user?.html_url,
        sourceUrl: comment.html_url,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        bodyExcerpt: textExcerpt(comment.body, 800),
      })),
      reviews: context.reviews.map((review) => ({
        id: review.id,
        author: review.user?.login,
        authorUrl: review.user?.html_url,
        sourceUrl: review.html_url,
        state: review.state,
        submittedAt: review.submitted_at,
        bodyExcerpt: textExcerpt(review.body, 800),
      })),
    },
  };
}

async function githubApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const url = buildUrl(`https://api.github.com${path}`, params);
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agent-native-brain",
    },
  });
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (remaining === "0" || response.headers.has("retry-after")))
  ) {
    throw new ConnectorRateLimitError(
      "github",
      path,
      githubRetryAfterSeconds(response.headers),
    );
  }
  if (!response.ok) {
    let suffix = "";
    try {
      const data = (await response.json()) as { message?: string };
      suffix = data.message ? `: ${data.message}` : "";
    } catch {
      suffix = "";
    }
    throw new Error(`GitHub ${path} failed (${response.status})${suffix}`);
  }
  return (await response.json()) as T;
}

async function fetchGitHubContext(
  token: string,
  repo: string,
  item: GitHubIssueOrPull,
  options: {
    commentLimit: number;
    reviewLimit: number;
  },
): Promise<GitHubContext> {
  const number = item.number;
  if (!number) return { comments: [], reviews: [] };
  const isPullRequest = Boolean(item.pull_request);
  const [comments, pull, reviews] = await Promise.all([
    options.commentLimit > 0
      ? githubApi<GitHubIssueComment[]>(
          token,
          `/repos/${repo}/issues/${number}/comments`,
          { per_page: options.commentLimit },
        )
      : Promise.resolve([]),
    isPullRequest
      ? githubApi<GitHubPullDetails>(token, `/repos/${repo}/pulls/${number}`)
      : Promise.resolve(null),
    isPullRequest && options.reviewLimit > 0
      ? githubApi<GitHubPullReview[]>(
          token,
          `/repos/${repo}/pulls/${number}/reviews`,
          { per_page: options.reviewLimit },
        )
      : Promise.resolve([]),
  ]);
  return { comments, pull, reviews };
}

async function githubRefsFromLinkedSources(
  config: Record<string, unknown>,
  options: {
    captureLimit: number;
    refLimit: number;
    stats: Record<string, unknown>;
  },
): Promise<GitHubLinkedRef[]> {
  const sourceIds = githubLinkedSourceIdsFromConfig(config);
  options.stats.linkedSourceIds = sourceIds.length;
  if (!sourceIds.length) return [];

  const db = getDb();
  const refsByKey = new Map<string, GitHubLinkedRef>();

  for (const sourceId of sourceIds) {
    if (refsByKey.size >= options.refLimit) break;
    const access = await assertAccess("brain-source", sourceId, "viewer");
    if (access.resource.provider !== "slack") {
      options.stats.linkedSourcesSkipped =
        Number(options.stats.linkedSourcesSkipped) + 1;
      continue;
    }
    const captures = await db
      .select()
      .from(schema.brainRawCaptures)
      .where(eq(schema.brainRawCaptures.sourceId, sourceId))
      .orderBy(desc(schema.brainRawCaptures.capturedAt))
      .limit(options.captureLimit);

    options.stats.linkedCapturesScanned =
      Number(options.stats.linkedCapturesScanned) + captures.length;

    for (const capture of captures) {
      if (refsByKey.size >= options.refLimit) break;
      const metadata = parseJson<Record<string, unknown>>(
        capture.metadataJson,
        {},
      );
      const raw = objectValue(metadata.raw);
      const linkedFrom = {
        sourceId,
        captureId: capture.id,
        captureTitle: capture.title,
        sourceUrl: sourceUrlFromMetadataRecord(metadata),
      };
      const candidates = [
        capture.content,
        typeof raw.text === "string" ? raw.text : "",
        typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : "",
        typeof metadata.permalink === "string" ? metadata.permalink : "",
      ].join("\n");

      for (const ref of githubRefsFromText(candidates, linkedFrom)) {
        refsByKey.set(gitHubRefKey(ref), ref);
        if (refsByKey.size >= options.refLimit) break;
      }
    }
  }

  options.stats.linkedRefsFound = refsByKey.size;
  return Array.from(refsByKey.values());
}

async function createRun(source: SourceRow) {
  const db = getDb();
  const runId = nanoid();
  await db.insert(schema.brainSyncRuns).values({
    id: runId,
    sourceId: source.id,
    provider: source.provider,
    status: "running",
    statsJson: "{}",
    error: null,
    startedAt: nowIso(),
    completedAt: null,
  });
  return runId;
}

async function finishRun(
  runId: string,
  status: "success" | "error",
  stats: Record<string, unknown>,
  error?: string | null,
) {
  await getDb()
    .update(schema.brainSyncRuns)
    .set({
      status,
      statsJson: stableJson(stats),
      error: error ?? null,
      completedAt: nowIso(),
    })
    .where(eq(schema.brainSyncRuns.id, runId));
}

async function syncFromConfiguredItems(
  source: SourceRow,
  emptyMessage: string,
): Promise<ConnectorSyncResult> {
  const runId = await createRun(source);
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const items = transcriptItems(config);
  const captures = [];

  try {
    for (const item of items) {
      const capture = await createCapture({
        sourceId: source.id,
        externalId: item.externalId,
        title: item.title,
        kind: item.kind,
        content: item.content,
        capturedAt: item.capturedAt,
        metadata: {
          ...item.metadata,
          connector: source.provider,
          syncRunId: runId,
        },
      });
      captures.push(serializeCapture(capture));
    }
    await finishRun(runId, "success", { capturesCreated: captures.length });
    await getDb()
      .update(schema.brainSources)
      .set({
        lastSyncedAt: nowIso(),
        lastError: null,
        status: "active",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: source.provider as BrainSourceProvider,
      status: "success",
      capturesCreated: captures.length,
      captures,
      message: captures.length ? "Imported configured captures" : emptyMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(
      runId,
      "error",
      { capturesCreated: captures.length },
      message,
    );
    await getDb()
      .update(schema.brainSources)
      .set({ lastError: message, status: "error", updatedAt: nowIso() })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: source.provider as BrainSourceProvider,
      status: "error",
      capturesCreated: captures.length,
      captures,
      message,
    };
  }
}

async function syncSlack(source: SourceRow): Promise<ConnectorSyncResult> {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  if (isFixtureConfig(config) || transcriptItems(config).length > 0) {
    return syncFromConfiguredItems(
      source,
      "Slack fixture source has no configured messages.",
    );
  }

  const runId = await createRun(source);
  const db = getDb();
  const cursor = parseJson<SlackSyncCursor>(source.cursorJson, {});
  const nextCursor: SlackSyncCursor = {
    ...cursor,
    channels: { ...(cursor.channels ?? {}) },
    retry: undefined,
    lastRunAt: nowIso(),
  };
  const channelRefs = configuredList(
    config,
    [
      "channelIds",
      "channels",
      "allowedChannels",
      "allowlistedChannels",
      "allowList",
    ],
    "slack",
  );
  const limit = configuredNumber(config, ["historyLimit", "limit"], 15, {
    min: 1,
    max: 15,
    nestedKey: "slack",
  });
  const maxChannels = configuredNumber(
    config,
    ["maxChannelsPerSync", "channelBudget"],
    3,
    { min: 1, max: 25, nestedKey: "slack" },
  );
  const pagesPerChannel = configuredNumber(
    config,
    ["pagesPerChannel", "pageBudget"],
    1,
    { min: 1, max: 5, nestedKey: "slack" },
  );
  const permalinkLimit = configuredNumber(
    config,
    ["permalinkLimit", "citationLinkLimit"],
    15,
    { min: 0, max: 50, nestedKey: "slack" },
  );
  const initialOldest = slackTsFromDateish(
    typeof config.oldest === "string"
      ? config.oldest
      : typeof config.updatedAfter === "string"
        ? config.updatedAfter
        : typeof objectValue(config.slack).oldest === "string"
          ? String(objectValue(config.slack).oldest)
          : undefined,
  );

  const captures = [];
  const stats: Record<string, unknown> = {
    configuredChannels: channelRefs.length,
    scannedChannels: 0,
    rejectedChannels: 0,
    missingChannels: 0,
    messagesSeen: 0,
    capturesCreated: 0,
    rateLimited: false,
  };

  try {
    const token = await requireConnectorCredential(
      "SLACK_BOT_TOKEN",
      "Slack",
      "slack",
      config,
    );
    if (!channelRefs.length) {
      throw new Error(
        "Slack source must configure channelIds, channels, or allowedChannels",
      );
    }

    let permalinkCalls = 0;

    for (const channelRef of channelRefs.slice(0, maxChannels)) {
      const channel = await resolveSlackChannel(token, channelRef);
      if (!channel) {
        stats.missingChannels = Number(stats.missingChannels) + 1;
        continue;
      }
      if (!isUsableSlackChannel(channel)) {
        stats.rejectedChannels = Number(stats.rejectedChannels) + 1;
        continue;
      }

      stats.scannedChannels = Number(stats.scannedChannels) + 1;
      const channelCursor = nextCursor.channels?.[channel.id] ?? {};
      const pendingLatest =
        channelCursor.pendingLatestTs ?? channelCursor.latestTs;

      for (let page = 0; page < pagesPerChannel; page += 1) {
        const params: Record<
          string,
          string | number | boolean | null | undefined
        > = {
          channel: channel.id,
          limit,
        };
        if (channelCursor.pageCursor) {
          params.cursor = channelCursor.pageCursor;
        } else if (channelCursor.latestTs) {
          params.oldest = channelCursor.latestTs;
          params.inclusive = false;
        } else if (initialOldest) {
          params.oldest = initialOldest;
          params.inclusive = false;
        }

        const data = await slackApi<SlackHistoryResponse>(
          token,
          "conversations.history",
          params,
        );
        const messages = (data.messages ?? []).filter(
          (message) =>
            message.type === "message" &&
            typeof message.text === "string" &&
            message.text.trim() &&
            typeof message.ts === "string",
        );
        stats.messagesSeen = Number(stats.messagesSeen) + messages.length;

        const newest = newestSlackTs(messages);
        if (!channelCursor.pendingLatestTs && newest) {
          channelCursor.pendingLatestTs = newest;
        }

        for (const message of messages) {
          let permalink: string | null = null;
          if (permalinkCalls < permalinkLimit) {
            permalink = await slackPermalink(token, channel.id, message.ts);
            permalinkCalls += 1;
          }
          const capture = await createCapture({
            sourceId: source.id,
            externalId: `slack:${channel.id}:${message.ts}`,
            title: `#${channel.name ?? channel.id} message ${isoFromSlackTs(message.ts) ?? message.ts}`,
            kind: "message",
            content: normalizeSlackMessageContent(channel, message),
            capturedAt: isoFromSlackTs(message.ts) ?? nowIso(),
            metadata: {
              provider: "slack",
              connector: "slack",
              syncRunId: runId,
              channelId: channel.id,
              channelName: channel.name,
              ts: message.ts,
              threadTs: message.thread_ts,
              user: message.user,
              username: message.username,
              botId: message.bot_id,
              sourceUrl: permalink,
              permalink,
              raw: message,
            },
          });
          captures.push(serializeCapture(capture));
        }

        const nextPage = data.response_metadata?.next_cursor;
        if (data.has_more && nextPage) {
          channelCursor.pageCursor = nextPage;
          nextCursor.channels![channel.id] = channelCursor;
          break;
        }

        channelCursor.pageCursor = undefined;
        channelCursor.latestTs =
          channelCursor.pendingLatestTs ??
          pendingLatest ??
          channelCursor.latestTs;
        channelCursor.pendingLatestTs = undefined;
        nextCursor.channels![channel.id] = channelCursor;
        break;
      }
    }

    stats.capturesCreated = captures.length;
    await finishRun(runId, "success", stats);
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(nextCursor),
        lastSyncedAt: nowIso(),
        lastError: null,
        status: "active",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "slack",
      status: "success",
      capturesCreated: captures.length,
      captures,
      stats,
      message: captures.length
        ? `Imported ${captures.length} Slack messages`
        : "Slack sync completed with no new channel messages",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = err instanceof ConnectorRateLimitError;
    const failedCursor: SlackSyncCursor = {
      ...cursor,
      ...nextCursor,
      retry: isRateLimit ? retryCursor(err, "slack") : cursor.retry,
      lastRunAt: nowIso(),
    };
    stats.capturesCreated = captures.length;
    stats.rateLimited = isRateLimit;
    await finishRun(
      runId,
      isRateLimit ? "success" : "error",
      stats,
      isRateLimit ? null : message,
    );
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(failedCursor),
        lastError: message,
        status: isRateLimit ? "active" : "error",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "slack",
      status: isRateLimit ? "success" : "error",
      capturesCreated: captures.length,
      captures,
      stats,
      message,
    };
  }
}

async function syncGranola(source: SourceRow): Promise<ConnectorSyncResult> {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  if (isFixtureConfig(config) || transcriptItems(config).length > 0) {
    return syncFromConfiguredItems(
      source,
      "Granola fixture source has no configured transcripts.",
    );
  }

  const runId = await createRun(source);
  const db = getDb();
  const cursor = parseJson<GranolaSyncCursor>(source.cursorJson, {});
  const pageSize = configuredNumber(config, ["pageSize", "limit"], 10, {
    min: 1,
    max: 30,
    nestedKey: "granola",
  });
  const pagesPerSync = configuredNumber(
    config,
    ["pagesPerSync", "pageBudget"],
    1,
    { min: 1, max: 5, nestedKey: "granola" },
  );
  const configuredUpdatedAfter =
    typeof config.updatedAfter === "string"
      ? config.updatedAfter
      : typeof objectValue(config.granola).updatedAfter === "string"
        ? String(objectValue(config.granola).updatedAfter)
        : undefined;
  const updatedAfter = cursor.updatedAfter ?? configuredUpdatedAfter;

  const captures = [];
  const stats: Record<string, unknown> = {
    notesSeen: 0,
    notesFetched: 0,
    capturesCreated: 0,
    rateLimited: false,
  };

  try {
    const token = await requireConnectorCredential(
      "GRANOLA_API_KEY",
      "Granola",
      "granola",
      config,
    );
    let nextPageCursor = cursor.cursor ?? undefined;
    let maxUpdatedAt = updatedAfter;

    for (let page = 0; page < pagesPerSync; page += 1) {
      const list = await granolaApi<GranolaListResponse>(token, "/notes", {
        page_size: pageSize,
        cursor: nextPageCursor,
        updated_after: nextPageCursor ? undefined : updatedAfter,
      });
      const notes = list.notes ?? [];
      stats.notesSeen = Number(stats.notesSeen) + notes.length;

      for (const listed of notes) {
        if (!listed.id) continue;
        const note = await granolaApi<GranolaNote>(
          token,
          `/notes/${encodeURIComponent(listed.id)}`,
          { include: "transcript" },
        );
        stats.notesFetched = Number(stats.notesFetched) + 1;
        const normalized = normalizeGranolaNote({
          ...listed,
          ...note,
        });
        const capture = await createCapture({
          sourceId: source.id,
          externalId: normalized.externalId,
          title: normalized.title,
          kind: "transcript",
          content: normalized.content,
          capturedAt: normalized.capturedAt,
          metadata: {
            ...normalized.metadata,
            connector: "granola",
            syncRunId: runId,
          },
        });
        captures.push(serializeCapture(capture));

        const candidateUpdatedAt = note.updated_at ?? listed.updated_at;
        if (
          candidateUpdatedAt &&
          (!maxUpdatedAt ||
            Date.parse(candidateUpdatedAt) > Date.parse(maxUpdatedAt))
        ) {
          maxUpdatedAt = candidateUpdatedAt;
        }
      }

      const hasMore = list.hasMore ?? list.has_more ?? false;
      nextPageCursor = list.cursor ?? undefined;
      if (!hasMore || !nextPageCursor) {
        nextPageCursor = undefined;
        break;
      }
    }

    const nextCursor: GranolaSyncCursor = {
      cursor: nextPageCursor ?? null,
      updatedAfter: nextPageCursor
        ? updatedAfter
        : (maxUpdatedAt ?? new Date().toISOString()),
      retry: undefined,
      lastRunAt: nowIso(),
    };

    stats.capturesCreated = captures.length;
    await finishRun(runId, "success", stats);
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(nextCursor),
        lastSyncedAt: nowIso(),
        lastError: null,
        status: "active",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "granola",
      status: "success",
      capturesCreated: captures.length,
      captures,
      stats,
      message: captures.length
        ? `Imported ${captures.length} Granola notes`
        : "Granola sync completed with no new notes",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = err instanceof ConnectorRateLimitError;
    const nextCursor: GranolaSyncCursor = {
      ...cursor,
      retry: isRateLimit ? retryCursor(err, "granola") : cursor.retry,
      lastRunAt: nowIso(),
    };
    stats.capturesCreated = captures.length;
    stats.rateLimited = isRateLimit;
    await finishRun(
      runId,
      isRateLimit ? "success" : "error",
      stats,
      isRateLimit ? null : message,
    );
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(nextCursor),
        lastError: message,
        status: isRateLimit ? "active" : "error",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "granola",
      status: isRateLimit ? "success" : "error",
      capturesCreated: captures.length,
      captures,
      stats,
      message,
    };
  }
}

async function syncGitHub(source: SourceRow): Promise<ConnectorSyncResult> {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  if (isFixtureConfig(config) || transcriptItems(config).length > 0) {
    return syncFromConfiguredItems(
      source,
      "GitHub fixture source has no configured captures.",
    );
  }

  const runId = await createRun(source);
  const db = getDb();
  const cursor = parseJson<GitHubSyncCursor>(source.cursorJson, {});
  const nextCursor: GitHubSyncCursor = {
    ...cursor,
    repositories: { ...(cursor.repositories ?? {}) },
    retry: undefined,
    lastRunAt: nowIso(),
  };
  const repositories = githubReposFromConfig(config);
  const state = githubStateFromConfig(config);
  const limit = configuredNumber(config, ["limit", "pageSize", "perPage"], 25, {
    min: 1,
    max: 50,
    nestedKey: "github",
  });
  const detailLimit = configuredNumber(
    config,
    ["detailLimit", "repoDetailLimit", "maxContextItems"],
    0,
    { min: 0, max: 20, nestedKey: "github" },
  );
  const linkedDetailLimit = configuredNumber(
    config,
    ["linkedDetailLimit", "contextLimit", "maxLinkedContextItems"],
    10,
    { min: 0, max: 20, nestedKey: "github" },
  );
  const commentLimit = configuredNumber(
    config,
    ["commentLimit", "commentsPerItem"],
    5,
    { min: 0, max: 25, nestedKey: "github" },
  );
  const reviewLimit = configuredNumber(
    config,
    ["reviewLimit", "reviewsPerPullRequest"],
    5,
    { min: 0, max: 25, nestedKey: "github" },
  );
  const linkedCaptureLimit = configuredNumber(
    config,
    ["linkedCaptureLimit", "slackCaptureLimit"],
    100,
    { min: 1, max: 500, nestedKey: "github" },
  );
  const linkedRefLimit = configuredNumber(
    config,
    ["linkedRefLimit", "maxLinkedRefs"],
    20,
    { min: 1, max: 100, nestedKey: "github" },
  );
  const maxRepositories = configuredNumber(
    config,
    ["maxRepositories", "repoLimit"],
    5,
    { min: 1, max: 10, nestedKey: "github" },
  );
  const includeIssues = configuredBoolean(
    config,
    ["includeIssues"],
    true,
    "github",
  );
  const includePullRequests = configuredBoolean(
    config,
    ["includePullRequests", "includePRs"],
    true,
    "github",
  );

  const captures: any[] = [];
  const stats: Record<string, unknown> = {
    configuredRepositories: repositories.length,
    scannedRepositories: 0,
    itemsSeen: 0,
    issuesSeen: 0,
    pullRequestsSeen: 0,
    linkedSourceIds: 0,
    linkedSourcesSkipped: 0,
    linkedCapturesScanned: 0,
    linkedRefsFound: 0,
    linkedRefsImported: 0,
    detailsFetched: 0,
    commentsFetched: 0,
    reviewsFetched: 0,
    capturesCreated: 0,
    state,
    includeIssues,
    includePullRequests,
    rateLimited: false,
  };

  try {
    const token = await requireConnectorCredential(
      "GITHUB_TOKEN",
      "GitHub",
      "github",
      config,
    );
    const linkedRefs = await githubRefsFromLinkedSources(config, {
      captureLimit: linkedCaptureLimit,
      refLimit: linkedRefLimit,
      stats,
    });

    if (!repositories.length && !linkedRefs.length) {
      throw new Error(
        "GitHub source must configure repositories/repos or linkedSlackSourceIds with Slack captures that contain GitHub issue or PR links",
      );
    }
    if (!includeIssues && !includePullRequests) {
      await finishRun(runId, "success", stats);
      await db
        .update(schema.brainSources)
        .set({
          cursorJson: stableJson(nextCursor),
          lastSyncedAt: nowIso(),
          lastError: null,
          status: "active",
          updatedAt: nowIso(),
        })
        .where(
          and(
            accessFilter(schema.brainSources, schema.brainSourceShares),
            eq(schema.brainSources.id, source.id),
          ),
        );
      return {
        runId,
        sourceId: source.id,
        provider: "github",
        status: "success",
        capturesCreated: 0,
        captures,
        stats,
        message:
          "GitHub sync skipped because includeIssues and includePullRequests are both false",
      };
    }

    const importedExternalIds = new Set<string>();
    let linkedDetailBudget = linkedDetailLimit;
    let detailBudget = detailLimit;

    for (const ref of linkedRefs) {
      const item = await githubApi<GitHubIssueOrPull>(
        token,
        `/repos/${ref.repo}/issues/${ref.number}`,
      );
      const isPullRequest = Boolean(item.pull_request);
      if (isPullRequest) {
        stats.pullRequestsSeen = Number(stats.pullRequestsSeen) + 1;
        if (!includePullRequests) continue;
      } else {
        stats.issuesSeen = Number(stats.issuesSeen) + 1;
        if (!includeIssues) continue;
      }

      let context: GitHubContext = { comments: [], reviews: [] };
      if (linkedDetailBudget > 0) {
        context = await fetchGitHubContext(token, ref.repo, item, {
          commentLimit,
          reviewLimit,
        });
        linkedDetailBudget -= 1;
        stats.detailsFetched = Number(stats.detailsFetched) + 1;
        stats.commentsFetched =
          Number(stats.commentsFetched) + context.comments.length;
        stats.reviewsFetched =
          Number(stats.reviewsFetched) + context.reviews.length;
      }

      const normalized = normalizeGitHubIssue(
        ref.repo,
        item,
        context,
        ref.linkedFrom,
      );
      importedExternalIds.add(normalized.externalId);
      const capture = await createCapture({
        sourceId: source.id,
        externalId: normalized.externalId,
        title: normalized.title,
        kind: normalized.kind,
        content: normalized.content,
        capturedAt: normalized.capturedAt,
        metadata: {
          ...normalized.metadata,
          syncRunId: runId,
        },
      });
      captures.push(serializeCapture(capture));
      stats.itemsSeen = Number(stats.itemsSeen) + 1;
      stats.linkedRefsImported = Number(stats.linkedRefsImported) + 1;
    }

    for (const repo of repositories.slice(0, maxRepositories)) {
      stats.scannedRepositories = Number(stats.scannedRepositories) + 1;
      const repoCursor = nextCursor.repositories?.[repo] ?? {};
      const items = await githubApi<GitHubIssueOrPull[]>(
        token,
        `/repos/${repo}/issues`,
        {
          state,
          sort: "updated",
          direction: "desc",
          per_page: limit,
          since: repoCursor.updatedAfter,
        },
      );
      stats.itemsSeen = Number(stats.itemsSeen) + items.length;

      let maxUpdatedAt = repoCursor.updatedAfter;
      for (const item of items) {
        const isPullRequest = Boolean(item.pull_request);
        if (isPullRequest) {
          stats.pullRequestsSeen = Number(stats.pullRequestsSeen) + 1;
          if (!includePullRequests) continue;
        } else {
          stats.issuesSeen = Number(stats.issuesSeen) + 1;
          if (!includeIssues) continue;
        }
        const externalId = `github:${repo}:${isPullRequest ? "pull" : "issue"}:${item.number ?? item.id ?? "unknown"}`;
        if (importedExternalIds.has(externalId)) continue;

        let context: GitHubContext = { comments: [], reviews: [] };
        if (detailBudget > 0) {
          context = await fetchGitHubContext(token, repo, item, {
            commentLimit,
            reviewLimit,
          });
          detailBudget -= 1;
          stats.detailsFetched = Number(stats.detailsFetched) + 1;
          stats.commentsFetched =
            Number(stats.commentsFetched) + context.comments.length;
          stats.reviewsFetched =
            Number(stats.reviewsFetched) + context.reviews.length;
        }

        const normalized = normalizeGitHubIssue(repo, item, context);
        importedExternalIds.add(normalized.externalId);
        const capture = await createCapture({
          sourceId: source.id,
          externalId: normalized.externalId,
          title: normalized.title,
          kind: normalized.kind,
          content: normalized.content,
          capturedAt: normalized.capturedAt,
          metadata: {
            ...normalized.metadata,
            syncRunId: runId,
          },
        });
        captures.push(serializeCapture(capture));

        const candidateUpdatedAt = item.updated_at;
        if (
          candidateUpdatedAt &&
          (!maxUpdatedAt ||
            Date.parse(candidateUpdatedAt) > Date.parse(maxUpdatedAt))
        ) {
          maxUpdatedAt = candidateUpdatedAt;
        }
      }
      nextCursor.repositories![repo] = {
        updatedAfter: maxUpdatedAt ?? nowIso(),
      };
    }

    stats.capturesCreated = captures.length;
    await finishRun(runId, "success", stats);
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(nextCursor),
        lastSyncedAt: nowIso(),
        lastError: null,
        status: "active",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "github",
      status: "success",
      capturesCreated: captures.length,
      captures,
      stats,
      message: captures.length
        ? `Imported ${captures.length} GitHub issues and pull requests`
        : "GitHub sync completed with no new issues or pull requests",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = err instanceof ConnectorRateLimitError;
    const failedCursor: GitHubSyncCursor = {
      ...cursor,
      ...nextCursor,
      retry: isRateLimit ? retryCursor(err, "github") : cursor.retry,
      lastRunAt: nowIso(),
    };
    stats.capturesCreated = captures.length;
    stats.rateLimited = isRateLimit;
    await finishRun(
      runId,
      isRateLimit ? "success" : "error",
      stats,
      isRateLimit ? null : message,
    );
    await db
      .update(schema.brainSources)
      .set({
        cursorJson: stableJson(failedCursor),
        lastError: message,
        status: isRateLimit ? "active" : "error",
        updatedAt: nowIso(),
      })
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          eq(schema.brainSources.id, source.id),
        ),
      );
    return {
      runId,
      sourceId: source.id,
      provider: "github",
      status: isRateLimit ? "success" : "error",
      capturesCreated: captures.length,
      captures,
      stats,
      message,
    };
  }
}

const manualConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Manual sources do not have a remote sync. Use import-capture or import-transcript.",
    ),
};

const slackConnector: Connector = {
  sync: syncSlack,
};

const granolaConnector: Connector = {
  sync: syncGranola,
};

const githubConnector: Connector = {
  sync: syncGitHub,
};

const clipsConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Clips connector configured. Export from Clips or add transcript payloads to source config.",
    ),
};

const connectors: Record<BrainSourceProvider, Connector> = {
  manual: manualConnector,
  generic: manualConnector,
  clips: clipsConnector,
  slack: slackConnector,
  granola: granolaConnector,
  github: githubConnector,
};

export async function runConnectorSync(source: SourceRow) {
  await assertAccess("brain-source", source.id, "editor");
  return connectors[source.provider as BrainSourceProvider].sync(source);
}
