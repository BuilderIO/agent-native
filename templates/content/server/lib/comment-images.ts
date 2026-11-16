import { fail, type ActionRunContext } from "@agent-native/core/action";
import {
  isPrivateMediaId,
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import { getRequestRunContext } from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";

import { resolveDocumentAccess } from "../../actions/_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  MAX_COMMENT_IMAGES,
  commentImageMediaId,
  isCommentImageType,
  normalizeCommentImage,
  readStoredCommentImages,
  type CommentImage,
} from "../../shared/comment-images.js";
import { privateMediaPath } from "../../shared/private-media.js";
import { getDb, schema } from "../db/index.js";
import { readsWithoutSessionCookie } from "./private-media-agent-links.js";

type Database = ReturnType<typeof getDb>;

const COMMENT_PAGE_SIZE = 100;

/**
 * True when an agent makes the comment write: an agent run, the in-app
 * agent's tools, or a caller that reaches Content without its sign-in cookie,
 * such as MCP or the CLI. Only a person attaches images, in the comment box.
 */
export function commentWriteByAgent(
  ctx: Pick<ActionRunContext, "caller"> | undefined,
): boolean {
  return (
    Boolean(getRequestRunContext()?.runId) ||
    ctx?.caller === "webmcp" ||
    readsWithoutSessionCookie(ctx)
  );
}

/**
 * The images a comment write saves, checked. Each one is a PNG, JPEG, GIF or
 * WebP image the writer uploaded to this page, or one the comment already had
 * (`kept`), so nobody can attach an image ID they learned some other way. An
 * agent can keep a comment's images but not add any. Repeats are dropped, and
 * more than five is refused. A new image's type is the one it was stored
 * with. Runs before the write's transaction: its reads use their own
 * connection.
 */
export async function attachableCommentImages(input: {
  documentId: string;
  userEmail: string;
  images: readonly unknown[];
  kept?: readonly CommentImage[];
  byAgent?: boolean;
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
  const kept = new Map(
    (input.kept ?? []).map((image) => [image.url, image] as const),
  );
  const added = images.flatMap((image) => {
    const mediaId = commentImageMediaId(image);
    return mediaId && !kept.has(image.url) ? [mediaId] : [];
  });
  // Kept images stay as the comment had them; a new one takes its stored type.
  if (!added.length) return images.map((image) => kept.get(image.url) ?? image);
  if (input.byAgent) {
    fail(
      "Only a person can attach an image, in the comment box; an agent can keep the images a comment has",
      { statusCode: 400, errorCode: "comment_image_not_attachable" },
    );
  }

  await privateMediaStore.ready();
  const owned = new Map(
    (
      await db
        .select({
          mediaId: schema.privateMediaReferences.mediaId,
          mimeType: privateMedia.mimeType,
        })
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
    ).map((row) => [row.mediaId, row.mimeType] as const),
  );
  if (added.some((mediaId) => !owned.has(mediaId))) {
    fail(
      "An image on this comment wasn't uploaded to this page by you; attach it again in the comment box",
      { statusCode: 400, errorCode: "comment_image_not_attachable" },
    );
  }
  if (added.some((mediaId) => !isCommentImageType(owned.get(mediaId) ?? ""))) {
    fail("A comment takes PNG, JPEG, GIF or WebP images", {
      statusCode: 400,
      errorCode: "comment_image_invalid",
    });
  }
  return images.map((image) => {
    const had = kept.get(image.url);
    if (had) return had;
    const mediaId = commentImageMediaId(image);
    const stored = mediaId ? owned.get(mediaId) : undefined;
    return stored ? { ...image, contentType: stored.toLowerCase() } : image;
  });
}

/**
 * True when the current request's reader can view a live page with a
 * comment that carries this image, uploaded to that page. A deleted
 * comment's row is gone, and a page in Trash or in a deleted collection is
 * not live, so either stops the image loading for everyone but its uploader.
 * Runs inside the caller's request context, so space membership counts.
 */
export function canReadPrivateMediaThroughComment(
  mediaId: string,
  db: Database = getDb(),
): Promise<boolean> {
  return someLiveCommentPage(
    mediaId,
    db,
    async (documentId) =>
      !!(await resolveDocumentAccess(documentId, {
        db,
        skipResourceBody: true,
      })),
  );
}

/**
 * True when a live comment on a live page still carries this image, uploaded
 * to that page, whoever asks. An agent's link to a comment's image opens it
 * only while this holds, so deleting the comment or trashing its page closes
 * the link as well.
 */
export function liveCommentCarriesPrivateMedia(
  mediaId: string,
  db: Database = getDb(),
): Promise<boolean> {
  return someLiveCommentPage(mediaId, db, async () => true);
}

/**
 * Walks the live pages with a comment that carries this image, uploaded to
 * that page, until `opens` accepts one.
 */
async function someLiveCommentPage(
  mediaId: string,
  db: Database,
  opens: (documentId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!isPrivateMediaId(mediaId)) return false;
  const path = privateMediaPath(mediaId);
  const checked = new Set<string>();
  for (let offset = 0; ; offset += COMMENT_PAGE_SIZE) {
    // The ID is a validated UUID, so it holds no LIKE wildcards. A page lists
    // only the comments filed under its owner, as list-comments does, so a
    // row under another owner opens nothing, and a comment opens only images
    // uploaded to its own page.
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
      .innerJoin(
        schema.privateMediaReferences,
        and(
          eq(
            schema.privateMediaReferences.documentId,
            schema.documentComments.documentId,
          ),
          eq(schema.privateMediaReferences.mediaId, mediaId),
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
      if (await opens(row.documentId)) return true;
    }
    if (rows.length < COMMENT_PAGE_SIZE) return false;
  }
}
