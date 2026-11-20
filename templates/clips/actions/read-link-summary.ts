import { answerLinkSummaries } from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  linkSummaryRequestSchema,
  linkSummaryResultSchema,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";

import type { schema } from "../server/db/index.js";
import {
  canOpenDirectRecordingPage,
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
  mcpTool: true,
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
        return recording.title;
      },
    }),
});
