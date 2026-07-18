import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  parsePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { assertAtomicSubmissionReady } from "./_content-database-validation.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import {
  appendContentWorkflowEvent,
  wakeContentWorkflowEvent,
} from "./_content-workflow.js";
import {
  databaseItemsPositionScope,
  documentsPositionScope,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid, parseDatabaseViewConfig } from "./_property-utils.js";

type PropertyDefinition =
  typeof schema.documentPropertyDefinitions.$inferSelect;

export interface CommitContentDatabaseItemInput {
  databaseId: string;
  title?: string;
  values: ReadonlyMap<string, DocumentPropertyValue>;
  intent: "draft" | "submitted";
  formViewId?: string;
  actionContext?: ActionRunContext;
}

export interface CommitContentDatabaseItemResult {
  databaseId: string;
  itemId: string;
  documentId: string;
  workflowEventId: string | null;
  verified: true;
}

function partitionValues(
  definitions: PropertyDefinition[],
  values: ReadonlyMap<string, DocumentPropertyValue>,
) {
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  for (const propertyId of values.keys()) {
    if (!definitionById.has(propertyId)) {
      throw new Error(
        `Property "${propertyId}" does not belong to this database.`,
      );
    }
  }
  const primaryBlocks = definitions.find((definition) => {
    const type = definition.type as DocumentPropertyType;
    return (
      isBlocksPropertyType(type) &&
      blocksStorageTarget(parsePropertyOptions(definition.optionsJson)) ===
        "document_body"
    );
  });
  const standardValues = [...values.entries()].filter(([propertyId]) => {
    const definition = definitionById.get(propertyId)!;
    return !isBlocksPropertyType(definition.type as DocumentPropertyType);
  });
  const additionalBlocks = [...values.entries()].filter(([propertyId]) => {
    const definition = definitionById.get(propertyId)!;
    return (
      isBlocksPropertyType(definition.type as DocumentPropertyType) &&
      propertyId !== primaryBlocks?.id
    );
  });
  const primaryValue = primaryBlocks ? values.get(primaryBlocks.id) : undefined;
  return {
    documentContent: typeof primaryValue === "string" ? primaryValue : "",
    standardValues,
    additionalBlocks,
  };
}

