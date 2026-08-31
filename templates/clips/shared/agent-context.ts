import {
  AGENT_ACCESS_PARAM,
  buildAgentAccessApiUrl,
  scopedAgentAccessResourceId,
} from "@agent-native/core/shared";

import type { TranscriptSegment } from "./transcript-segments";

export const CLIP_AGENT_CONTEXT_VERSION = 2;
export const AGENT_CONTEXT_ENDPOINT = "/api/agent-context.json";
export const AGENT_TRANSCRIPT_ENDPOINT = "/api/agent-transcript.json";
export const AGENT_FRAME_ENDPOINT = "/api/agent-frame.jpg";
export const CLIP_AGENT_ACCESS_TOKEN_PREFIX = "clip-agent-context";
export const CLIPS_AGENT_ACCESS_PARAM = AGENT_ACCESS_PARAM || "agent_access";
export const CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS = 50;

export const CLIPS_WEBMCP_TOOL_NAMES = {
  context: "clips-get-context",
  transcript: "clips-get-transcript",
  frame: "clips-get-frame",
} as const;

export const CLIPS_WEBMCP_INPUT_SCHEMAS = {
  context: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  transcript: {
    type: "object",
    properties: {
      startMs: {
        type: "number",
        minimum: 0,
        description: "Only return segments that overlap this start time.",
      },
      endMs: {
        type: "number",
        minimum: 0,
        description: "Only return segments that overlap this end time.",
      },
      startIndex: {
        type: "integer",
        minimum: 0,
        description:
          "Stable segment index for pagination; prefer nextStartIndex from the previous page.",
      },
      maxSegments: {
        type: "integer",
        minimum: 1,
        maximum: CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS,
        description: "Maximum number of transcript segments to return.",
      },
    },
    additionalProperties: false,
  },
  frame: {
    type: "object",
    properties: {
      atMs: {
        type: "number",
        minimum: 0,
        description: "Video timestamp in milliseconds.",
      },
    },
    required: ["atMs"],
    additionalProperties: false,
  },
};

export const CLIPS_WEBMCP_TOOL_DEFINITIONS = [
  {
    name: CLIPS_WEBMCP_TOOL_NAMES.context,
    title: "Get clip context",
    description:
      "Read clip metadata, readiness, transcript status, and the existing fallback API URLs.",
    inputSchema: CLIPS_WEBMCP_INPUT_SCHEMAS.context,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: CLIPS_WEBMCP_TOOL_NAMES.transcript,
    title: "Get clip transcript",
    description:
      "Read timestamped transcript segments. Use nextStartIndex to page through long transcripts without losing overlapping segments.",
    inputSchema: CLIPS_WEBMCP_INPUT_SCHEMAS.transcript,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: CLIPS_WEBMCP_TOOL_NAMES.frame,
    title: "Get clip frame",
    description:
      "Get a JPEG image URL for the clip at a requested video timestamp.",
    inputSchema: CLIPS_WEBMCP_INPUT_SCHEMAS.frame,
    availability: "ready",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
];

export const CLIPS_WEBMCP_DISCOVERY = {
  protocol: "WebMCP",
  scope: "page-local",
  tools: CLIPS_WEBMCP_TOOL_DEFINITIONS,
  instructions:
    "If this clip page is open in a WebMCP-capable browser, list its page tools before using clips-get-context, clips-get-transcript, or clips-get-frame. Use nextStartIndex for transcript pagination so overlapping segments are not lost. If WebMCP is unavailable, use agentContextUrl and the existing apis.context, apis.transcript, and apis.frame URLs instead.",
};

export type AgentClipReadiness = {
  state: "preparing" | "ready" | "failed";
  retryAfterSeconds: number | null;
  instruction: string | null;
};

export function getAgentClipReadiness(
  status: string | null | undefined,
): AgentClipReadiness {
  if (status === "uploading") {
    return {
      state: "preparing",
      retryAfterSeconds: 15,
      instruction:
        "This clip is still uploading and is not ready to inspect. Wait 15 seconds, then fetch agentContextUrl again. Do not open the share page, request frames, or draw conclusions until clip.status is ready.",
    };
  }

  if (status === "processing") {
    return {
      state: "preparing",
      retryAfterSeconds: 15,
      instruction:
        "This clip is still processing and may still be transcoding or transcribing. Wait 15 seconds, then fetch agentContextUrl again. Do not open the share page, request frames, or draw conclusions until clip.status is ready.",
    };
  }

  return {
    state: status === "failed" ? "failed" : "ready",
    retryAfterSeconds: null,
    instruction: null,
  };
}

export function buildAgentDiscoveryPayload({
  recordingId,
  title,
  status,
  agentContextUrl,
}: {
  recordingId: string;
  title: string;
  status: string | null | undefined;
  agentContextUrl: string;
}) {
  const readiness = getAgentClipReadiness(status);
  return {
    type: "agent-native.clip.discovery",
    version: CLIP_AGENT_CONTEXT_VERSION,
    clipId: recordingId,
    title,
    recordingStatus: status ?? "unknown",
    agentReadiness: readiness,
    agentContextUrl,
    webmcp: CLIPS_WEBMCP_DISCOVERY,
    instructions:
      readiness.instruction ??
      "Fetch agentContextUrl for the transcript and JPEG frame URLs. If the page is open in a WebMCP-capable browser, list its page tools first and use them when available. Use nextStartIndex when paging transcript segments so overlapping segments are not lost. Fetch the frame URLs to SEE the screen, not just read the transcript.",
  };
}

export function agentAccessTokenResourceId(recordingId: string): string {
  if (typeof scopedAgentAccessResourceId !== "function") {
    return `${CLIP_AGENT_ACCESS_TOKEN_PREFIX}:${recordingId}`;
  }
  return scopedAgentAccessResourceId(
    CLIP_AGENT_ACCESS_TOKEN_PREFIX,
    recordingId,
  );
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
  return buildAgentAccessApiUrl({
    endpoint,
    resourceId: recordingId,
    origin,
    basePath,
    token,
    tokenParam: AGENT_ACCESS_PARAM,
    extraParams,
  });
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

export function nextAgentTranscriptStartMs(endMs: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, safeMs(endMs) + 1);
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
