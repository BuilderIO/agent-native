import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  documentCreationAttribution,
  requireDocumentRequestActor,
} from "../server/lib/document-attribution.js";
import { firstRow } from "../server/lib/first-row.js";
import { syncPrivateMediaReferences } from "../server/lib/private-media-references.js";
import { serializePropertyValue } from "../shared/properties.js";
import {
  type TableCollectionSeed,
  tableCollectionSeedSchema,
} from "../shared/table-collection-seed.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { nextAppendPosition } from "./_position-utils.js";
import { nanoid } from "./_property-utils.js";

type Db = ReturnType<typeof getDb>;

const INSERT_CHUNK = 500;

async function insertInChunks<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await insert(rows.slice(start, start + INSERT_CHUNK));
  }
}

export async function seedCollectionFromTable(
  db: Db,
  databaseId: string,
  table: TableCollectionSeed,
) {
  const seed = tableCollectionSeedSchema.parse(table);
  const database = firstRow(
    await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId)),
  );
  if (!database) {
    // guard:allow-bare-error — invariant: the caller made this collection in the same transaction
    throw new Error(`Database "${databaseId}" not found`);
  }
  const collectionPage = firstRow(
    await db
      .select({
        visibility: schema.documents.visibility,
        hideFromSearch: schema.documents.hideFromSearch,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, database.documentId)),
  );
  if (!collectionPage) {
    // guard:allow-bare-error — invariant: a collection is made with its page
    throw new Error(`Database "${databaseId}" has no page`);
  }

  const now = new Date().toISOString();
  const actor = requireDocumentRequestActor();
  const owner = { ownerEmail: database.ownerEmail, orgId: database.orgId };

  const maxPosition = firstRow(
    await db
      .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId)),
  );
  const firstPosition = nextAppendPosition(maxPosition?.max);
  const properties = seed.properties.map((name, index) => ({
    id: nanoid(),
    name,
    position: firstPosition + index,
  }));
  if (properties.length > 0) {
    await db.insert(schema.documentPropertyDefinitions).values(
      properties.map((property) => ({
        ...property,
        ...owner,
        databaseId,
        type: "text",
        visibility: "always_show",
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  const rows = seed.rows.map(([title = "", ...cells], position) => ({
    documentId: nanoid(),
    itemId: nanoid(),
    position,
    title: title.replace(/\s+/g, " ").trim(),
    cells,
  }));
  await insertInChunks(rows, (chunk) =>
    db.insert(schema.documents).values(
      chunk.map((row) => ({
        id: row.documentId,
        spaceId: database.spaceId,
        ...owner,
        parentId: database.documentId,
        title: row.title,
        content: "",
        icon: null,
        position: row.position,
        isFavorite: 0,
        hideFromSearch: collectionPage.hideFromSearch,
        visibility: collectionPage.visibility,
        ...documentCreationAttribution(actor),
        createdAt: now,
        updatedAt: now,
      })),
    ),
  );
  await insertInChunks(rows, (chunk) =>
    db.insert(schema.contentDatabaseItems).values(
      chunk.map((row) => ({
        id: row.itemId,
        ...owner,
        databaseId,
        documentId: row.documentId,
        position: row.position,
        createdAt: now,
        updatedAt: now,
      })),
    ),
  );

  const values = rows.flatMap((row) =>
    properties.flatMap((property, index) => {
      const text = row.cells[index] ?? "";
      return text.trim()
        ? [
            {
              id: nanoid(),
              ownerEmail: database.ownerEmail,
              documentId: row.documentId,
              propertyId: property.id,
              valueJson: serializePropertyValue(text),
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [];
    }),
  );
  await insertInChunks(values, (chunk) =>
    db.insert(schema.documentPropertyValues).values(chunk),
  );
  for (const row of rows) {
    await syncPrivateMediaReferences(db, {
      documentId: row.documentId,
      after: row.cells.join("\n"),
      userEmail: actor,
    });
  }

  const shares = await db
    .select({
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
      role: schema.documentShares.role,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, database.documentId));
  const rowShares = rows.flatMap((row) =>
    shares.map((share) => ({
      id: nanoid(),
      resourceId: row.documentId,
      ...share,
      createdBy: actor,
      createdAt: now,
    })),
  );
  await insertInChunks(rowShares, (chunk) =>
    db.insert(schema.documentShares).values(chunk),
  );

  await ensureDocumentsFilesMembership(
    db,
    rows.map((row) => row.documentId),
    now,
  );
}
