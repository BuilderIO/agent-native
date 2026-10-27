import { ActionContractError } from "@agent-native/core";
import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockLegacyBodyWrites } from "../server/lib/document-body-revision.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { firstRow } from "../server/lib/first-row.js";
import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import { assertNoNewlySharedVideoIds } from "../server/lib/video-block-ids.js";
import { CONTENT_LIVE_COPY_EDITS } from "../server/live-copy/binding.js";
import { drizzleOverExec } from "../server/live-copy/exec-db.js";
import {
  editContentLiveCopy,
  liveCopyBaseChanged,
  liveCopyWriteLeftPath,
  unrepresentableBodyError,
} from "../server/live-copy/write.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  parsePropertyValue,
  serializePropertyValue,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  BlocksFieldRevisionConflictError,
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
  readBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import {
  assertPropertyWritableByRowMutation,
  writeStoredBlocksField,
} from "./_blocks-field-write.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  contentChangeActor,
  enqueuePropertyChangeWebhooks,
  scheduleContentWebhookDelivery,
} from "./_content-webhooks.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { assertEditableDocument } from "./_document-edit-mutation.js";
import { NFM_CONTAINER_SYNTAX } from "./_nfm-syntax.js";
import {
  assertPropertyGenerations,
  propertyChangeIdOf,
  propertyChangeIdsFor,
  propertyGenerationsFor,
  readPropertyGenerations,
  readPropertyTombstones,
  readWrittenPropertyChangeIds,
  storedPropertyGenerations,
  type StoredPropertyChangeIds,
} from "./_property-generations.js";
import {
  getDatabaseById,
  listPropertiesForDatabaseDocuments,
  nanoid,
  normalizedValueJson,
} from "./_property-utils.js";
import { validateRelationWrite } from "./_relation-values.js";
import { lockDocumentRows } from "./_row-lock-order.js";

/**
 * Writes a primary Blocks value, which is the page's body, to a switched page
 * through its live copy, as edit-document does; the live copy's commit keeps
 * the identity of every primary Blocks field the page has. Returns the body
 * the commit stored, which the live copy writes in its own canonical form.
 * False when the page isn't switched, left its live copy before anything
 * committed, or already has this body, which the legacy path lets through
 * unchanged.
 */
