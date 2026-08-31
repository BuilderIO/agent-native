import { defineClientAction } from "@agent-native/core/client/host";
import { createAgentNativeWebMcpRegistration } from "@agent-native/core/client/webmcp";
import { useEffect } from "react";

import {
  AGENT_CONTEXT_ENDPOINT,
  AGENT_FRAME_ENDPOINT,
  AGENT_TRANSCRIPT_ENDPOINT,
  CLIPS_WEBMCP_TOOL_DEFINITIONS,
  CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS,
  CLIPS_WEBMCP_TOOL_NAMES,
  formatAgentTimestamp,
  nextAgentTranscriptStartMs,
  safeMs,
} from "../../../shared/agent-context";

const MAX_SEGMENT_TEXT_CHARS = 4000;
const MAX_WEBMCP_TRANSCRIPT_RESULT_CHARS = 48_000;
const MAX_WEBMCP_FIELD_CHARS = 2000;
const MAX_WEBMCP_URL_CHARS = 4096;

type ClipAgentWebMcpOptions = {
  recordingId: string;
  agentContextUrl: string | null;
  recordingStatus?: string | null;
  frameAvailable?: boolean;
};

type AgentApiPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): AgentApiPayload {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function optionalRecord(value: unknown): AgentApiPayload | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedString(
  value: unknown,
  max = MAX_WEBMCP_FIELD_CHARS,
): string | null {
  const string = stringValue(value);
  return string === null ? null : string.slice(0, max);
}

function buildRelatedAgentUrl(
  contextUrl: string,
  endpoint: string,
  params: Record<string, string> = {},
): string {
  let url: URL;
  try {
    url = new URL(contextUrl, window.location.href);
  } catch {
    throw new Error("Clip agent context URL is invalid");
  }

  if (url.origin !== window.location.origin) {
    throw new Error("Clip agent APIs must use the current page origin");
  }
  if (!url.pathname.endsWith(AGENT_CONTEXT_ENDPOINT)) {
    throw new Error("Clip agent context URL has an unexpected path");
  }

  url.pathname = `${url.pathname.slice(0, -AGENT_CONTEXT_ENDPOINT.length)}${endpoint}`;
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

async function fetchAgentJson(
  url: string,
  signal?: AbortSignal,
): Promise<AgentApiPayload> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Clip agent request failed: HTTP ${response.status}`);
    }
    throw new Error("Clip agent response was not valid JSON");
  }
  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(`Clip agent request failed: ${detail}`);
  }
  return requiredRecord(payload, "Clip agent response");
}

function compactClip(value: unknown): Record<string, unknown> | null {
  const clip = optionalRecord(value);
  if (!clip) return null;
  const readiness = optionalRecord(clip.agentReadiness);
  return {
    id: boundedString(clip.id, 256),
    title: boundedString(clip.title),
    sourceProvider: boundedString(clip.sourceProvider, 64),
    publicPageUrl: boundedString(clip.publicPageUrl, MAX_WEBMCP_URL_CHARS),
    durationMs: numberValue(clip.durationMs),
    status: boundedString(clip.status, 64),
    agentReadiness: readiness
      ? {
          state: boundedString(readiness.state, 64),
          retryAfterSeconds: numberValue(readiness.retryAfterSeconds),
          instruction: boundedString(readiness.instruction),
        }
      : null,
  };
}

function compactApis(
  payload: AgentApiPayload,
  contextUrl: string,
  transcriptUrl: string,
) {
  const apis = optionalRecord(payload.apis);
  const result: Record<string, unknown> = {
    context: { method: "GET", url: contextUrl },
    transcript: { method: "GET", url: transcriptUrl },
  };
  const frame = optionalRecord(apis?.frame);
  if (frame) {
    const query = optionalRecord(frame.query);
    result.frame = {
      method: boundedString(frame.method, 16) ?? "GET",
      urlTemplate: boundedString(frame.urlTemplate, MAX_WEBMCP_URL_CHARS),
      ...(query
        ? {
            query: Object.fromEntries(
              Object.entries(query)
                .slice(0, 8)
                .map(([key, value]) => [key, boundedString(value)]),
            ),
          }
        : {}),
    };
  }
  return result;
}

function compactRecommendedFrames(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((frame) => {
    const item = optionalRecord(frame);
    if (!item) return [];
    return [
      {
        atMs: numberValue(item.atMs),
        timestamp: boundedString(item.timestamp, 64),
        reason: boundedString(item.reason),
        ...(boundedString(item.url, MAX_WEBMCP_URL_CHARS)
          ? { url: boundedString(item.url, MAX_WEBMCP_URL_CHARS) }
          : {}),
      },
    ];
  });
}

function compactInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (instruction): instruction is string => typeof instruction === "string",
    )
    .slice(0, 10)
    .map((instruction) => instruction.slice(0, MAX_WEBMCP_FIELD_CHARS));
}

function ensureTranscriptResultFits<T extends Record<string, unknown>>(
  result: T,
  recordingId: string,
): T {
  if (JSON.stringify(result).length <= MAX_WEBMCP_TRANSCRIPT_RESULT_CHARS) {
    return result;
  }

  return {
    type: boundedString(result.type, 128) ?? "agent-native.clip.transcript",
    sourceUrl: boundedString(result.sourceUrl, MAX_WEBMCP_URL_CHARS),
    recordingId: recordingId.slice(0, 256),
    transcript: {
      status: boundedString(optionalRecord(result.transcript)?.status, 64),
      language: boundedString(optionalRecord(result.transcript)?.language, 64),
      returnedSegmentCount: 0,
      truncated: true,
      fullTextIncluded: false,
      fullTextOmittedReason:
        "WebMCP transcript result was bounded; use sourceUrl for the fallback transcript.",
    },
    segments: [],
  } as unknown as T;
}

function parseTranscriptInput(input: unknown): {
  startMs?: number;
  endMs?: number;
  startIndex?: number;
  maxSegments: number;
} {
  const value = requiredRecord(input, "Transcript input");
  for (const key of Object.keys(value)) {
    if (!["startMs", "endMs", "startIndex", "maxSegments"].includes(key)) {
      throw new Error(`Transcript input has an unexpected field: ${key}`);
    }
  }

  const readNumber = (key: "startMs" | "endMs") => {
    const raw = value[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      throw new Error(`Transcript input ${key} must be a non-negative number`);
    }
    return safeMs(raw);
  };
  const startMs = readNumber("startMs");
  const endMs = readNumber("endMs");
  const rawStartIndex = value.startIndex;
  if (
    rawStartIndex !== undefined &&
    (typeof rawStartIndex !== "number" ||
      !Number.isSafeInteger(rawStartIndex) ||
      rawStartIndex < 0)
  ) {
    throw new Error(
      "Transcript input startIndex must be a non-negative integer",
    );
  }
  const startIndex = rawStartIndex as number | undefined;
  if (startMs !== undefined && endMs !== undefined && endMs < startMs) {
    throw new Error("Transcript input endMs must be greater than startMs");
  }

  const rawMaxSegments = value.maxSegments;
  if (
    rawMaxSegments !== undefined &&
    (typeof rawMaxSegments !== "number" ||
      !Number.isInteger(rawMaxSegments) ||
      rawMaxSegments < 1 ||
      rawMaxSegments > CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS)
  ) {
    throw new Error(
      `Transcript input maxSegments must be an integer from 1 to ${CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS}`,
    );
  }

  return {
    ...(startMs !== undefined ? { startMs } : {}),
    ...(endMs !== undefined ? { endMs } : {}),
    ...(startIndex !== undefined ? { startIndex } : {}),
    maxSegments: rawMaxSegments ?? CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS,
  };
}

function parseFrameInput(input: unknown): number {
  const value = requiredRecord(input, "Frame input");
  if (Object.keys(value).some((key) => key !== "atMs")) {
    throw new Error("Frame input has an unexpected field");
  }
  if (
    typeof value.atMs !== "number" ||
    !Number.isFinite(value.atMs) ||
    value.atMs < 0
  ) {
    throw new Error("Frame input atMs must be a non-negative number");
  }
  return safeMs(value.atMs);
}

function transcriptSegment(value: unknown, index: number) {
  const segment = requiredRecord(value, `Transcript segment ${index}`);
  const startMs = numberValue(segment.startMs);
  const endMs = numberValue(segment.endMs);
  const text = stringValue(segment.text);
  if (startMs === null || endMs === null || text === null) {
    throw new Error(`Transcript segment ${index} is invalid`);
  }
  const normalizedStartMs = safeMs(startMs);
  const normalizedEndMs = Math.max(normalizedStartMs, safeMs(endMs));
  const boundedText = text.slice(0, MAX_SEGMENT_TEXT_CHARS);
  const segmentIndex = numberValue(segment.segmentIndex);
  return {
    startMs: normalizedStartMs,
    endMs: normalizedEndMs,
    timestamp: formatAgentTimestamp(normalizedStartMs),
    range: `${formatAgentTimestamp(normalizedStartMs)}-${formatAgentTimestamp(normalizedEndMs)}`,
    text: boundedText,
    ...(boundedText.length < text.length ? { textTruncated: true } : {}),
    ...(segmentIndex !== null &&
    Number.isSafeInteger(segmentIndex) &&
    segmentIndex >= 0
      ? { segmentIndex }
      : {}),
    ...(segment.source === "mic" || segment.source === "system"
      ? { source: segment.source }
      : {}),
  };
}

function clipToolDefinition(name: string) {
  const definition = CLIPS_WEBMCP_TOOL_DEFINITIONS.find(
    (candidate) => candidate.name === name,
  );
  if (!definition) throw new Error(`Missing Clips WebMCP definition: ${name}`);
  return definition;
}

export function createClipAgentWebMcpActions({
  recordingId,
  agentContextUrl,
  recordingStatus,
  frameAvailable = true,
}: ClipAgentWebMcpOptions) {
  const contextDefinition = clipToolDefinition(CLIPS_WEBMCP_TOOL_NAMES.context);
  const transcriptDefinition = clipToolDefinition(
    CLIPS_WEBMCP_TOOL_NAMES.transcript,
  );
  const frameDefinition = clipToolDefinition(CLIPS_WEBMCP_TOOL_NAMES.frame);
  const contextAction = defineClientAction({
    name: contextDefinition.name,
    title: contextDefinition.title,
    description: contextDefinition.description,
    schema: contextDefinition.inputSchema,
    readOnly: true,
    untrustedContentHint: true,
    run: async (_input, runtime) => {
      if (!agentContextUrl)
        throw new Error("Clip agent context is unavailable");
      const payload = await fetchAgentJson(agentContextUrl, runtime.signal);
      const transcriptUrl = buildRelatedAgentUrl(
        agentContextUrl,
        AGENT_TRANSCRIPT_ENDPOINT,
      );
      const transcript = optionalRecord(payload.transcript);
      const recommendedFrames = compactRecommendedFrames(
        payload.recommendedFrames,
      );
      return {
        type: stringValue(payload.type) ?? "agent-native.clip.context",
        sourceUrl: agentContextUrl,
        clip: compactClip(payload.clip),
        apis: compactApis(payload, agentContextUrl, transcriptUrl),
        transcript: {
          status: stringValue(transcript?.status) ?? "missing",
          language: stringValue(transcript?.language),
          segmentCount: numberValue(transcript?.segmentCount) ?? 0,
        },
        recommendedFrames,
        instructions: compactInstructions(payload.instructions),
      };
    },
  });

  const transcriptAction = defineClientAction({
    name: transcriptDefinition.name,
    title: transcriptDefinition.title,
    description: transcriptDefinition.description,
    schema: transcriptDefinition.inputSchema,
    readOnly: true,
    untrustedContentHint: true,
    run: async (input, runtime) => {
      if (!agentContextUrl)
        throw new Error("Clip agent context is unavailable");
      const { startMs, endMs, startIndex, maxSegments } =
        parseTranscriptInput(input);
      const transcriptUrl = buildRelatedAgentUrl(
        agentContextUrl,
        AGENT_TRANSCRIPT_ENDPOINT,
        {
          maxSegments: String(maxSegments),
          ...(startMs !== undefined ? { startMs: String(startMs) } : {}),
          ...(endMs !== undefined ? { endMs: String(endMs) } : {}),
          ...(startIndex !== undefined
            ? { startIndex: String(startIndex) }
            : {}),
        },
      );
      const payload = await fetchAgentJson(transcriptUrl, runtime.signal);
      const transcript = requiredRecord(
        payload.transcript,
        "Clip transcript response",
      );
      if (!Array.isArray(transcript.segments)) {
        throw new Error("Clip transcript segments are invalid");
      }
      const segments = transcript.segments.map(transcriptSegment);
      const matchingSegments = segments.filter(
        (segment) =>
          (startMs === undefined || segment.endMs >= startMs) &&
          (endMs === undefined || segment.startMs <= endMs),
      );
      const serverTruncated = transcript.truncated === true;
      const serverNextStartIndex = numberValue(transcript.nextStartIndex);
      const serverNextStartMs = numberValue(transcript.nextStartMs);
      const candidates = matchingSegments.slice(0, maxSegments);
      const baseResult = {
        type: stringValue(payload.type) ?? "agent-native.clip.transcript",
        recording: compactClip(payload.recording),
        sourceUrl: transcriptUrl,
        apis: compactApis(payload, agentContextUrl, transcriptUrl),
        transcript: {
          status: stringValue(transcript.status) ?? "missing",
          language: stringValue(transcript.language),
          failureReason: stringValue(transcript.failureReason),
          segmentCount: numberValue(transcript.segmentCount) ?? segments.length,
          returnedSegmentCount: 0,
          truncated:
            serverTruncated || candidates.length < matchingSegments.length,
          fullTextIncluded: false,
          fullTextOmittedReason:
            "WebMCP returns bounded timestamped segments; use the fallback transcript URL for fullText.",
        },
        segments: [] as typeof candidates,
        instructions: compactInstructions(payload.instructions),
        recordingId,
      };
      const boundedBaseResult = ensureTranscriptResultFits(
        baseResult,
        recordingId,
      );
      const baseWasBounded = boundedBaseResult !== baseResult;

      let returnedSegments: typeof candidates = [];
      for (const segment of candidates) {
        const nextSegments = [...returnedSegments, segment];
        const truncated =
          baseWasBounded ||
          serverTruncated ||
          nextSegments.length < matchingSegments.length;
        const lastSegment = nextSegments[nextSegments.length - 1];
        const segmentIndex = numberValue(lastSegment?.segmentIndex);
        const nextStartIndex =
          segmentIndex !== null &&
          Number.isSafeInteger(segmentIndex) &&
          segmentIndex >= 0
            ? Math.min(Number.MAX_SAFE_INTEGER, segmentIndex + 1)
            : serverNextStartIndex;
        const candidateResult = {
          ...boundedBaseResult,
          transcript: {
            ...boundedBaseResult.transcript,
            returnedSegmentCount: nextSegments.length,
            truncated,
          },
          segments: nextSegments,
          ...(truncated
            ? {
                ...(nextStartIndex !== null ? { nextStartIndex } : {}),
                nextStartMs: nextAgentTranscriptStartMs(
                  lastSegment?.endMs ?? 0,
                ),
              }
            : {}),
        };
        if (
          JSON.stringify(candidateResult).length >
          MAX_WEBMCP_TRANSCRIPT_RESULT_CHARS
        ) {
          break;
        }
        returnedSegments = nextSegments;
      }

      const truncated =
        baseWasBounded ||
        serverTruncated ||
        returnedSegments.length < matchingSegments.length;
      const lastReturnedSegment = returnedSegments[returnedSegments.length - 1];
      const returnedSegmentIndex = numberValue(
        lastReturnedSegment?.segmentIndex,
      );
      const nextStartIndex =
        returnedSegmentIndex !== null &&
        Number.isSafeInteger(returnedSegmentIndex) &&
        returnedSegmentIndex >= 0
          ? Math.min(Number.MAX_SAFE_INTEGER, returnedSegmentIndex + 1)
          : returnedSegments.length === candidates.length
            ? serverNextStartIndex
            : null;
      return {
        ...boundedBaseResult,
        transcript: {
          ...boundedBaseResult.transcript,
          returnedSegmentCount: returnedSegments.length,
          truncated,
        },
        segments: returnedSegments,
        ...(truncated && returnedSegments.length > 0
          ? {
              ...(nextStartIndex !== null ? { nextStartIndex } : {}),
              nextStartMs:
                returnedSegments.length === candidates.length &&
                serverNextStartMs !== null
                  ? serverNextStartMs
                  : nextAgentTranscriptStartMs(lastReturnedSegment?.endMs ?? 0),
            }
          : {}),
      };
    },
  });

  const frameAction = defineClientAction({
    name: frameDefinition.name,
    title: frameDefinition.title,
    description: frameDefinition.description,
    schema: frameDefinition.inputSchema,
    readOnly: true,
    untrustedContentHint: true,
    run: async (input, runtime) => {
      if (!agentContextUrl)
        throw new Error("Clip agent context is unavailable");
      const requestedMs = parseFrameInput(input);
      const payload = await fetchAgentJson(agentContextUrl, runtime.signal);
      const apis = optionalRecord(payload.apis);
      if (!apis?.frame) {
        const clip = optionalRecord(payload.clip);
        const status = stringValue(clip?.status);
        if (status === "uploading" || status === "processing") {
          throw new Error("Clip is not ready for frame extraction yet");
        }
        throw new Error(
          "Frame extraction is not available for this clip. Use the transcript instead.",
        );
      }

      const atMs = requestedMs;
      const imageUrl = buildRelatedAgentUrl(
        agentContextUrl,
        AGENT_FRAME_ENDPOINT,
        { atMs: String(atMs) },
      );
      return {
        type: "image",
        clipId: recordingId,
        atMs,
        timestamp: formatAgentTimestamp(atMs),
        imageUrl,
        mimeType: "image/jpeg",
        sourceUrl: imageUrl,
        instructions:
          "Fetch imageUrl as an image to SEE the recorded screen. The URL uses the same scoped access as this clip page.",
      };
    },
  });

  return [
    contextAction,
    transcriptAction,
    ...(recordingStatus === "ready" && frameAvailable ? [frameAction] : []),
  ];
}

export function useClipAgentWebMcp(options: ClipAgentWebMcpOptions): void {
  const { recordingId, agentContextUrl, recordingStatus, frameAvailable } =
    options;
  useEffect(() => {
    if (!recordingId || !agentContextUrl) return;
    const registration = createAgentNativeWebMcpRegistration({
      actions: createClipAgentWebMcpActions({
        recordingId,
        agentContextUrl,
        recordingStatus,
        frameAvailable,
      }),
    });
    void registration.start().catch(() => {
      // WebMCP is progressive enhancement; the URL APIs remain the fallback.
    });
    return () => registration.stop();
  }, [agentContextUrl, frameAvailable, recordingId, recordingStatus]);
}

export function ClipAgentWebMcp(props: ClipAgentWebMcpOptions) {
  useClipAgentWebMcp(props);
  return null;
}
