import {
  isPrivateMediaId,
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  like,
  notInArray,
  or,
} from "drizzle-orm";

import { resolveDocumentAccess } from "../../actions/_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  PRIVATE_MEDIA_PATH_PREFIX,
  privateMediaIdsInContent,
  privateMediaPath,
} from "../../shared/private-media.js";
import { COMPUTED_DOCUMENT_PROPERTY_TYPES } from "../../shared/properties.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

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
 * this image: the page has a reference row and still links to it, in its
 * body, a property value or a Blocks field kept apart from the body.
 * A page in Trash, or in a collection that was deleted, is not live, just as
 * `get-document` refuses it. Runs inside the caller's request context, so
 * space membership counts. Its queries run on `db`, and access rules on the
 * executor `withDbExec` scopes.
 *
 * The query skips pages in Trash or in a deleted collection and pages that
 * no longer mention the image, so a refusal costs one access check per
 * live page that links the image, and only people who can see an image can
 * add such pages.
 */
export async function canReadPrivateMediaThroughDocument(
  mediaId: string,
  db: Database = getDb(),
): Promise<boolean> {
  if (!isPrivateMediaId(mediaId)) return false;
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
          mentionsPrivateMedia(db, mediaId),
        ),
      )
      .orderBy(asc(schema.privateMediaReferences.documentId))
      .limit(REFERENCE_PAGE_SIZE)
      .offset(offset);
    for (const { documentId } of references) {
      const access = await resolveDocumentAccess(documentId, { db });
      if (!access || access.resource.trashedAt) continue;
      const body =
        typeof access.resource.content === "string"
          ? access.resource.content
          : "";
      if (
        privateMediaIdsInContent(body).has(mediaId) ||
        (await linkedOutsideBody(db, documentId, mediaId))
      ) {
        return true;
      }
    }
    if (references.length < REFERENCE_PAGE_SIZE) return false;
  }
}

/**
 * Matches pages whose body, property values or stored Blocks fields mention
 * the image. The ID is a validated UUID, so it holds no LIKE wildcards.
 */
function mentionsPrivateMedia(db: Database, mediaId: string) {
  const pattern = `%${privateMediaPath(mediaId)}%`;
  return or(
    like(schema.documents.content, pattern),
    exists(
      db
        .select({ documentId: schema.documentPropertyValues.documentId })
        .from(schema.documentPropertyValues)
        .where(
          and(
            eq(schema.documentPropertyValues.documentId, schema.documents.id),
            like(schema.documentPropertyValues.valueJson, pattern),
          ),
        ),
    ),
    exists(
      db
        .select({ documentId: schema.documentBlockFieldContents.documentId })
        .from(schema.documentBlockFieldContents)
        .where(
          and(
            eq(
              schema.documentBlockFieldContents.documentId,
              schema.documents.id,
            ),
            like(schema.documentBlockFieldContents.content, pattern),
          ),
        ),
    ),
  );
}

/**
 * Property types whose values `get-document` holds back from a reader who
 * can open the page but not its collection, because they come from other
 * pages.
 */
const VALUES_FROM_OTHER_PAGES: string[] = [
  "relation",
  ...COMPUTED_DOCUMENT_PROPERTY_TYPES,
];

/**
 * The text a page keeps outside its body that every reader of the page is
 * shown: its stored property values and Blocks fields, for properties that
 * still exist in a collection that hasn't been deleted. Relations and
 * computed values are left out, since a reader shared only the page doesn't
 * see them.
 */
export async function documentTextOutsideBody(
  db: Database,
  documentId: string,
  mediaIds?: readonly string[],
): Promise<string[]> {
  const mentions = (column: Parameters<typeof like>[0]) =>
    mediaIds?.length
      ? or(...mediaIds.map((id) => like(column, `%${privateMediaPath(id)}%`)))
      : like(column, `%${PRIVATE_MEDIA_PATH_PREFIX}%`);
  const shownProperty = and(
    notInArray(
      schema.documentPropertyDefinitions.type,
      VALUES_FROM_OTHER_PAGES,
    ),
    isNull(schema.contentDatabases.deletedAt),
  );
  const values = await db
    .select({ text: schema.documentPropertyValues.valueJson })
    .from(schema.documentPropertyValues)
    .innerJoin(
      schema.documentPropertyDefinitions,
      eq(
        schema.documentPropertyDefinitions.id,
        schema.documentPropertyValues.propertyId,
      ),
    )
    .leftJoin(
      schema.contentDatabases,
      eq(
        schema.contentDatabases.id,
        schema.documentPropertyDefinitions.databaseId,
      ),
    )
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        shownProperty,
        mentions(schema.documentPropertyValues.valueJson),
      ),
    );
  const fields = await db
    .select({ text: schema.documentBlockFieldContents.content })
    .from(schema.documentBlockFieldContents)
    .innerJoin(
      schema.documentPropertyDefinitions,
      eq(
        schema.documentPropertyDefinitions.id,
        schema.documentBlockFieldContents.propertyId,
      ),
    )
    .leftJoin(
      schema.contentDatabases,
      eq(
        schema.contentDatabases.id,
        schema.documentPropertyDefinitions.databaseId,
      ),
    )
    .where(
      and(
        eq(schema.documentBlockFieldContents.documentId, documentId),
        shownProperty,
        mentions(schema.documentBlockFieldContents.content),
      ),
    );
  return [...values, ...fields].map((row) => row.text);
}

async function linkedOutsideBody(
  db: Database,
  documentId: string,
  mediaId: string,
): Promise<boolean> {
  const texts = await documentTextOutsideBody(db, documentId, [mediaId]);
  return texts.some((text) => privateMediaIdsInContent(text).has(mediaId));
}

/** True when `userEmail` uploaded this image, read on `db`. */
async function uploadedBy(
  db: Database,
  mediaId: string,
  userEmail: string | null,
): Promise<boolean> {
  const email = userEmail?.trim().toLowerCase();
  if (!email) return false;
  await privateMediaStore.ready();
  const rows = await db
    .select({ ownerEmail: privateMedia.ownerEmail })
    .from(privateMedia)
    .where(eq(privateMedia.id, mediaId))
    .limit(1);
  return firstRow(rows)?.ownerEmail === email;
}

/**
 * Binds the private images a body write adds to its page. An image joins a
 * page only when the person saving uploaded it or can already see it on
 * another page, so nobody can attach an image ID they learned some other way.
 * Images that fail that check stay unbound and load for nobody but their
 * uploader. Rows are never removed here: a removed image's row is inert
 * because the body no longer links to it, and it lets undo and version
 * restore bring the image back.
 *
 * Saves call this inside their transaction, so every check runs on `db`, and
 * a raw `DbExec` transaction must be scoped with `withDbExec` for the access
 * rules. A query on another connection would wait for the one the save holds,
 * which on a one-connection serverless pool never frees.
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
      (await uploadedBy(db, mediaId, input.userEmail)) ||
      (await canReadPrivateMediaThroughDocument(mediaId, db));
    if (!allowed) continue;
    await db
      .insert(schema.privateMediaReferences)
      .values({ documentId: input.documentId, mediaId })
      .onConflictDoNothing();
  }
}
