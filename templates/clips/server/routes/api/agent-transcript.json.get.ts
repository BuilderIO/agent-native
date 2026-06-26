/**
 * GET /api/agent-transcript.json?id=<recordingId>[&password=<pw>|&t=<token>]
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

import { buildAgentApiUrls } from "../../../shared/agent-context.js";
import { isLoomEmbedBackedRecording } from "../../../shared/loom.js";
import {
  applyAgentJsonHeaders,
  getServerAppBasePath,
  loadAgentTranscript,
  loadPublicAgentAccess,
  queryString,
} from "../../lib/public-agent-context.js";

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);

  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query.t),
  });

  if (!accessResult.ok) {
    setResponseStatus(event, accessResult.failure.status);
    return accessResult.failure.body;
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

  return {
    type: "agent-native.clip.transcript",
    recording: {
      id: recording.id,
      title: recording.title,
      durationMs: recording.durationMs,
    },
    apis: {
      context: { method: "GET", url: api.contextUrl },
      ...(isLoomEmbedBacked
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
      fullText: transcript?.fullText ?? "",
      segments: agentSegments,
      segmentCount: agentSegments.length,
    },
  };
});
