import { defineClientAction } from "@agent-native/core/client/host";
import { createAgentNativeWebMcpRegistration } from "@agent-native/core/client/webmcp";
import { useEffect } from "react";

import {
  AGENT_CONTEXT_ENDPOINT,
  AGENT_FRAME_ENDPOINT,
  AGENT_TRANSCRIPT_ENDPOINT,
  CLIPS_WEBMCP_TOOL_DEFINITIONS,
  CLIPS_WEBMCP_TOOL_NAMES,
  formatAgentTimestamp,
  safeMs,
} from "../../../shared/agent-context";

const MAX_TRANSCRIPT_SEGMENTS = 50;
const MAX_SEGMENT_TEXT_CHARS = 4000;
const MAX_FULL_TEXT_CHARS = 20_000;

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
  return {
    id: stringValue(clip.id),
    title: stringValue(clip.title),
    sourceProvider: stringValue(clip.sourceProvider),
    publicPageUrl: stringValue(clip.publicPageUrl),
    durationMs: numberValue(clip.durationMs),
    status: stringValue(clip.status),
    agentReadiness: clip.agentReadiness ?? null,
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
  if (apis?.frame) result.frame = apis.frame;
  return result;
}

function parseTranscriptInput(input: unknown): {
  startMs?: number;
  endMs?: number;
  maxSegments: number;
} {
  const value = requiredRecord(input, "Transcript input");
  for (const key of Object.keys(value)) {
    if (!["startMs", "endMs", "maxSegments"].includes(key)) {
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
  if (startMs !== undefined && endMs !== undefined && endMs < startMs) {
    throw new Error("Transcript input endMs must be greater than startMs");
  }

  const rawMaxSegments = value.maxSegments;
  if (
    rawMaxSegments !== undefined &&
    (typeof rawMaxSegments !== "number" ||
      !Number.isInteger(rawMaxSegments) ||
      rawMaxSegments < 1 ||
      rawMaxSegments > MAX_TRANSCRIPT_SEGMENTS)
  ) {
    throw new Error(
      `Transcript input maxSegments must be an integer from 1 to ${MAX_TRANSCRIPT_SEGMENTS}`,
    );
  }

  return {
    ...(startMs !== undefined ? { startMs } : {}),
    ...(endMs !== undefined ? { endMs } : {}),
    maxSegments: rawMaxSegments ?? MAX_TRANSCRIPT_SEGMENTS,
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
  return {
    startMs: normalizedStartMs,
    endMs: normalizedEndMs,
    timestamp: formatAgentTimestamp(normalizedStartMs),
    range: `${formatAgentTimestamp(normalizedStartMs)}-${formatAgentTimestamp(normalizedEndMs)}`,
    text: boundedText,
    ...(boundedText.length < text.length ? { textTruncated: true } : {}),
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
      const recommendedFrames = Array.isArray(payload.recommendedFrames)
        ? payload.recommendedFrames.slice(0, 10)
        : [];
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
        instructions: Array.isArray(payload.instructions)
          ? payload.instructions.slice(0, 10)
          : [],
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
      const { startMs, endMs, maxSegments } = parseTranscriptInput(input);
      const transcriptUrl = buildRelatedAgentUrl(
        agentContextUrl,
        AGENT_TRANSCRIPT_ENDPOINT,
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
      const returnedSegments = matchingSegments.slice(0, maxSegments);
      const truncated = matchingSegments.length > returnedSegments.length;
      const fullText = stringValue(transcript.fullText) ?? "";
      const fullTextIncluded =
        !truncated &&
        startMs === undefined &&
        endMs === undefined &&
        fullText.length <= MAX_FULL_TEXT_CHARS;
      return {
        type: stringValue(payload.type) ?? "agent-native.clip.transcript",
        recording: compactClip(payload.recording),
        sourceUrl: transcriptUrl,
        apis: compactApis(payload, agentContextUrl, transcriptUrl),
        transcript: {
          status: stringValue(transcript.status) ?? "missing",
          language: stringValue(transcript.language),
          failureReason: stringValue(transcript.failureReason),
          segmentCount: numberValue(transcript.segmentCount) ?? segments.length,
          returnedSegmentCount: returnedSegments.length,
          truncated,
          fullTextIncluded,
          ...(fullTextIncluded ? { fullText } : {}),
          ...(fullText.length > MAX_FULL_TEXT_CHARS
            ? {
                fullTextOmittedReason:
                  "fullText exceeds the WebMCP output limit",
              }
            : {}),
        },
        segments: returnedSegments,
        ...(truncated
          ? {
              nextStartMs:
                returnedSegments[returnedSegments.length - 1]?.endMs ?? null,
            }
          : {}),
        instructions: Array.isArray(payload.instructions)
          ? payload.instructions.slice(0, 10)
          : [],
        recordingId,
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

      const clip = optionalRecord(payload.clip);
      const durationMs = numberValue(clip?.durationMs) ?? 0;
      const atMs =
        durationMs > 0
          ? Math.min(requestedMs, Math.max(0, safeMs(durationMs) - 1))
          : requestedMs;
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