export async function commitContentDatabaseItem(
  input: CommitContentDatabaseItemInput,
): Promise<CommitContentDatabaseItemResult> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, input.databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!database) throw new Error(`Database "${input.databaseId}" not found.`);

  const access = await assertAccess("document", database.documentId, "editor");
  const databaseDocument = access.resource;
  if (
    database.spaceId &&
    databaseDocument.spaceId &&
    databaseDocument.spaceId !== database.spaceId
  ) {
    throw new Error(
      `Database "${input.databaseId}" has inconsistent Content space`,
    );
  }
  const databaseSpaceId =
    database.spaceId ?? (databaseDocument.spaceId as string | null);
  if (!databaseSpaceId) {
    throw new Error("Database does not belong to a Content space.");
  }

  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, input.databaseId),
        eq(schema.documentPropertyDefinitions.ownerEmail, database.ownerEmail),
      ),
    );
  if (input.intent === "submitted") {
    assertAtomicSubmissionReady({
      databaseId: input.databaseId,
      config: parseDatabaseViewConfig(database.viewConfigJson),
      definitions,
      values: input.values,
    });
  }
  const { documentContent, standardValues, additionalBlocks } = partitionValues(
    definitions,
    input.values,
  );
  const normalizedTitle = input.title?.trim() ?? "";
  const documentId = nanoid();
  const itemId = nanoid();
  const now = new Date().toISOString();
  const createdBy = getRequestUserEmail() ?? database.ownerEmail;

  let workflowEventId: string | null = null;
  await withPositionLock(
    documentsPositionScope(database.ownerEmail, database.documentId),
    () =>
      withPositionLock(
        databaseItemsPositionScope(input.databaseId),
        async () => {
          await db.transaction(async (tx) => {
            const [maxDocumentPosition] = await tx
              .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
              .from(schema.documents)
              .where(
                and(
                  eq(schema.documents.ownerEmail, database.ownerEmail),
                  eq(schema.documents.parentId, database.documentId),
                ),
              );
            const [maxItemPosition] = await tx
              .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
              .from(schema.contentDatabaseItems)
              .where(
                eq(schema.contentDatabaseItems.databaseId, input.databaseId),
              );
            const inheritedShares = await tx
              .select({
                principalType: schema.documentShares.principalType,
                principalId: schema.documentShares.principalId,
                role: schema.documentShares.role,
              })
              .from(schema.documentShares)
              .where(eq(schema.documentShares.resourceId, database.documentId));

            if (!database.spaceId) {
              await tx
                .update(schema.contentDatabases)
                .set({ spaceId: databaseSpaceId, updatedAt: now })
                .where(eq(schema.contentDatabases.id, input.databaseId));
            }
            if (!databaseDocument.spaceId) {
              await tx
                .update(schema.documents)
                .set({ spaceId: databaseSpaceId, updatedAt: now })
                .where(eq(schema.documents.id, database.documentId));
              await ensureDocumentFilesMembership(tx, database.documentId, now);
            }

            await tx.insert(schema.documents).values({
              id: documentId,
              spaceId: databaseSpaceId,
              ownerEmail: database.ownerEmail,
              orgId: database.orgId,
              parentId: database.documentId,
              title: normalizedTitle,
              content: documentContent,
              icon: null,
              position: (maxDocumentPosition?.max ?? -1) + 1,
              isFavorite: 0,
              hideFromSearch: databaseDocument.hideFromSearch ?? 0,
              visibility: databaseDocument.visibility ?? "private",
              createdAt: now,
              updatedAt: now,
            });
            await tx.insert(schema.contentDatabaseItems).values({
              id: itemId,
              ownerEmail: database.ownerEmail,
              orgId: database.orgId,
              databaseId: input.databaseId,
              documentId,
              position: (maxItemPosition?.max ?? -1) + 1,
              createdAt: now,
              updatedAt: now,
            });
            if (inheritedShares.length > 0) {
              await tx.insert(schema.documentShares).values(
                inheritedShares.map((share) => ({
                  id: nanoid(),
                  resourceId: documentId,
                  principalType: share.principalType,
                  principalId: share.principalId,
                  role: share.role,
                  createdBy,
                  createdAt: now,
                })),
              );
            }
            if (standardValues.length > 0) {
              await tx.insert(schema.documentPropertyValues).values(
                standardValues.map(([propertyId, value]) => ({
                  id: nanoid(),
                  ownerEmail: database.ownerEmail,
                  documentId,
                  propertyId,
                  valueJson: serializePropertyValue(value),
                  createdAt: now,
                  updatedAt: now,
                })),
              );
            }
            if (additionalBlocks.length > 0) {
              await tx.insert(schema.documentBlockFieldContents).values(
                additionalBlocks.map(([propertyId, value]) => ({
                  id: nanoid(),
                  ownerEmail: database.ownerEmail,
                  documentId,
                  propertyId,
                  content: typeof value === "string" ? value : "",
                  createdAt: now,
                  updatedAt: now,
                })),
              );
            }
            await ensureDocumentFilesMembership(tx, documentId, now);

            if (input.intent === "submitted") {
              workflowEventId = await appendContentWorkflowEvent(tx, {
                topic: "content.database.item.submitted",
                subjectType: "content_database_item",
                subjectId: documentId,
                databaseId: input.databaseId,
                documentId,
                ownerEmail: database.ownerEmail,
                orgId: database.orgId,
                occurredAt: now,
                actionContext: input.actionContext,
                payload: {
                  itemId,
                  ...(input.formViewId ? { formViewId: input.formViewId } : {}),
                  title: normalizedTitle,
                  propertyValues: Object.fromEntries(standardValues),
                  personPropertyIds: definitions
                    .filter((definition) => definition.type === "person")
                    .map((definition) => definition.id),
                },
              });
            }

            const [savedDocument] = await tx
              .select({
                title: schema.documents.title,
                content: schema.documents.content,
              })
              .from(schema.documents)
              .where(eq(schema.documents.id, documentId));
            const [savedItem] = await tx
              .select({ id: schema.contentDatabaseItems.id })
              .from(schema.contentDatabaseItems)
              .where(
                and(
                  eq(schema.contentDatabaseItems.id, itemId),
                  eq(schema.contentDatabaseItems.documentId, documentId),
                  eq(schema.contentDatabaseItems.databaseId, input.databaseId),
                ),
              );
            const savedValues =
              standardValues.length === 0
                ? []
                : await tx
                    .select({
                      propertyId: schema.documentPropertyValues.propertyId,
                      valueJson: schema.documentPropertyValues.valueJson,
                    })
                    .from(schema.documentPropertyValues)
                    .where(
                      and(
                        eq(
                          schema.documentPropertyValues.documentId,
                          documentId,
                        ),
                        inArray(
                          schema.documentPropertyValues.propertyId,
                          standardValues.map(([propertyId]) => propertyId),
                        ),
                      ),
                    );
            const savedValueByPropertyId = new Map(
              savedValues.map((value) => [value.propertyId, value.valueJson]),
            );
            const savedBlocks =
              additionalBlocks.length === 0
                ? []
                : await tx
                    .select({
                      propertyId: schema.documentBlockFieldContents.propertyId,
                      content: schema.documentBlockFieldContents.content,
                    })
                    .from(schema.documentBlockFieldContents)
                    .where(
                      and(
                        eq(
                          schema.documentBlockFieldContents.documentId,
                          documentId,
                        ),
                        inArray(
                          schema.documentBlockFieldContents.propertyId,
                          additionalBlocks.map(([propertyId]) => propertyId),
                        ),
                      ),
                    );
            const savedBlockByPropertyId = new Map(
              savedBlocks.map((value) => [value.propertyId, value.content]),
            );
            const verified =
              savedDocument?.title === normalizedTitle &&
              savedDocument.content === documentContent &&
              Boolean(savedItem) &&
              standardValues.every(
                ([propertyId, value]) =>
                  savedValueByPropertyId.get(propertyId) ===
                  serializePropertyValue(value),
              ) &&
              additionalBlocks.every(
                ([propertyId, value]) =>
                  savedBlockByPropertyId.get(propertyId) ===
                  (typeof value === "string" ? value : ""),
              );
            if (!verified) {
              throw new Error(
                "The database item mutation could not be verified; no row was saved.",
              );
            }
          });
        },
      ),
  );

  if (workflowEventId) wakeContentWorkflowEvent(workflowEventId);
  return {
    databaseId: input.databaseId,
    itemId,
    documentId,
    workflowEventId,
    verified: true,
  };
}
