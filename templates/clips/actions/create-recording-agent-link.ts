import { defineAction } from "@agent-native/core";
import {
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
  getRequestContext,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  CLIPS_AGENT_ACCESS_TTL_SECONDS,
  getServerAppBasePath,
} from "../server/lib/public-agent-context.js";
import {
  buildAgentApiUrls,
  CLIP_AGENT_ACCESS_TOKEN_PREFIX,
} from "../shared/agent-context.js";

function appOrigin(): string {
  const origin =
    getRequestContext()?.requestOrigin ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(origin).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export default defineAction({
  description:
    "Create a temporary private agent-readable link for one Clips recording. The URL is scoped to that recording and expires after two hours.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  readOnly: true,
  run: async (args) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${args.recordingId}`);
    }

    const recording = access.resource as {
      id: string;
      archivedAt?: string | null;
      trashedAt?: string | null;
    };
    if (recording.archivedAt || recording.trashedAt) {
      throw new ForbiddenError(
        `Recording ${args.recordingId} is not shareable`,
      );
    }

    const grant = createScopedAgentAccessGrant({
      resourceKind: CLIP_AGENT_ACCESS_TOKEN_PREFIX,
      resourceId: recording.id,
      viewerEmail: getRequestUserEmail() || undefined,
      ttlSeconds: CLIPS_AGENT_ACCESS_TTL_SECONDS,
    });
    const origin = appOrigin();
    const basePath = getServerAppBasePath();
    const pageUrl = buildAgentAccessUrl({
      path: `/share/${encodeURIComponent(recording.id)}`,
      origin,
      basePath,
      token: grant.token,
    });
    const api = buildAgentApiUrls(recording.id, {
      origin,
      basePath,
      token: grant.token,
    });

    return {
      recordingId: recording.id,
      url: pageUrl,
      contextUrl: api.contextUrl,
      expiresAt: grant.expiresAt,
      ttlSeconds: grant.ttlSeconds,
    };
  },
});
