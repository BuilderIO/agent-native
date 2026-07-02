import type { TranscriptSegment } from "./transcript-segments";

export const CLIP_AGENT_CONTEXT_VERSION = 1;
export const AGENT_CONTEXT_ENDPOINT = "/api/agent-context.json";
export const AGENT_TRANSCRIPT_ENDPOINT = "/api/agent-transcript.json";
export const AGENT_FRAME_ENDPOINT = "/api/agent-frame.jpg";
export const CLIP_AGENT_ACCESS_TOKEN_PREFIX = "clip-agent-context";

export function agentAccessTokenResourceId(recordingId: string): string {
  return `${CLIP_AGENT_ACCESS_TOKEN_PREFIX}:${recordingId}`;
}

export interface AgentApiUrls {
  contextUrl: string;
  transcriptUrl: string;
  frameUrlTemplate: string;
  frameUrl: (atMs: number) => string;
}

export interface AgentTranscriptSegment {
  startMs: number;
  endMs: number;
  timestamp: string;
  range: string;
  text: string;
  source?: "mic" | "system";
}

export interface AgentFrameSuggestion {
  atMs: number;
  timestamp: string;
  reason: string;
}

export interface ChapterLike {
  startMs: number;
  title: string;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeBasePath(basePath?: string): string {
  const trimmed = trimSlashes(basePath ?? "");
  return trimmed ? `/${trimmed}` : "";
}

function normalizeOrigin(origin?: string): string {
  if (!origin) return "";
  return origin.replace(/\/+$/g, "");
}

function endpointUrl({
  endpoint,
  recordingId,
  basePath,
  origin,
  token,
  extraParams,
}: {
  endpoint: string;
  recordingId: string;
  basePath?: string;
  origin?: string;
  token?: string | null;
  extraParams?: Array<[string, string]>;
}): string {
  const params = new URLSearchParams({ id: recordingId });
  if (token) params.set("t", token);
  for (const [key, value] of extraParams ?? []) {
    params.set(key, value);
  }
  return `${normalizeOrigin(origin)}${normalizeBasePath(basePath)}${endpoint}?${params.toString()}`;
}

export function buildAgentApiUrls(
  recordingId: string,
  options: { basePath?: string; origin?: string; token?: string | null } = {},
): AgentApiUrls {
  const contextUrl = endpointUrl({
    endpoint: AGENT_CONTEXT_ENDPOINT,
    recordingId,
    ...options,
  });
  const transcriptUrl = endpointUrl({
    endpoint: AGENT_TRANSCRIPT_ENDPOINT,
    recordingId,
    ...options,
  });
  const frameBase = endpointUrl({
    endpoint: AGENT_FRAME_ENDPOINT,
    recordingId,
    ...options,
  });

  return {
    contextUrl,
    transcriptUrl,
    frameUrlTemplate: `${frameBase}&atMs={timestampMs}`,
    frameUrl: (atMs: number) =>
      `${frameBase}&atMs=${encodeURIComponent(String(safeMs(atMs)))}`,
  };
}

export function safeMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function formatAgentTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(safeMs(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function toAgentTranscriptSegments(
  segments: TranscriptSegment[],
): AgentTranscriptSegment[] {
  return segments.map((segment) => {
    const startMs = safeMs(segment.startMs);
    const endMs = Math.max(startMs, safeMs(segment.endMs));
    const start = formatAgentTimestamp(startMs);
    const end = formatAgentTimestamp(endMs);
    return {
      startMs,
      endMs,
      timestamp: start,
      range: `${start}-${end}`,
      text: segment.text,
      ...(segment.source ? { source: segment.source } : {}),
    };
  });
}

function isNearExisting(
  frames: AgentFrameSuggestion[],
  atMs: number,
  minGapMs: number,
): boolean {
  return frames.some((frame) => Math.abs(frame.atMs - atMs) < minGapMs);
}

function addFrame(
  frames: AgentFrameSuggestion[],
  atMs: number,
  reason: string,
  minGapMs: number,
) {
  const normalized = safeMs(atMs);
  if (isNearExisting(frames, normalized, minGapMs)) return;
  frames.push({
    atMs: normalized,
    timestamp: formatAgentTimestamp(normalized),
    reason,
  });
}

export function buildRecommendedFrames({
  durationMs,
  chapters,
  segments,
  maxFrames = 10,
}: {
  durationMs?: number | null;
  chapters?: ChapterLike[] | null;
  segments?: TranscriptSegment[] | null;
  maxFrames?: number;
}): AgentFrameSuggestion[] {
  const frames: AgentFrameSuggestion[] = [];
  const duration = safeMs(durationMs ?? 0);
  const minGapMs = duration > 0 ? Math.max(3000, duration / 40) : 3000;

  addFrame(frames, 0, "opening frame", minGapMs);

  for (const chapter of chapters ?? []) {
    if (frames.length >= maxFrames) break;
    addFrame(
      frames,
      chapter.startMs,
      `chapter: ${chapter.title.slice(0, 80)}`,
      minGapMs,
    );
  }

  for (const segment of segments ?? []) {
    if (frames.length >= maxFrames) break;
    addFrame(
      frames,
      segment.startMs,
      `transcript: ${segment.text.slice(0, 80)}`,
      minGapMs,
    );
  }

  if (duration > 0) {
    for (const ratio of [0.25, 0.5, 0.75]) {
      if (frames.length >= maxFrames) break;
      addFrame(
        frames,
        duration * ratio,
        `${Math.round(ratio * 100)}% mark`,
        minGapMs,
      );
    }
  }

  return frames
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, Math.max(0, maxFrames));
}

export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}