async function setPrimaryBlocksThroughLiveCopy(args: {
  ctx: ActionRunContext | undefined;
  documentId: string;
  databaseId: string;
  definition: typeof schema.documentPropertyDefinitions.$inferSelect;
  propertyId: string;
  content: string;
  expectedRevision: number | undefined;
}): Promise<string | false> {
  if (!(await isLiveBodyWriterPage(args.documentId))) return false;
  // guard:allow-unscoped — the caller's editor access was checked above.
  const rows = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, args.documentId));
  const current = firstRow(rows);
  if (!current) {
    throw new ActionContractError(`Document "${args.documentId}" not found`, {
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (current.content === args.content) return false;
  assertNoNewlySharedVideoIds(current.content, args.content);
  if (args.expectedRevision !== undefined) {
    const { revision } = await readBlocksFieldIdentity({
      documentId: args.documentId,
      propertyId: args.propertyId,
      markdown: current.content,
    });
    // The commit checks the revision again under the page lock, so a body
    // that went A→B→A after this read is refused rather than overwritten.
    if (revision !== args.expectedRevision) {
      throw new BlocksFieldRevisionConflictError(
        `Blocks field revision conflict: expected ${args.expectedRevision}, current ${revision}`,
      );
    }
  }
  try {
    const result = await editContentLiveCopy(args.documentId, {
      cause: {
        ctx: args.ctx,
        operation: "set-document-property",
        lockCollections: [args.databaseId],
        ...(args.expectedRevision !== undefined
          ? {
              expectedBlocksFieldRevision: {
                propertyId: args.propertyId,
                revision: args.expectedRevision,
              },
            }
          : {}),
      },
      edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { content: args.content, expected: current.content },
      persist: async (tx) => {
        await assertAccess("document", args.documentId, "editor", {
          ...currentAccess(),
          transaction: tx,
        });
        const db = drizzleOverExec(tx);
        // The commit locked this collection, then the page's memberships,
        // before the page. A source-policy change locks the collection first,
        // so both reads hold until this commit ends.
        const primary = await db
          .select({ id: schema.contentDatabases.id })
          .from(schema.contentDatabaseItems)
          .innerJoin(
            schema.contentDatabases,
            eq(
              schema.contentDatabases.id,
              schema.contentDatabaseItems.databaseId,
            ),
          )
          .where(
            and(
              eq(schema.contentDatabaseItems.documentId, args.documentId),
              eq(schema.contentDatabaseItems.databaseId, args.databaseId),
              eq(
                schema.contentDatabases.primaryBlocksPropertyId,
                args.propertyId,
              ),
            ),
          )
          .limit(1);
        if (primary.length === 0) {
          throw new ActionContractError(
            "Primary Blocks membership changed before the operation completed.",
            { errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED", statusCode: 409 },
          );
        }
        await assertPropertyWritableByRowMutation(
          db,
          args.databaseId,
          args.definition,
        );
      },
    });
    return result.text;
  } catch (error) {
    if (liveCopyBaseChanged(error)) {
      throw new ActionContractError(
        "The page changed before this value could be written. Read it again and retry.",
        { errorCode: "DOCUMENT_REVISION_CONFLICT", statusCode: 409 },
      );
    }
    if (liveCopyWriteLeftPath(error)) return false;
    throw unrepresentableBodyError(error) ?? error;
  }
}

export default defineAction({
  description:
    "Set one property value on a Content collection document, including an additional Blocks field. Blocks values are NFM: each line is a block, <br> inserts a hard break, and <empty-block/> preserves an empty paragraph. Plain CommonMark blank lines are not preserved.",
  mcpTool: true,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Set Content Document Property",
    description:
      "Delegate one property update on an existing Content collection document.",
  },
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Collection ID that owns the property; omit only for context-free entry points",
      ),
    propertyId: z.string().describe("Property definition ID"),
    value: z
      .unknown()
      .describe(
        "Value for the property type; Blocks fields take an NFM string: one block per line, <br> for hard breaks, <empty-block/> for empty paragraphs. " +
          NFM_CONTAINER_SYNTAX,
      ),
    expectedBlocksFieldRevision: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Expected Blocks field revision from list-content-database-blocks; required for Blocks field writes from anything other than the app's own UI (agents, CLI, automations, HTTP)",
      ),
    expectedGeneration: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Write only if the property's generation still equals this one, from propertyGenerations on get-document or get-content-database. A mismatch writes nothing and fails with PROPERTY_GENERATION_CONFLICT. Not for Blocks fields.",
      ),
  }),
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (
    {
      documentId,
      databaseId,
      propertyId,
      value,
      expectedBlocksFieldRevision,
      expectedGeneration,
    },
    ctx,
  ) => {
    const db = getDb();
    const [definition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    if (!definition) throw new Error(`Property "${propertyId}" not found`);
    if (!definition.databaseId) {
      throw new Error(`Property "${propertyId}" is not attached to a database`);
    }
    if (databaseId && definition.databaseId !== databaseId) {
      throw new Error(`Property "${propertyId}" not found`);
    }
    const database = await getDatabaseById(definition.databaseId);
    if (!database) throw new Error("Document database not found.");
    await assertAccess("document", database.documentId, "editor");
    if (definition.systemRole) {
      throw new Error("System properties are derived and cannot be edited.");
    }
    const access = await resolveContentDocumentAccess(documentId);
    if (!access) throw new Error(`Document "${documentId}" not found`);
    const document = access.resource;
    const [membership] = await db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, database.id),
          eq(schema.contentDatabaseItems.documentId, documentId),
        ),
      );
    if (!membership) throw new Error("Document is not part of this database.");
    const type = definition.type as DocumentPropertyType;
    if (isComputedPropertyType(type)) {
      throw new Error("Computed properties cannot be edited.");
    }

    const now = new Date().toISOString();

    if (isBlocksPropertyType(type)) {
      if (expectedGeneration !== undefined) {
        throw new ActionContractError(
          "Blocks fields are guarded by expectedBlocksFieldRevision, not expectedGeneration.",
          {
            errorCode: "PROPERTY_GENERATION_UNSUPPORTED",
            details: { propertyId },
            statusCode: 400,
          },
        );
      }
      // A whole-field write must name the revision it read, so a stale copy
      // can't replace newer text. Only the app's own UI (in the browser or an
      // MCP widget) and internal server calls without a caller are exempt;
      // agents, CLI runs, automations and HTTP requests are not.
      const isAppUiCaller =
        ctx?.caller === "frontend" ||
        ctx?.caller === "mcp-widget" ||
        ctx?.caller === "mcp-widget-write";
      if (
        ctx !== undefined &&
        !isAppUiCaller &&
        expectedBlocksFieldRevision === undefined
      ) {
        throw new ActionContractError(
          "Blocks field writes from outside the app require expectedBlocksFieldRevision from list-content-database-blocks.",
          {
            errorCode: "BLOCKS_FIELD_REVISION_REQUIRED",
            details: { propertyId },
            statusCode: 400,
          },
        );
      }
      await assertAccess("document", documentId, "editor");
      const normalized = normalizePropertyValue(type, value);
      const content = typeof normalized === "string" ? normalized : "";
      let target = blocksStorageTarget(
        parsePropertyOptions(definition.optionsJson),
      );
      const blocksResult = async (stored: string) => ({
        documentId,
        databaseId: database.id,
        properties:
          (
            await listPropertiesForDatabaseDocuments(
              database.id,
              [
                {
                  ...document,
                  content:
                    target === "document_body" ? stored : document.content,
                  updatedAt: now,
                },
              ],
              { includeBlocksFieldIdentity: true },
            )
          ).get(documentId) ?? [],
      });
      const stored =
        target === "document_body" &&
        (await setPrimaryBlocksThroughLiveCopy({
          ctx,
          documentId,
          databaseId: database.id,
          definition,
          propertyId,
          content,
          expectedRevision: expectedBlocksFieldRevision,
        }));
      if (stored !== false) return blocksResult(stored);
      await db.transaction(async (tx) => {
        await lockContentDatabaseMutation(
          tx as unknown as ReturnType<typeof getDb>,
          database.id,
        );
        const primaryBlocksFields = await lockPrimaryBlocksFields(
          tx as unknown as ReturnType<typeof getDb>,
          documentId,
        );
        // A Blocks value is the page's body or one of its fields, so a page
        // in Trash refuses it as edit-document does.
        await lockDocumentRows(tx as unknown as ReturnType<typeof getDb>, [
          documentId,
        ]);
        const [lockedPage] = await tx
          .select({ trashedAt: schema.documents.trashedAt })
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId));
        assertEditableDocument(lockedPage);
        const [lockedDefinition] = await tx
          .select()
          .from(schema.documentPropertyDefinitions)
          .where(eq(schema.documentPropertyDefinitions.id, propertyId));
        const [lockedMembership] = await tx
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .where(
            and(
              eq(schema.contentDatabaseItems.id, membership.id),
              eq(schema.contentDatabaseItems.databaseId, database.id),
              eq(schema.contentDatabaseItems.documentId, documentId),
            ),
          );
        if (!lockedDefinition || lockedDefinition.databaseId !== database.id) {
          throw new Error(`Property "${propertyId}" not found`);
        }
        if (!lockedMembership) {
          throw new Error("Document is not part of this database.");
        }
        if (
          !isBlocksPropertyType(lockedDefinition.type as DocumentPropertyType)
        ) {
          throw new Error(
            "Property type changed before the operation completed.",
          );
        }
        await assertPropertyWritableByRowMutation(
          tx as unknown as ReturnType<typeof getDb>,
          database.id,
          lockedDefinition,
        );
        target = blocksStorageTarget(
          parsePropertyOptions(lockedDefinition.optionsJson),
        );
        if (target === "block_field_store") {
          await writeStoredBlocksField(
            tx as unknown as ReturnType<typeof getDb>,
            {
              ownerEmail: database.ownerEmail,
              documentId,
              propertyId,
              content,
              expectedRevision: expectedBlocksFieldRevision,
              now,
            },
          );
          return;
        }
        const legacy = await lockLegacyBodyWrites(tx, [documentId], {
          operation: "set-document-property",
          content,
        });
        const [currentDocument] = await tx
          .select({ content: schema.documents.content })
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId));
        if (!currentDocument) {
          throw new Error(`Document "${documentId}" not found`);
        }
        const previousContent = currentDocument.content;
        assertNoNewlySharedVideoIds(previousContent, content);
        await tx
          .update(schema.documents)
          .set({
            content,
            bodyRevision: legacy.bodyRevision(content),
            updatedAt: now,
          })
          .where(eq(schema.documents.id, documentId));
        if (
          !primaryBlocksFields.some((field) => field.propertyId === propertyId)
        ) {
          throw new Error(
            "Primary Blocks membership changed before the operation completed.",
          );
        }
        for (const field of primaryBlocksFields) {
          await persistBlocksFieldIdentity({
            db: tx as unknown as ReturnType<typeof getDb>,
            ownerEmail: field.ownerEmail,
            documentId,
            propertyId: field.propertyId,
            previousMarkdown: previousContent,
            markdown: content,
            expectedRevision:
              field.propertyId === propertyId
                ? expectedBlocksFieldRevision
                : undefined,
            now,
          });
        }
      });
      return blocksResult(content);
    }

    let valueJson = normalizedValueJson(type, value);
    let webhookEvents = 0;
    let generation = 0;
    let changeId: number | null = null;
    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      const [lockedDatabase] = await tx
        .select({
          id: schema.contentDatabases.id,
          naturalKeyPropertyId: schema.contentDatabases.naturalKeyPropertyId,
        })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.id, database.id),
            eq(schema.contentDatabases.documentId, database.documentId),
            eq(schema.contentDatabases.ownerEmail, database.ownerEmail),
            isNull(schema.contentDatabases.deletedAt),
          ),
        );
      if (!lockedDatabase) throw new Error("Database is no longer active.");
      await lockDatabaseMemberships(tx, [membership.id]);
      const [lockedDefinition] = await tx
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));
      const [lockedMembership] = await tx
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.id, membership.id),
            eq(schema.contentDatabaseItems.databaseId, database.id),
            eq(schema.contentDatabaseItems.documentId, documentId),
          ),
        );
      if (!lockedDefinition || lockedDefinition.databaseId !== database.id) {
        throw new Error(`Property "${propertyId}" not found`);
      }
      if (!lockedMembership) {
        throw new Error("Document is not part of this database.");
      }
      const lockedType = lockedDefinition.type as DocumentPropertyType;
      if (lockedType !== type) {
        throw new Error(
          "Property type changed before the operation completed.",
        );
      }
      if (isBlocksPropertyType(lockedType)) {
        throw new Error(
          "Property type changed before the operation completed.",
        );
      }
      if (isComputedPropertyType(lockedType)) {
        throw new Error("Computed properties cannot be edited.");
      }
      await assertPropertyWritableByRowMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
        lockedDefinition,
      );
      if (expectedGeneration !== undefined) {
        await assertPropertyGenerations(
          tx as unknown as ReturnType<typeof getDb>,
          documentId,
          { [propertyId]: expectedGeneration },
        );
      }
      if (lockedType === "relation") {
        const [stored] = await tx
          .select({ valueJson: schema.documentPropertyValues.valueJson })
          .from(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.documentId, documentId),
              eq(schema.documentPropertyValues.propertyId, propertyId),
            ),
          );
        const ids = await validateRelationWrite(tx, {
          definition: lockedDefinition,
          nextValue: value,
          previousValue: parsePropertyValue(stored?.valueJson),
        });
        valueJson = serializePropertyValue(ids);
      }
      const isNaturalKey = lockedDatabase.naturalKeyPropertyId === propertyId;
      if (isNaturalKey) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(valueJson);
        } catch {
          parsed = null;
        }
        if (typeof parsed !== "string" || !parsed.trim()) {
          throw new ActionContractError(
            "A database natural key must remain a non-empty string.",
            { errorCode: "INVALID_NATURAL_KEY", statusCode: 400 },
          );
        }
        const [existingNaturalKeyClaim] = await tx
          .select({
            keyValueJson: schema.contentDatabaseItemKeyClaims.keyValueJson,
          })
          .from(schema.contentDatabaseItemKeyClaims)
          .where(
            and(
              eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
              eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
              eq(schema.contentDatabaseItemKeyClaims.documentId, documentId),
            ),
          )
          .limit(1);
        if (
          existingNaturalKeyClaim &&
          existingNaturalKeyClaim.keyValueJson !== valueJson
        ) {
          throw new ActionContractError(
            "A claimed database natural key cannot be changed. Create a new row instead.",
            { errorCode: "NATURAL_KEY_IMMUTABLE", statusCode: 409 },
          );
        }
      }
      const [conflictingClaim] = await tx
        .select({ id: schema.contentDatabaseItemKeyClaims.id })
        .from(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
            eq(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
            ne(schema.contentDatabaseItemKeyClaims.documentId, documentId),
          ),
        )
        .limit(1);
      if (conflictingClaim) {
        throw new Error(
          "This value is already claimed as another row's stable key.",
        );
      }
      const existing = firstRow(
        await tx
          .select({
            id: schema.documentPropertyValues.id,
            valueJson: schema.documentPropertyValues.valueJson,
          })
          .from(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.documentId, documentId),
              eq(schema.documentPropertyValues.propertyId, propertyId),
            ),
          ),
      );
      if (existing) {
        await tx
          .update(schema.documentPropertyValues)
          .set({ valueJson, updatedAt: now })
          .where(eq(schema.documentPropertyValues.id, existing.id));
      } else {
        await tx.insert(schema.documentPropertyValues).values({
          id: nanoid(),
          ownerEmail: database.ownerEmail,
          documentId,
          propertyId,
          valueJson,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (isNaturalKey) {
        await tx
          .insert(schema.contentDatabaseItemKeyClaims)
          .values({
            id: nanoid(),
            ownerEmail: database.ownerEmail,
            orgId: database.orgId,
            databaseId: database.id,
            propertyId,
            keyValueJson: valueJson,
            itemId: membership.id,
            documentId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        const [claim] = await tx
          .select({
            itemId: schema.contentDatabaseItemKeyClaims.itemId,
            documentId: schema.contentDatabaseItemKeyClaims.documentId,
          })
          .from(schema.contentDatabaseItemKeyClaims)
          .where(
            and(
              eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
              eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
              eq(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
            ),
          );
        if (
          !claim ||
          claim.itemId !== membership.id ||
          claim.documentId !== documentId
        ) {
          throw new Error(
            "This natural key is already claimed by another database row.",
          );
        }
      }
      await tx
        .delete(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
            eq(schema.contentDatabaseItemKeyClaims.documentId, documentId),
            ne(schema.contentDatabaseItemKeyClaims.keyValueJson, valueJson),
          ),
        );
      webhookEvents = await enqueuePropertyChangeWebhooks(
        tx as unknown as ReturnType<typeof getDb>,
        {
          databaseId: database.id,
          rows: [
            {
              documentId,
              changes: [
                {
                  definition: lockedDefinition,
                  oldValueJson: existing?.valueJson,
                  newValueJson: valueJson,
                },
              ],
            },
          ],
          actor: contentChangeActor(ctx),
        },
      );
      // Read before commit, while this write still holds the value's row, so
      // a later writer's generation can't be returned as this one's.
      generation = (
        await readPropertyGenerations(
          tx as unknown as ReturnType<typeof getDb>,
          [documentId],
          { propertyIds: [propertyId] },
        )
      ).of(documentId, propertyId);
      changeId = propertyChangeIdOf(
        await readWrittenPropertyChangeIds(
          tx as unknown as ReturnType<typeof getDb>,
          [documentId],
          [propertyId],
        ),
        documentId,
        propertyId,
      );
    });
    if (webhookEvents) scheduleContentWebhookDelivery();

    // `generation` and `changeId` are this write's. The page is read after
    // commit, so it carries its own maps from the same read; a write that
    // landed in between shows there.
    const tombstones = await readPropertyTombstones(db, [documentId]);
    const changeIds: StoredPropertyChangeIds = new Map();
    const properties =
      (
        await listPropertiesForDatabaseDocuments(database.id, [document], {
          includeBlocksFieldIdentity: true,
          changeIds,
        })
      ).get(documentId) ?? [];
    return {
      documentId,
      databaseId: database.id,
      generation,
      changeId,
      properties,
      propertyGenerations: propertyGenerationsFor(
        documentId,
        properties,
        storedPropertyGenerations(changeIds, tombstones),
      ),
      propertyChangeIds: propertyChangeIdsFor(
        documentId,
        properties,
        changeIds,
      ),
    };
  },
});
