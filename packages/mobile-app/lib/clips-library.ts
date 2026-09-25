import {
  callClipsAction,
  getClipsBaseUrl,
  normalizeClipsApiError,
} from "./clips-api";

export type ClipsLibraryView = "library" | "shared";
export type ClipVisibility = "private" | "org" | "public";
export type ClipRole = "owner" | "admin" | "editor" | "viewer";

export interface NativeClipSummary {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  durationMs: number;
  status: string;
  visibility: ClipVisibility;
  ownerEmail: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  hasAudio: boolean;
  hasCamera: boolean;
  transcriptStatus: string | null;
  transcriptHasText: boolean;
}

export interface NativeClipSearchResult extends NativeClipSummary {
  matchType: string;
  matchPanel: "transcript" | "comments" | null;
  matchMs: number | null;
  snippet: string | null;
}

export interface NativeClipComment {
  id: string;
  threadId: string;
  parentId: string | null;
  authorEmail: string | null;
  authorName: string | null;
  content: string;
  videoTimestampMs: number;
  emojiReactionsJson: string | null;
  createdAt: string;
}

export interface NativeClipReaction {
  id: string;
  emoji: string;
  videoTimestampMs: number;
  viewerName: string | null;
  createdAt: string;
}

export interface NativeClipDetail {
  role: ClipRole;
  recording: NativeClipSummary & {
    videoUrl: string | null;
    width: number | null;
    height: number | null;
    enableComments: boolean;
    enableReactions: boolean;
  };
  comments: NativeClipComment[];
  reactions: NativeClipReaction[];
}

export interface NativeClipShareInfo {
  role: ClipRole | null;
  visibility: ClipVisibility;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asVisibility(value: unknown): ClipVisibility {
  return value === "public" || value === "org" ? value : "private";
}

function asRole(value: unknown): ClipRole {
  return value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "viewer"
    ? value
    : "viewer";
}

function asIsoDate(value: unknown): string {
  const date = asString(value);
  return date && Number.isFinite(Date.parse(date))
    ? date
    : new Date(0).toISOString();
}

export function normalizeClipSummary(value: unknown): NativeClipSummary | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) return null;
  return {
    id,
    title: asString(record.title) ?? "Untitled clip",
    description: asString(record.description),
    thumbnailUrl: asString(record.thumbnailUrl),
    durationMs: Math.max(0, asNumber(record.durationMs)),
    status: asString(record.status) ?? "ready",
    visibility: asVisibility(record.visibility),
    ownerEmail: asString(record.ownerEmail),
    viewCount: Math.max(0, asNumber(record.viewCount)),
    createdAt: asIsoDate(record.createdAt),
    updatedAt: asIsoDate(record.updatedAt),
    hasAudio: asBoolean(record.hasAudio),
    hasCamera: asBoolean(record.hasCamera),
    transcriptStatus: asString(record.transcriptStatus),
    transcriptHasText: asBoolean(record.transcriptHasText),
  };
}

function normalizeComment(value: unknown): NativeClipComment | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const content = asString(record?.content);
  if (!record || !id || !content) return null;
  return {
    id,
    threadId: asString(record.threadId) ?? id,
    parentId: asString(record.parentId),
    authorEmail: asString(record.authorEmail),
    authorName: asString(record.authorName),
    content,
    videoTimestampMs: Math.max(0, asNumber(record.videoTimestampMs)),
    emojiReactionsJson: asString(record.emojiReactionsJson),
    createdAt: asIsoDate(record.createdAt),
  };
}

function normalizeReaction(value: unknown): NativeClipReaction | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const emoji = asString(record?.emoji);
  if (!record || !id || !emoji) return null;
  return {
    id,
    emoji,
    videoTimestampMs: Math.max(0, asNumber(record.videoTimestampMs)),
    viewerName: asString(record.viewerName),
    createdAt: asIsoDate(record.createdAt),
  };
}

export function parseClipsLibraryResponse(
  payload: unknown,
): NativeClipSummary[] {
  const recordings = asRecord(payload)?.recordings;
  if (!Array.isArray(recordings)) return [];
  return recordings.flatMap((item) => {
    const recording = normalizeClipSummary(item);
    return recording ? [recording] : [];
  });
}

export function parseClipsSearchResponse(
  payload: unknown,
): NativeClipSearchResult[] {
  const results = asRecord(payload)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    const record = asRecord(item);
    const summary = normalizeClipSummary(item);
    if (!record || !summary) return [];
    const matchPanel =
      record.matchPanel === "transcript" || record.matchPanel === "comments"
        ? record.matchPanel
        : null;
    return [
      {
        ...summary,
        matchType: asString(record.matchType) ?? "metadata",
        matchPanel,
        matchMs:
          typeof record.matchMs === "number" && Number.isFinite(record.matchMs)
            ? Math.max(0, record.matchMs)
            : null,
        snippet: asString(record.snippet),
      },
    ];
  });
}

