import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createError } from "h3";

import { getDb, schema } from "../db/index.js";

const ACTIVE_UPLOAD = { origin: "upload", state: "active" } as const;

/**
 * A page's upload binding still in force: Content hasn't moved the page to
 * Trash. Only such a binding lets the page's readers play the Clip, takes the
 * upload's chunks, or lists the Clip under From Content with its page link.
 */
export function isActiveUploadBinding(binding: {
  origin: string;
  state: string;
}): boolean {
  return (
    binding.origin === ACTIVE_UPLOAD.origin &&
    binding.state === ACTIVE_UPLOAD.state
  );
}

/** `isActiveUploadBinding` as a condition on `recording_content_bindings`. */
export function activeUploadBinding() {
  const bindings = schema.recordingContentBindings;
  return and(
    eq(bindings.origin, ACTIVE_UPLOAD.origin),
    eq(bindings.state, ACTIVE_UPLOAD.state),
  );
}

/**
 * True for a recording uploaded from an Agent-Native Content page, whatever
 * its page's state now. Library's own list leaves all of them out; a Clip
 * linked into a page stays in Library.
 */
export function uploadedFromContent() {
  const bindings = schema.recordingContentBindings;
  return sql`EXISTS (SELECT 1 FROM ${bindings} WHERE ${bindings.recordingId} = ${schema.recordings.id} AND ${bindings.origin} = ${ACTIVE_UPLOAD.origin})`;
}

/** True for an upload whose page binding is still active: From Content's list. */
export function activeUploadFromContent() {
  const bindings = schema.recordingContentBindings;
  return sql`EXISTS (SELECT 1 FROM ${bindings} WHERE ${bindings.recordingId} = ${schema.recordings.id} AND ${activeUploadBinding()})`;
}

/**
 * True for an upload whose page is in Trash. Every Clips list and folder
 * count leaves it out, a folder or space someone moved it into included,
 * until its page is restored; search still finds it, as it does a Clip in
 * Trash.
 */
export function uploadFromTrashedPage() {
  return sql`(${uploadedFromContent()} AND NOT ${activeUploadFromContent()})`;
}

/**
 * Refuses a chunk for an upload from a Content page on any route but
 * Content's own chunk route, which alone checks the page's binding and
 * claims the final chunk. The agent route would otherwise take the upload's
 * ticket, an ordinary upload ticket, and the editor's own Clips session
 * would reach it as the recording's owner.
 */
export async function refuseContentUploadChunk(
  recordingId: string,
): Promise<void> {
  const bindings = schema.recordingContentBindings;
  const uploads = await getDb()
    .select({ id: bindings.id })
    .from(bindings)
    .where(
      and(
        eq(bindings.recordingId, recordingId),
        eq(bindings.origin, ACTIVE_UPLOAD.origin),
      ),
    )
    .limit(1);
  if (uploads.length > 0) {
    throw createError({
      statusCode: 409,
      message:
        "This upload came from a Content page. Send its chunks to the chunk URL its start returned.",
    });
  }
}

/**
 * The Content page each upload came from, by recording id, for active
 * bindings only. Clips keeps no page titles, so a page is named by its link
 * alone.
 */
export async function contentPageUrls(
  recordingIds: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!recordingIds.length) return urls;
  const bindings = schema.recordingContentBindings;
  const pages = await getDb()
    .select({
      recordingId: bindings.recordingId,
      contentApp: bindings.contentApp,
      documentId: bindings.documentId,
    })
    .from(bindings)
    .where(
      and(inArray(bindings.recordingId, recordingIds), activeUploadBinding()),
    )
    .orderBy(asc(bindings.createdAt));
  for (const page of pages) {
    if (urls.has(page.recordingId)) continue;
    urls.set(
      page.recordingId,
      `${page.contentApp}/page/${encodeURIComponent(page.documentId)}`,
    );
  }
  return urls;
}
