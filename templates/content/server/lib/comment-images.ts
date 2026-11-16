import { fail } from "@agent-native/core/action";
import {
  isPrivateMediaId,
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";

import { resolveDocumentAccess } from "../../actions/_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  MAX_COMMENT_IMAGES,
  commentImageMediaId,
  normalizeCommentImage,
  readStoredCommentImages,
  type CommentImage,
} from "../../shared/comment-images.js";
import { privateMediaPath } from "../../shared/private-media.js";
import { getDb, schema } from "../db/index.js";

type Database = ReturnType<typeof getDb>;

const COMMENT_PAGE_SIZE = 100;

/**
 * The images a comment write saves, checked. Each one is a private image the
 * writer uploaded to this page through the comment box, or one the comment
 * already had (`kept`), so nobody can attach an image ID they learned some
 * other way. Repeats are dropped, and more than five is refused. Runs before
 * the write's transaction: its reads use their own connection.
 */
export async function attachableCommentImages(input: {
  documentId: string;
  userEmail: string;
  images: readonly unknown[];
  kept?: readonly CommentImage[];
  db?: Database;
}): Promise<CommentImage[]> {
  const db = input.db ?? getDb();
  const images: CommentImage[] = [];
  const seen = new Set<string>();
  for (const value of input.images) {
    const image = normalizeCommentImage(value);
    if (!image) {
      fail(
        "Each image must be one uploaded through the comment box, as { url, name, contentType } with url /api/private-media/<id>",
        { statusCode: 400, errorCode: "comment_image_invalid" },
      );
    }
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    images.push(image);
  }
  if (images.length > MAX_COMMENT_IMAGES) {
    fail(`A comment holds at most ${MAX_COMMENT_IMAGES} images`, {
      statusCode: 400,
      errorCode: "comment_too_many_images",
    });
  }
  const kept = new Set((input.kept ?? []).map(({ url }) => url));
  const added = images.flatMap((image) => {
    const mediaId = commentImageMediaId(image);
    return mediaId && !kept.has(image.url) ? [mediaId] : [];
  });
  if (!added.length) return images;

  await privateMediaStore.ready();
  const owned = new Set(
    (
      await db
        .select({ mediaId: schema.privateMediaReferences.mediaId })
        .from(schema.privateMediaReferences)
        .innerJoin(
          privateMedia,
          eq(privateMedia.id, schema.privateMediaReferences.mediaId),
        )
        .where(
          and(
            eq(schema.privateMediaReferences.documentId, input.documentId),
            inArray(schema.privateMediaReferences.mediaId, added),
            eq(privateMedia.ownerEmail, input.userEmail.trim().toLowerCase()),
          ),
        )
    ).map((row) => row.mediaId),
  );
  if (added.some((mediaId) => !owned.has(mediaId))) {
    fail(
      "An image on this comment wasn't uploaded to this page by you; attach it again in the comment box",
      { statusCode: 400, errorCode: "comment_image_not_attachable" },
    );
  }
  return images;
}

/**
 * True when the current request's reader can view a live page with a
 * comment that carries this image. A deleted comment's row is gone, and a
 * page in Trash or in a deleted collection is not live, so either stops the
 * image loading for everyone but its uploader. Runs inside the caller's
 * request context, so space membership counts.
 */
export async function canReadPrivateMediaThroughComment(
  mediaId: string,
  db: Database = getDb(),
): Promise<boolean> {
  if (!isPrivateMediaId(mediaId)) return false;
  const path = privateMediaPath(mediaId);
  const checked = new Set<string>();
  for (let offset = 0; ; offset += COMMENT_PAGE_SIZE) {
    // The ID is a validated UUID, so it holds no LIKE wildcards. A page lists
    // only the comments filed under its owner, as list-comments does, so a
    // row under another owner opens nothing.
    const rows = await db
      .select({
        documentId: schema.documentComments.documentId,
        attachmentsJson: schema.documentComments.attachmentsJson,
      })
      .from(schema.documentComments)
      .innerJoin(
        schema.documents,
        and(
          eq(schema.documents.id, schema.documentComments.documentId),
          eq(schema.documents.ownerEmail, schema.documentComments.ownerEmail),
        ),
      )
      .where(
        and(
          like(schema.documentComments.attachmentsJson, `%${path}%`),
          isNull(schema.documents.trashedAt),
          ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
        ),
      )
      .orderBy(
        asc(schema.documentComments.documentId),
        asc(schema.documentComments.id),
      )
      .limit(COMMENT_PAGE_SIZE)
      .offset(offset);
    for (const row of rows) {
      if (checked.has(row.documentId)) continue;
      if (
        !readStoredCommentImages(row.attachmentsJson).some(
          (image) => image.url === path,
        )
      ) {
        continue;
      }
      checked.add(row.documentId);
      if (
        await resolveDocumentAccess(row.documentId, {
          db,
          skipResourceBody: true,
        })
      ) {
        return true;
      }
    }
    if (rows.length < COMMENT_PAGE_SIZE) return false;
  }
}
