import { getOrgContext } from "@agent-native/core/org";
import type { AgentChatReference } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { createError, type H3Event } from "h3";
import { z } from "zod";

import listRecordings, {
  listRecordingsSchema,
} from "../../actions/list-recordings.js";
import { composerReferenceMessages } from "./composer-reference-messages.js";
import { isHeldForRedaction } from "./pending-redactions.js";
import {
  canOpenDirectRecordingPage,
  isRecordingExpiredForViewer,
  isRecordingTrashedForViewer,
} from "./recording-page-access.js";
import { hasExplicitRecordingShare } from "./recording-share-grant.js";

const recordingReferenceSchema = z.object({
  visibility: z.enum(["private", "org", "public"]),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  trashedAt: z.string().nullable(),
  editsJson: z.string().nullable(),
});

export async function searchRecordingReferences(
  query: string,
  event?: H3Event,
) {
  if (!event)
    throw createError({
      statusCode: 401,
      statusMessage: (await composerReferenceMessages()).authentication,
    });
  const { email, orgId } = await getOrgContext(event);
  const result = await listRecordings.run(
    listRecordingsSchema.parse({
      view: "all",
      search: query.trim().slice(0, 200),
      limit: 20,
      includeMedia: false,
    }),
    { caller: "frontend", userEmail: email, orgId },
  );
  return result.recordings
    .filter(
      (recording) => !recording.hasPassword || recording.ownerEmail === email,
    )
    .map((recording) => ({
      id: `recording:${recording.id}`,
      label: recording.title || recording.id,
      description: recording.description.slice(0, 500),
      refType: "recording",
      refId: recording.id,
      refPath: `/r/${encodeURIComponent(recording.id)}`,
      icon: "video",
    }));
}

export async function validateRecordingReferences(
  references: readonly AgentChatReference[],
) {
  for (const reference of references) {
    if (reference.type !== "mention" || reference.refType !== "recording")
      continue;
    if (!reference.refId)
      throw createError({
        statusCode: 400,
        statusMessage: (await composerReferenceMessages()).invalid,
      });
    const access = await assertAccess(
      "recording",
      reference.refId,
      "viewer",
    ).catch(async (error: unknown) => {
      if (error instanceof ForbiddenError)
        throw new ForbiddenError(
          (await composerReferenceMessages()).unavailable,
        );
      throw error;
    });
    const recording = recordingReferenceSchema.parse(access.resource);
    const viewerIsOwner = access.role === "owner";
    const hasExplicitShare = await hasExplicitRecordingShare({
      recordingId: reference.refId,
      role: access.role,
      visibility: recording.visibility,
      hasPassword: Boolean(recording.password),
      isAgentCaller: true,
    });
    if (
      isRecordingExpiredForViewer({
        expiresAt: recording.expiresAt,
        viewerIsOwner,
      }) ||
      isRecordingTrashedForViewer({
        trashedAt: recording.trashedAt,
        viewerIsOwner,
      }) ||
      isHeldForRedaction(recording.editsJson, access.role) ||
      !canOpenDirectRecordingPage({
        role: access.role,
        visibility: recording.visibility,
        hasPassword: Boolean(recording.password),
        hasExplicitShare,
      })
    )
      throw new ForbiddenError((await composerReferenceMessages()).unavailable);
  }
}
