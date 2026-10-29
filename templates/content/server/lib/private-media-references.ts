import {
  isPrivateMediaId,
  ownsPrivateMedia,
} from "@agent-native/core/private-media";
import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";

import { resolveDocumentAccess } from "../../actions/_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  PRIVATE_MEDIA_PATH_PREFIX,
  privateMediaIdsInContent,
  privateMediaPath,
} from "../../shared/private-media.js";
import { getDb, schema } from "../db/index.js";

type Database = ReturnType<typeof getDb>;

export {
  PRIVATE_MEDIA_PATH_PREFIX,
  privateMediaIdsInContent,
  privateMediaPath,
};

const REFERENCE_PAGE_SIZE = 100;

/** Records that an image uploaded into a page belongs to it. */
export async function bindUploadedPrivateMedia(input: {
  documentId: string;
  mediaId: string;
}): Promise<void> {
  await getDb()
    .insert(schema.privateMediaReferences)
    .values({ documentId: input.documentId, mediaId: input.mediaId })
    .onConflictDoNothing();
}

/**
 * True when the current request's reader can view a live page that carries
 * this image: the page has a reference row and its body still links to it.
 * A page in Trash, or in a collection that was deleted, is not live, just as
 * `get-document` refuses it. Runs inside the caller's request context, so
 * space membership counts.
 *
 * The query skips pages in Trash or in a deleted collection and pages whose
 * body no longer mentions the image, so a refusal costs one access check per
 * live page that links the image, and only people who can see an image can
 * add such pages.
 */
export async function canReadPrivateMediaThroughDocument(
  mediaId: string,
): Promise<boolean> {
  if (!isPrivateMediaId(mediaId)) return false;
  const db = getDb();
  for (let offset = 0; ; offset += REFERENCE_PAGE_SIZE) {
    const references = await db
      .select({ documentId: schema.privateMediaReferences.documentId })
      .from(schema.privateMediaReferences)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.privateMediaReferences.documentId),
      )
      .where(
        and(
          eq(schema.privateMediaReferences.mediaId, mediaId),
          isNull(schema.documents.trashedAt),
          ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
          // The ID is a validated UUID, so it holds no LIKE wildcards.
          like(schema.documents.content, `%${privateMediaPath(mediaId)}%`),
        ),
      )
      .orderBy(asc(schema.privateMediaReferences.documentId))
      .limit(REFERENCE_PAGE_SIZE)
      .offset(offset);
    for (const { documentId } of references) {
      const access = await resolveDocumentAccess(documentId);
      if (
        access &&
        !access.resource.trashedAt &&
        typeof access.resource.content === "string" &&
        privateMediaIdsInContent(access.resource.content).has(mediaId)
      ) {
        return true;
      }
    }
    if (references.length < REFERENCE_PAGE_SIZE) return false;
  }
}

/**
 * Binds the private images a body write adds to its page. An image joins a
 * page only when the person saving uploaded it or can already see it on
 * another page, so nobody can attach an image ID they learned some other way.
 * Images that fail that check stay unbound and load for nobody but their
 * uploader. Rows are never removed here: a removed image's row is inert
 * because the body no longer links to it, and it lets undo and version
 * restore bring the image back.
 */
export async function syncPrivateMediaReferences(
  db: Database,
  input: { documentId: string; after: string; userEmail: string | null },
): Promise<void> {
  const mediaIds = [...privateMediaIdsInContent(input.after)];
  if (!mediaIds.length) return;
  const existing = new Set(
    (
      await db
        .select({ mediaId: schema.privateMediaReferences.mediaId })
        .from(schema.privateMediaReferences)
        .where(
          and(
            eq(schema.privateMediaReferences.documentId, input.documentId),
            inArray(schema.privateMediaReferences.mediaId, mediaIds),
          ),
        )
    ).map((row) => row.mediaId),
  );
  for (const mediaId of mediaIds) {
    if (existing.has(mediaId)) continue;
    const allowed =
      (await ownsPrivateMedia(mediaId, input.userEmail)) ||
      (await canReadPrivateMediaThroughDocument(mediaId));
    if (!allowed) continue;
    await db
      .insert(schema.privateMediaReferences)
      .values({ documentId: input.documentId, mediaId })
      .onConflictDoNothing();
  }
}
