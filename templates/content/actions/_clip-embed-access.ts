import { fail } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { roleSatisfies } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ClipReader, ClipUploader } from "../server/lib/clips-peer.js";
import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import { isClipRecordingId } from "../shared/clip-embed-block.js";
import {
  CLIP_PLAYBACK_ERRORS,
  CLIP_UPLOAD_ERRORS,
  type ClipPlaybackErrorCode,
  type ClipUploadErrorCode,
} from "../shared/clips-peer-contract.js";
import { CLIP_EMBED_FLAG } from "../shared/feature-flags.js";
import { resolveDocumentAccess } from "./_document-access.js";

export const clipEmbedArgsSchema = z.object({
  documentId: z.string().trim().min(1).max(256).describe("Page id"),
  recordingId: z
    .string()
    .refine(isClipRecordingId, "Not a Clips recording id")
    .describe("Clips recording id from the page's Clip block"),
});

const FAILURES: Record<
  ClipPlaybackErrorCode | ClipUploadErrorCode,
  { statusCode: number; message: string }
> = {
  [CLIP_PLAYBACK_ERRORS.disabled]: {
    statusCode: 404,
    message: "Clips in pages are not turned on",
  },
  [CLIP_PLAYBACK_ERRORS.documentNotFound]: {
    statusCode: 404,
    message: "Page not found",
  },
  [CLIP_UPLOAD_ERRORS.editRequired]: {
    statusCode: 403,
    message: "Only the page's editors can upload to it",
  },
  [CLIP_PLAYBACK_ERRORS.notConfigured]: {
    statusCode: 503,
    message: "Clips is not set up for this Content deployment",
  },
  [CLIP_PLAYBACK_ERRORS.notFound]: {
    statusCode: 404,
    message: "Clip not found",
  },
  [CLIP_PLAYBACK_ERRORS.expired]: {
    statusCode: 410,
    message: "This Clip has expired",
  },
  [CLIP_PLAYBACK_ERRORS.passwordRequired]: {
    statusCode: 403,
    message: "This Clip is password protected",
  },
  [CLIP_PLAYBACK_ERRORS.redactionPending]: {
    statusCode: 409,
    message: "This Clip is waiting for its edits to finish",
  },
  [CLIP_PLAYBACK_ERRORS.commentsDisabled]: {
    statusCode: 403,
    message: "Comments are turned off for this Clip",
  },
  [CLIP_PLAYBACK_ERRORS.forbidden]: {
    statusCode: 403,
    message: "Clips refused this reader",
  },
  [CLIP_PLAYBACK_ERRORS.unauthorized]: {
    statusCode: 502,
    message: "Clips refused Content's credentials",
  },
  [CLIP_PLAYBACK_ERRORS.rateLimited]: {
    statusCode: 429,
    message: "Too many Clip requests",
  },
  [CLIP_PLAYBACK_ERRORS.unreachable]: {
    statusCode: 502,
    message: "Clips did not answer",
  },
};

export function failClip(
  code: ClipPlaybackErrorCode | ClipUploadErrorCode,
): never {
  const { message, statusCode } = FAILURES[code];
  fail(message, { errorCode: code, statusCode });
}

async function documentState(documentId: string) {
  // guard:allow-unscoped — reads only whether a page is public or in Trash, and its org for the rollout flag; signed-in access is decided by resolveDocumentAccess, signed-out access only by visibility "public".
  const [row] = await getDb()
    .select({
      visibility: schema.documents.visibility,
      trashedAt: schema.documents.trashedAt,
      orgId: schema.documents.orgId,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  return row ?? null;
}

/**
 * The reader Content may vouch for to Clips about a Clip in this page, after
 * checking they can read it. A signed-out reader, or a public page's
 * anonymous viewer, counts only on a public page and is never named.
 */
export async function authorizeClipReader(
  documentId: string,
): Promise<ClipReader> {
  const email = getRequestUserEmail();
  const signedIn = Boolean(email) && !isPublicViewerOwner(email);

  if (signedIn) {
    const access = await resolveDocumentAccess(documentId, {
      skipResourceBody: true,
    });
    if (!access) failClip(CLIP_PLAYBACK_ERRORS.documentNotFound);
  }
  const state = await documentState(documentId);
  if (!state || state.trashedAt) {
    failClip(CLIP_PLAYBACK_ERRORS.documentNotFound);
  }
  if (!signedIn && state.visibility !== "public") {
    failClip(CLIP_PLAYBACK_ERRORS.documentNotFound);
  }

  // A signed-out reader has no org of their own, so an org's rollout reaches
  // its public pages only through the page's org.
  const enabled = await isFeatureFlagEnabled(CLIP_EMBED_FLAG, {
    userEmail: signedIn ? email : undefined,
    orgId: signedIn ? getRequestOrgId() : state.orgId,
  });
  if (!enabled) failClip(CLIP_PLAYBACK_ERRORS.disabled);

  return signedIn
    ? { kind: "signed-in", email: email!, name: getRequestUserName() ?? null }
    : { kind: "public" };
}

/**
 * The editor Content may vouch for to Clips to upload a Clip into this page,
 * after checking they can edit it. Nothing reaches Clips, and no token is
 * signed, before this returns.
 */
export async function authorizeClipUploader(
  documentId: string,
): Promise<ClipUploader> {
  const email = getRequestUserEmail();
  if (!email || isPublicViewerOwner(email)) {
    failClip(CLIP_UPLOAD_ERRORS.documentNotFound);
  }
  const access = await resolveDocumentAccess(documentId, {
    skipResourceBody: true,
  });
  if (!access) failClip(CLIP_UPLOAD_ERRORS.documentNotFound);
  if (!roleSatisfies(access.role, "editor")) {
    failClip(CLIP_UPLOAD_ERRORS.editRequired);
  }
  const state = await documentState(documentId);
  if (!state || state.trashedAt) failClip(CLIP_UPLOAD_ERRORS.documentNotFound);

  const enabled = await isFeatureFlagEnabled(CLIP_EMBED_FLAG, {
    userEmail: email,
    orgId: getRequestOrgId(),
  });
  if (!enabled) failClip(CLIP_UPLOAD_ERRORS.disabled);

  return { kind: "signed-in", email, name: getRequestUserName() ?? null };
}
