/**
 * GET /api/agent-transcript.json?id=<recordingId>[&password=<pw>|&t=<token>]
 *   [&startMs=<ms>&endMs=<ms>&maxSegments=<count>]
 *
 * Timestamped transcript for a public clip, optimized for external agents.
 */

import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  buildAgentApiUrls,
  CLIPS_WEBMCP_DISCOVERY,
  CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS,
  getAgentClipReadiness,
  nextAgentTranscriptStartMs,
} from "../../../shared/agent-context.js";
import { isLoomEmbedBackedRecording } from "../../../shared/loom.js";
import {
  applyAgentJsonHeaders,
  CLIPS_AGENT_ACCESS_PARAM,
  getServerAppBasePath,
  loadAgentTranscript,
  loadPublicAgentAccess,
  queryString,
  transcriptStatusInstructions,
} from "../../lib/public-agent-context.js";

type AgentTranscriptWindow = {
  startMs?: number;
  endMs?: number;
  maxSegments: number;
};

type AgentTranscriptSegment = {
  startMs: number;
  endMs: number;
};

function parseAgentTranscriptWindow(
  query: Record<string, unknown>,
): AgentTranscriptWindow | null {
  const parseMs = (key: "startMs" | "endMs") => {
    const raw = queryString(query[key]);
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Transcript query ${key} must be a non-negative number`);
    }
    return Math.round(value);
  };

  const startMs = parseMs("startMs");
  const endMs = parseMs("endMs");
  const rawMaxSegments = queryString(query.maxSegments);
  const maxSegments = rawMaxSegments ? Number(rawMaxSegments) : undefined;
  if (
    maxSegments !== undefined &&
    (!Number.isInteger(maxSegments) ||
      maxSegments < 1 ||
      maxSegments > CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS)
  ) {
    throw new Error(
      `Transcript query maxSegments must be an integer from 1 to ${CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS}`,
    );
  }
  if (startMs !== undefined && endMs !== undefined && endMs < startMs) {
    throw new Error("Transcript query endMs must be greater than startMs");
  }

  const hasWindow =
    startMs !== undefined || endMs !== undefined || maxSegments !== undefined;
  if (!hasWindow) return null;
  return {
    ...(startMs !== undefined ? { startMs } : {}),
    ...(endMs !== undefined ? { endMs } : {}),
    maxSegments: maxSegments ?? CLIPS_WEBMCP_MAX_TRANSCRIPT_SEGMENTS,
  };
}

function pageAgentTranscriptSegments(
  segments: AgentTranscriptSegment[],
  window: AgentTranscriptWindow,
) {
  const matchingSegments = segments.filter(
    (segment) =>
      (window.startMs === undefined || segment.endMs >= window.startMs) &&
      (window.endMs === undefined || segment.startMs <= window.endMs),
  );
  const page = matchingSegments.slice(0, window.maxSegments);
  const truncated = matchingSegments.length > page.length;
  const lastSegment = page[page.length - 1];
  return {
    segments: page,
    truncated,
    ...(truncated && lastSegment
      ? { nextStartMs: nextAgentTranscriptStartMs(lastSegment.endMs) }
      : {}),
  };
}

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);

  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]) || queryString(query.t),
  });

  if (!accessResult.ok) {
    setResponseStatus(event, accessResult.failure.status);
    return accessResult.failure.body;
  }

  let transcriptWindow: AgentTranscriptWindow | null;
  try {
    transcriptWindow = parseAgentTranscriptWindow(query);
  } catch (error) {
    setResponseStatus(event, 400);
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const recording = accessResult.access.recording;
  const { transcript, agentSegments } = await loadAgentTranscript(
    recording.id,
    recording.durationMs,
  );
  const api = buildAgentApiUrls(recording.id, {
    origin: getRequestURL(event).origin,
    basePath: getServerAppBasePath(),
    token: accessResult.access.apiToken,
  });
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const agentReadiness = getAgentClipReadiness(recording.status);
  const clipIsReady = agentReadiness.state === "ready";
  const transcriptPage = transcriptWindow
    ? pageAgentTranscriptSegments(agentSegments, transcriptWindow)
    : null;

  return {
    type: "agent-native.clip.transcript",
    webmcp: CLIPS_WEBMCP_DISCOVERY,
    recording: {
      id: recording.id,
      title: recording.title,
      durationMs: recording.durationMs,
      status: recording.status,
      agentReadiness,
    },
    apis: {
      context: { method: "GET", url: api.contextUrl },
      transcript: { method: "GET", url: api.transcriptUrl },
      ...(!clipIsReady || isLoomEmbedBacked
        ? {}
        : {
            frame: {
              method: "GET",
              urlTemplate: api.frameUrlTemplate,
            },
          }),
    },
    transcript: {
      status: transcript?.status ?? "missing",
      language: transcript?.language ?? null,
      failureReason: transcript?.failureReason ?? null,
      retryAfterSeconds: transcript?.status === "pending" ? 15 : null,
      ...(transcriptWindow
        ? {
            segments: transcriptPage?.segments ?? [],
            segmentCount: agentSegments.length,
            returnedSegmentCount: transcriptPage?.segments.length ?? 0,
            truncated: transcriptPage?.truncated ?? false,
            ...(transcriptPage?.nextStartMs !== undefined
              ? { nextStartMs: transcriptPage.nextStartMs }
              : {}),
          }
        : {
            fullText: transcript?.fullText ?? "",
            segments: agentSegments,
            segmentCount: agentSegments.length,
          }),
    },
    instructions: [
      "If this clip page is open in a WebMCP-capable browser, list its page tools before using the transcript or frame tools.",
      ...(agentReadiness.instruction ? [agentReadiness.instruction] : []),
      ...transcriptStatusInstructions(transcript),
    ],
  };
});