export function parseClipPlayerResponse(
  payload: unknown,
): NativeClipDetail | null {
  const outer = asRecord(payload);
  const rawRecording = asRecord(outer?.recording);
  const summary = normalizeClipSummary(rawRecording);
  if (!outer || !rawRecording || !summary) return null;
  const comments = Array.isArray(outer.comments) ? outer.comments : [];
  const reactions = Array.isArray(outer.reactions) ? outer.reactions : [];
  return {
    role: asRole(outer.role),
    recording: {
      ...summary,
      videoUrl: asString(rawRecording.videoUrl),
      width: typeof rawRecording.width === "number" ? rawRecording.width : null,
      height:
        typeof rawRecording.height === "number" ? rawRecording.height : null,
      enableComments: asBoolean(rawRecording.enableComments),
      enableReactions: asBoolean(rawRecording.enableReactions),
    },
    comments: comments.flatMap((item) => {
      const comment = normalizeComment(item);
      return comment ? [comment] : [];
    }),
    reactions: reactions.flatMap((item) => {
      const reaction = normalizeReaction(item);
      return reaction ? [reaction] : [];
    }),
  };
}

export function parseCommentReactionCounts(
  value: string | null,
): Array<{ emoji: string; count: number }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const record = asRecord(parsed);
    if (!record) return [];
    return Object.entries(record).flatMap(([emoji, viewers]) =>
      emoji.trim() && Array.isArray(viewers) && viewers.length > 0
        ? [{ emoji, count: viewers.length }]
        : [],
    );
  } catch {
    return [];
  }
}

export function formatClipDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatClipDate(isoDate: string, nowMs = Date.now()): string {
  const value = Date.parse(isoDate);
  if (!Number.isFinite(value)) return "Unknown date";
  const elapsedDays = Math.floor(Math.max(0, nowMs - value) / 86_400_000);
  if (elapsedDays === 0) return "Today";
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 7) return `${elapsedDays} days ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(value).getFullYear() === new Date(nowMs).getFullYear()
        ? undefined
        : "numeric",
  }).format(new Date(value));
}

export function resolveTrustedClipsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const base = new URL(getClipsBaseUrl());
    const result = new URL(value, `${base.toString().replace(/\/+$/, "")}/`);
    return result.origin === base.origin &&
      (result.protocol === "https:" || result.protocol === "http:")
      ? result.toString()
      : null;
  } catch {
    return null;
  }
}

export function buildPrivacySafeClipShareUrl(recordingId: string): string {
  const url = new URL(getClipsBaseUrl());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/share/${encodeURIComponent(recordingId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildNativeClipSharePayload(
  recording: Pick<NativeClipSummary, "id" | "title">,
  visibility: ClipVisibility,
): { title: string; message: string; url: string } {
  const url = buildPrivacySafeClipShareUrl(recording.id);
  const accessCopy =
    visibility === "public"
      ? "Anyone with the link can view this clip."
      : "Only people who already have access can view this clip.";
  return {
    title: recording.title,
    message: `${recording.title}\n${accessCopy}`,
    url,
  };
}

export async function listNativeClips(
  view: ClipsLibraryView,
): Promise<NativeClipSummary[]> {
  const payload = await callClipsAction<unknown>(
    "list-recordings",
    {
      view,
      sort: "recent",
      limit: 100,
      offset: 0,
      includeMedia: false,
    },
    { method: "GET" },
  );
  return parseClipsLibraryResponse(payload);
}

export async function searchNativeClips(
  query: string,
): Promise<NativeClipSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const payload = await callClipsAction<unknown>(
    "search-recordings",
    { query: clean, limit: 50 },
    { method: "GET" },
  );
  return parseClipsSearchResponse(payload);
}

export async function getNativeClip(
  recordingId: string,
): Promise<NativeClipDetail> {
  const payload = await callClipsAction<unknown>(
    "get-recording-player-data",
    { recordingId },
    { method: "GET" },
  );
  const detail = parseClipPlayerResponse(payload);
  if (!detail) {
    throw normalizeClipsApiError(
      new Error("Clips returned incomplete player data."),
    );
  }
  return detail;
}

export async function getNativeClipShareInfo(
  recordingId: string,
): Promise<NativeClipShareInfo> {
  const payload = await callClipsAction<unknown>(
    "list-resource-shares",
    { resourceType: "recording", resourceId: recordingId },
    { method: "GET" },
  );
  const record = asRecord(payload);
  return {
    role: record?.role ? asRole(record.role) : null,
    visibility: asVisibility(record?.visibility),
  };
}

export async function addNativeClipComment(input: {
  recordingId: string;
  content: string;
  videoTimestampMs: number;
}): Promise<void> {
  await callClipsAction(
    "add-comment",
    {
      recordingId: input.recordingId,
      content: input.content.trim(),
      videoTimestampMs: Math.max(0, Math.round(input.videoTimestampMs)),
    },
    { idempotencyKey: `mobile-comment:${input.recordingId}:${Date.now()}` },
  );
}

export async function reactToNativeClip(input: {
  recordingId: string;
  emoji: string;
  videoTimestampMs: number;
}): Promise<void> {
  await callClipsAction("react-to-recording", {
    recordingId: input.recordingId,
    emoji: input.emoji,
    videoTimestampMs: Math.max(0, Math.round(input.videoTimestampMs)),
  });
}

export async function reactToNativeClipComment(input: {
  commentId: string;
  emoji: string;
}): Promise<void> {
  await callClipsAction("react-to-comment", input);
}
