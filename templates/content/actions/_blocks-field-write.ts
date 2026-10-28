import { ActionContractError } from "@agent-native/core";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import { assertNoNewlySharedVideoIds } from "../server/lib/video-block-ids.js";
import { contentDatabaseSourceFieldsAllowLocalWrite } from "../shared/source-field-policy.js";
import { persistBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { nanoid } from "./_property-utils.js";

export async function assertPropertyWritableByRowMutation(
  db: ReturnType<typeof getDb>,
  databaseId: string,
  definition: typeof schema.documentPropertyDefinitions.$inferSelect,
) {
  const sourceFields = await db
    .select({
      writeOwner: schema.contentDatabaseSourceFields.writeOwner,
      readOnly: schema.contentDatabaseSourceFields.readOnly,
    })
    .from(schema.contentDatabaseSourceFields)
    .innerJoin(
      schema.contentDatabaseSources,
      eq(
        schema.contentDatabaseSources.id,
        schema.contentDatabaseSourceFields.sourceId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSourceFields.propertyId, definition.id),
      ),
    );
  if (contentDatabaseSourceFieldsAllowLocalWrite(sourceFields)) return;
  throw new ActionContractError(
    `Property "${definition.name}" is not writable by database row mutations.`,
    {
      errorCode: "PROPERTY_NOT_WRITABLE",
      details: { propertyId: definition.id, propertyType: definition.type },
      statusCode: 400,
    },
  );
}

/** The stored text of a Blocks field kept apart from the page body. */
export async function readStoredBlocksField(
  db: ReturnType<typeof getDb>,
  documentId: string,
  propertyId: string,
): Promise<string> {
  const field = firstRow(
    await db
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(schema.documentBlockFieldContents.documentId, documentId),
          eq(schema.documentBlockFieldContents.propertyId, propertyId),
        ),
      ),
  );
  return field?.content ?? "";
}

/**
 * Writes a Blocks field kept apart from the page body as its next revision.
 * The caller holds the Collection's mutation lock and the page's row lock;
 * `expectedRevision` refuses the write when the field moved on since the
 * caller read it.
 */
export async function writeStoredBlocksField(
  db: ReturnType<typeof getDb>,
  args: {
    ownerEmail: string;
    documentId: string;
    propertyId: string;
    content: string;
    expectedRevision: number | undefined;
    now: string;
  },
): Promise<void> {
  const previousContent = await readStoredBlocksField(
    db,
    args.documentId,
    args.propertyId,
  );
  assertNoNewlySharedVideoIds(previousContent, args.content);
  await db
    .insert(schema.documentBlockFieldContents)
    .values({
      id: nanoid(),
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      propertyId: args.propertyId,
      content: args.content,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.documentBlockFieldContents.documentId,
        schema.documentBlockFieldContents.propertyId,
      ],
      set: { content: args.content, updatedAt: args.now },
    });
  await persistBlocksFieldIdentity({
    db,
    ownerEmail: args.ownerEmail,
    documentId: args.documentId,
    propertyId: args.propertyId,
    previousMarkdown: previousContent,
    markdown: args.content,
    expectedRevision: args.expectedRevision,
    now: args.now,
  });
}
