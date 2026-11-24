import { answerLinkSummaries } from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  linkSummaryRequestSchema,
  linkSummaryResultSchema,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";

import type { schema } from "../server/db/index.js";
import { isHeldForRedaction } from "../server/lib/pending-redactions.js";
import {
  canOpenDirectRecordingPage,
  isRecordingExpired,
  isRecordingExpiredForViewer,
  isRecordingPasswordProtectedForViewer,
  isRecordingTrashedForViewer,
} from "../server/lib/recording-page-access.js";
import { hasExplicitRecordingShare } from "../server/lib/recording-share-grant.js";

export default defineAction({
  description:
    "Summarize Clips links for another app's link card, as the caller: each recording's title when the caller can open that link, otherwise only unavailable. Reads titles; changes nothing.",
  schema: linkSummaryRequestSchema,
  outputSchema: linkSummaryResultSchema,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: "search",
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ links }) =>
    answerLinkSummaries({
      app: "clips",
      links,
      basePath: getConfiguredAppBasePath(),
      readTitle: async ({ id, route }) => {
        const access = await resolveAccess("recording", id);
        if (!access) return null;
        const recording =
          access.resource as typeof schema.recordings.$inferSelect;
        const viewerIsOwner = access.role === "owner";
        const hasPassword = Boolean(recording.password);
        if (
          recording.failureCode === "taken_down" ||
          isHeldForRedaction(recording.editsJson, access.role) ||
          isRecordingTrashedForViewer({
            trashedAt: recording.trashedAt,
            viewerIsOwner,
          }) ||
          isRecordingExpiredForViewer({
            expiresAt: recording.expiresAt,
            viewerIsOwner,
          }) ||
          isRecordingPasswordProtectedForViewer({
            hasPassword,
            viewerIsOwner,
            visibility: recording.visibility,
          })
        ) {
          return null;
        }
        if (
          route === "share" &&
          (recording.trashedAt !== null ||
            isRecordingExpired(recording.expiresAt))
        ) {
          return null;
        }
        if (
          route === "r" &&
          !canOpenDirectRecordingPage({
            role: access.role,
            visibility: recording.visibility,
            hasPassword,
            hasExplicitShare: await hasExplicitRecordingShare({
              recordingId: id,
              role: access.role,
              visibility: recording.visibility,
              hasPassword,
              isAgentCaller: false,
            }),
          })
        ) {
          return null;
        }
        if (
          route === "embed" &&
          (recording.visibility !== "public" ||
            hasPassword ||
            recording.archivedAt !== null ||
            recording.trashedAt !== null ||
            isRecordingExpired(recording.expiresAt))
        ) {
          return null;
        }
        return recording.title;
      },
    }),
});
