import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isBlocksPropertyType,
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import {
  databaseItemsPositionScope,
  documentsPositionScope,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid, normalizedValueJson } from "./_property-utils.js";

const upsertSchema = z.object({
  databaseId: z.string().min(1).describe("Target Content database ID"),
  keyPropertyId: z
    .string()
    .min(1)
    .describe("Database property definition ID used as the stable key"),
  keyValue: z.string().min(1).describe("Non-empty stable key value"),
  title: z
    .string()
    .max(500)
    .optional()
    .describe("Row title to create or update"),
  body: z.string().optional().describe("Row body to create or update"),
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Property values keyed by property definition ID"),
});

type Identity = { itemId: string; documentId: string };

export default defineAction({
  description:
    "Atomically create or update one Content database row by a database-scoped stable property key. Returns a created, updated, or unchanged receipt with stable item and document IDs.",
  schema: upsertSchema,
  run: async ({
    databaseId,
    keyPropertyId,
    keyValue,
    title,
    body,
    propertyValues,
  }) => {
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found.`);
    if (database.systemRole === "workspaces")
      throw new Error("Use create-content-space to add a workspace.");

    const access = await assertAccess(
      "document",
      database.documentId,
      "editor",
    );
    const databaseDocument = access.resource;
    const databaseSpaceId = database.spaceId ?? databaseDocument.spaceId;
    if (!databaseSpaceId)
      throw new Error("Database does not belong to a Content space.");
    if (
      database.spaceId &&
      databaseDocument.spaceId &&
      database.spaceId !== databaseDocument.spaceId
    ) {
      throw new Error(
        `Database "${databaseId}" has inconsistent Content space.`,
      );
    }

    const definitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
          eq(
            schema.documentPropertyDefinitions.ownerEmail,
            database.ownerEmail,
          ),
        ),
      );
    const definitionsById = new Map(
      definitions.map((definition) => [definition.id, definition]),
    );
    const keyDefinition = definitionsById.get(keyPropertyId);
    if (!keyDefinition)
      throw new Error(
        `Key property "${keyPropertyId}" does not belong to database "${databaseId}".`,
      );
    const keyType = keyDefinition.type as DocumentPropertyType;
    if (
      keyDefinition.systemRole ||
      isComputedPropertyType(keyType) ||
      isBlocksPropertyType(keyType)
    ) {
      throw new Error(
        `Property "${keyDefinition.name}" cannot be used as a stable key.`,
      );
    }
    const keyValueJson = normalizedValueJson(keyType, keyValue);
    if (keyValueJson === "null" || keyValueJson === '\"\"')
      throw new Error("Stable key value must normalize to a non-empty value.");

    const values = new Map<string, string>();
    for (const [propertyId, value] of Object.entries(propertyValues ?? {})) {
      const definition = definitionsById.get(propertyId);
      if (!definition)
        throw new Error(
          `Property "${propertyId}" does not belong to database "${databaseId}".`,
        );
      const type = definition.type as DocumentPropertyType;
      if (
        definition.systemRole ||
        isComputedPropertyType(type) ||
        isBlocksPropertyType(type)
      ) {
        throw new Error(
          `Property "${definition.name}" cannot be written by this action.`,
        );
      }
      const valueJson = normalizedValueJson(type, value);
      if (propertyId === keyPropertyId && valueJson !== keyValueJson) {
        throw new Error(
          "propertyValues must not change keyPropertyId away from keyValue.",
        );
      }
      values.set(propertyId, valueJson);
    }
    values.set(keyPropertyId, keyValueJson);

    const now = new Date().toISOString();
    const proposed: Identity = { itemId: nanoid(), documentId: nanoid() };
    const inheritedShares = await db
      .select({
        principalType: schema.documentShares.principalType,
        principalId: schema.documentShares.principalId,
        role: schema.documentShares.role,
      })
      .from(schema.documentShares)
      .where(eq(schema.documentShares.resourceId, database.documentId));

    const result = await withPositionLock(
      documentsPositionScope(database.ownerEmail, database.documentId),
      () =>
        withPositionLock(databaseItemsPositionScope(databaseId), () =>
          db.transaction(async (tx) => {
            const matches = await tx
              .select({
                itemId: schema.contentDatabaseItems.id,
                documentId: schema.contentDatabaseItems.documentId,
                trashedAt: schema.documents.trashedAt,
              })
              .from(schema.documentPropertyValues)
              .innerJoin(
                schema.contentDatabaseItems,
                eq(
                  schema.contentDatabaseItems.documentId,
                  schema.documentPropertyValues.documentId,
                ),
              )
              .innerJoin(
                schema.documents,
                eq(schema.documents.id, schema.contentDatabaseItems.documentId),
              )
              .where(
                and(
                  eq(schema.contentDatabaseItems.databaseId, databaseId),
                  eq(schema.documentPropertyValues.propertyId, keyPropertyId),
                  eq(schema.documentPropertyValues.valueJson, keyValueJson),
                ),
              );
            const matchByDocument = new Map(
              matches.map((row) => [row.documentId, row]),
            );
            if (matches.some((row) => row.trashedAt))
              throw new Error(
                "Stable key belongs to a trashed database row; restore or resolve it before upserting.",
              );
            if (
              matches.length !== matchByDocument.size ||
              matchByDocument.size > 1
            ) {
              throw new Error(
                "Stable key matches multiple database rows; reconcile the duplicates before upserting.",
              );
            }

            const [claim] = await tx
              .select()
              .from(schema.contentDatabaseItemKeyClaims)
              .where(
                and(
                  eq(
                    schema.contentDatabaseItemKeyClaims.databaseId,
                    databaseId,
                  ),
                  eq(
                    schema.contentDatabaseItemKeyClaims.propertyId,
                    keyPropertyId,
                  ),
                  eq(
                    schema.contentDatabaseItemKeyClaims.keyValueJson,
                    keyValueJson,
                  ),
                ),
              );
            let identity: Identity | undefined = claim && {
              itemId: claim.itemId,
              documentId: claim.documentId,
            };
            const matched = [...matchByDocument.values()][0];
            if (
              claim &&
              matched &&
              (claim.itemId !== matched.itemId ||
                claim.documentId !== matched.documentId)
            ) {
              throw new Error(
                "Stable key claim conflicts with the stored property value; reconcile before upserting.",
              );
            }
            if (claim && !matched) {
              throw new Error(
                "Stable key claim no longer matches the stored key property; reconcile before upserting.",
              );
            }

            if (!identity && matched) {
              const candidate = {
                itemId: matched.itemId,
                documentId: matched.documentId,
              };
              await tx
                .insert(schema.contentDatabaseItemKeyClaims)
                .values({
                  id: nanoid(),
                  ownerEmail: database.ownerEmail,
                  orgId: database.orgId,
                  databaseId,
                  propertyId: keyPropertyId,
                  keyValueJson,
                  ...candidate,
                  createdAt: now,
                  updatedAt: now,
                })
                .onConflictDoNothing();
              const [reloaded] = await tx
                .select()
                .from(schema.contentDatabaseItemKeyClaims)
                .where(
                  and(
                    eq(
                      schema.contentDatabaseItemKeyClaims.databaseId,
                      databaseId,
                    ),
                    eq(
                      schema.contentDatabaseItemKeyClaims.propertyId,
                      keyPropertyId,
                    ),
                    eq(
                      schema.contentDatabaseItemKeyClaims.keyValueJson,
                      keyValueJson,
                    ),
                  ),
                );
              if (
                !reloaded ||
                reloaded.itemId !== candidate.itemId ||
                reloaded.documentId !== candidate.documentId
              ) {
                throw new Error(
                  "Stable key was claimed by a different row; reconcile before upserting.",
                );
              }
              identity = candidate;
            }

            if (!identity) {
              await tx
                .insert(schema.contentDatabaseItemKeyClaims)
                .values({
                  id: nanoid(),
                  ownerEmail: database.ownerEmail,
                  orgId: database.orgId,
                  databaseId,
                  propertyId: keyPropertyId,
                  keyValueJson,
                  ...proposed,
                  createdAt: now,
                  updatedAt: now,
                })
                .onConflictDoNothing();
              const [reloaded] = await tx
                .select()
                .from(schema.contentDatabaseItemKeyClaims)
                .where(
                  and(
                    eq(
                      schema.contentDatabaseItemKeyClaims.databaseId,
                      databaseId,
                    ),
                    eq(
                      schema.contentDatabaseItemKeyClaims.propertyId,
                      keyPropertyId,
                    ),
                    eq(
                      schema.contentDatabaseItemKeyClaims.keyValueJson,
                      keyValueJson,
                    ),
                  ),
                );
              if (!reloaded)
                throw new Error("Stable key claim could not be read back.");
              identity = {
                itemId: reloaded.itemId,
                documentId: reloaded.documentId,
              };
              if (
                identity.itemId === proposed.itemId &&
                identity.documentId === proposed.documentId
              ) {
                const [maxDoc] = await tx
                  .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
                  .from(schema.documents)
                  .where(
                    and(
                      eq(schema.documents.ownerEmail, database.ownerEmail),
                      eq(schema.documents.parentId, database.documentId),
                    ),
                  );
                const [maxItem] = await tx
                  .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
                  .from(schema.contentDatabaseItems)
                  .where(
                    eq(schema.contentDatabaseItems.databaseId, databaseId),
                  );
                await tx.insert(schema.documents).values({
                  id: proposed.documentId,
                  spaceId: databaseSpaceId,
                  ownerEmail: database.ownerEmail,
                  orgId: database.orgId,
                  parentId: database.documentId,
                  title: title?.trim() ?? "",
                  content: body ?? "",
                  icon: null,
                  position: (maxDoc?.max ?? -1) + 1,
                  isFavorite: 0,
                  hideFromSearch: databaseDocument.hideFromSearch ?? 0,
                  visibility: databaseDocument.visibility ?? "private",
                  createdAt: now,
                  updatedAt: now,
                });
                await tx.insert(schema.contentDatabaseItems).values({
                  id: proposed.itemId,
                  ownerEmail: database.ownerEmail,
                  orgId: database.orgId,
                  databaseId,
                  documentId: proposed.documentId,
                  position: (maxItem?.max ?? -1) + 1,
                  createdAt: now,
                  updatedAt: now,
                });
                await tx.insert(schema.documentPropertyValues).values(
                  [...values.entries()].map(([propertyId, valueJson]) => ({
                    id: nanoid(),
                    ownerEmail: database.ownerEmail,
                    documentId: proposed.documentId,
                    propertyId,
                    valueJson,
                    createdAt: now,
                    updatedAt: now,
                  })),
                );
                if (inheritedShares.length > 0)
                  await tx.insert(schema.documentShares).values(
                    inheritedShares.map((share) => ({
                      id: nanoid(),
                      resourceId: proposed.documentId,
                      principalType: share.principalType,
                      principalId: share.principalId,
                      role: share.role,
                      createdBy: getRequestUserEmail() ?? database.ownerEmail,
                      createdAt: now,
                    })),
                  );
                await ensureDocumentFilesMembership(
                  tx,
                  proposed.documentId,
                  now,
                );
                return { status: "created" as const, ...identity };
              }
            }

            const [claimedMembership] = await tx
              .select({
                itemId: schema.contentDatabaseItems.id,
                documentId: schema.contentDatabaseItems.documentId,
              })
              .from(schema.contentDatabaseItems)
              .where(
                and(
                  eq(schema.contentDatabaseItems.id, identity.itemId),
                  eq(schema.contentDatabaseItems.databaseId, databaseId),
                  eq(
                    schema.contentDatabaseItems.documentId,
                    identity.documentId,
                  ),
                ),
              );
            if (!claimedMembership) {
              throw new Error(
                "Stable key claim does not resolve to a row in this database.",
              );
            }
            await assertAccess("document", identity.documentId, "editor");
            const [document] = await tx
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, identity.documentId));
            if (!document || document.trashedAt)
              throw new Error(
                "Stable key claim does not resolve to an active document.",
              );
            const existingValues = await tx
              .select()
              .from(schema.documentPropertyValues)
              .where(
                and(
                  eq(
                    schema.documentPropertyValues.documentId,
                    identity.documentId,
                  ),
                  inArray(schema.documentPropertyValues.propertyId, [
                    ...values.keys(),
                  ]),
                ),
              );
            const existingByProperty = new Map(
              existingValues.map((value) => [value.propertyId, value]),
            );
            if (existingValues.length !== existingByProperty.size)
              throw new Error(
                "Target row has duplicate property values; reconcile before upserting.",
              );
            const changedValues = [...values.entries()].filter(
              ([propertyId, valueJson]) =>
                existingByProperty.get(propertyId)?.valueJson !== valueJson,
            );
            const documentChanged =
              (title !== undefined && document.title !== title.trim()) ||
              (body !== undefined && document.content !== body);
            if (!documentChanged && changedValues.length === 0)
              return { status: "unchanged" as const, ...identity };
            if (documentChanged)
              await tx
                .update(schema.documents)
                .set({
                  ...(title !== undefined ? { title: title.trim() } : {}),
                  ...(body !== undefined ? { content: body } : {}),
                  updatedAt: now,
                })
                .where(eq(schema.documents.id, identity.documentId));
            for (const [propertyId, valueJson] of changedValues) {
              const existing = existingByProperty.get(propertyId);
              if (existing)
                await tx
                  .update(schema.documentPropertyValues)
                  .set({ valueJson, updatedAt: now })
                  .where(eq(schema.documentPropertyValues.id, existing.id));
              else
                await tx.insert(schema.documentPropertyValues).values({
                  id: nanoid(),
                  ownerEmail: database.ownerEmail,
                  documentId: identity.documentId,
                  propertyId,
                  valueJson,
                  createdAt: now,
                  updatedAt: now,
                });
            }
            await tx
              .delete(schema.contentDatabaseItemKeyClaims)
              .where(
                and(
                  eq(
                    schema.contentDatabaseItemKeyClaims.databaseId,
                    databaseId,
                  ),
                  eq(
                    schema.contentDatabaseItemKeyClaims.propertyId,
                    keyPropertyId,
                  ),
                  eq(
                    schema.contentDatabaseItemKeyClaims.documentId,
                    identity.documentId,
                  ),
                  ne(
                    schema.contentDatabaseItemKeyClaims.keyValueJson,
                    keyValueJson,
                  ),
                ),
              );
            return { status: "updated" as const, ...identity };
          }),
        ),
    );

    await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {});
    const readback = await getContentDatabaseResponse(databaseId, {
      limit: 2,
      offset: 0,
      documentIds: [result.documentId],
    });
    const readbackItem = readback.items[0];
    const readbackKey = readbackItem?.properties.find(
      (property) => property.definition.id === keyPropertyId,
    );
    const [verifiedDocument] = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        content: schema.documents.content,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, result.documentId));
    if (
      readback.items.length !== 1 ||
      readbackItem?.id !== result.itemId ||
      verifiedDocument?.id !== result.documentId ||
      readbackKey?.value !== JSON.parse(keyValueJson) ||
      (title !== undefined && verifiedDocument.title !== title.trim()) ||
      (body !== undefined && verifiedDocument.content !== body)
    )
      throw new Error(
        "Stable key upsert could not verify its exact requested row readback.",
      );
    return {
      ...result,
      databaseId,
      keyPropertyId,
      keyValue,
      readback: { items: readback.items, pagination: readback.pagination },
    };
  },
});
