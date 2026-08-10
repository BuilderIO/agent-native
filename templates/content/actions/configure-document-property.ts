import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CREATABLE_DOCUMENT_PROPERTY_TYPES,
  DOCUMENT_PROPERTY_VISIBILITIES,
  isBlocksPropertyType,
  isComputedPropertyType,
  isPrimaryBlocksField,
  parsePropertyOptions,
  serializePropertyOptions,
  normalizePropertyVisibility,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  propertyDefinitionsPositionScope,
  withPositionLock,
} from "./_position-utils.js";
import {
  listPropertiesForDocument,
  nanoid,
  optionsForNewProperty,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Create or update a Notion-style property definition for content documents.",
  schema: z.object({
    id: z.string().optional().describe("Existing property definition ID"),
    documentId: z
      .string()
      .describe("Document ID used to scope the property workspace"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Database ID that owns the property; omit only for context-free entry points",
      ),
    name: z.string().min(1).describe("Property name"),
    description: z
      .string()
      .optional()
      .describe(
        "Stable guidance describing what this property means and which value belongs here",
      ),
    type: z.enum(CREATABLE_DOCUMENT_PROPERTY_TYPES).describe("Property type"),
    naturalKey: z
      .boolean()
      .optional()
      .describe(
        "Declare or clear this ordinary text property as the database's single natural key",
      ),
    visibility: z
      .enum(DOCUMENT_PROPERTY_VISIBILITIES)
      .optional()
      .describe("When this property should appear on document pages"),
    options: z
      .object({
        options: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              color: z.string(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        formula: z.string().optional(),
        relation: z
          .object({
            databaseId: z.string().nullable().optional(),
          })
          .optional(),
        rollup: z
          .object({
            relationPropertyId: z.string().nullable().optional(),
            targetPropertyId: z.string().nullable().optional(),
            aggregation: z
              .enum([
                "count",
                "count_values",
                "count_unique",
                "sum",
                "average",
                "min",
                "max",
              ])
              .optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        "Select/status/multi-select options, formula expression, relation target, or rollup config",
      ),
  }),
  run: async (args) => {
    const access = await assertAccess("document", args.documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const now = new Date().toISOString();
    const name = args.name.trim();
    const type = args.type as DocumentPropertyType;
    const propertyId = args.id ?? nanoid();
    const optionsJson = optionsForNewProperty(type, args.options as any);
    const database = await resolvePropertyDatabaseForDocument(
      document,
      args.databaseId,
      "editor",
    );
    if (!database) {
      throw new Error(
        "Properties belong to databases. Create or open a database before adding properties.",
      );
    }
    if (args.naturalKey === true && type !== "text") {
      throw new Error(
        "A database natural key must be an ordinary text property.",
      );
    }
    if (args.naturalKey !== undefined && database.systemRole) {
      throw new Error("System databases cannot configure a natural key.");
    }

    if (args.id) {
      const [existing] = await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.id, args.id),
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              document.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
      if (!existing) throw new Error(`Property "${args.id}" not found`);
      await db.transaction(async (tx) => {
        await lockContentDatabaseMutation(
          tx as unknown as ReturnType<typeof getDb>,
          database.id,
        );
        const [lockedDatabase] = await tx
          .select()
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, database.id));
        if (!lockedDatabase) throw new Error("Database not found.");
        let [lockedDefinition] = await tx
          .select()
          .from(schema.documentPropertyDefinitions)
          .where(
            and(
              eq(schema.documentPropertyDefinitions.id, args.id!),
              eq(
                schema.documentPropertyDefinitions.ownerEmail,
                document.ownerEmail,
              ),
              eq(schema.documentPropertyDefinitions.databaseId, database.id),
            ),
          );
        if (!lockedDefinition)
          throw new Error(`Property "${args.id}" not found`);
        if (
          lockedDatabase.naturalKeyPropertyId === args.id &&
          type !== "text"
        ) {
          throw new Error(
            "Clear the database natural key before changing this property's type.",
          );
        }
        if (lockedDefinition.systemRole) {
          throw new Error("System properties cannot be changed.");
        }
        if (
          isComputedPropertyType(
            lockedDefinition.type as DocumentPropertyType,
          ) &&
          lockedDefinition.type !== type
        ) {
          throw new Error("Computed property types cannot be changed.");
        }

        const lockedOptions = parsePropertyOptions(
          lockedDefinition.optionsJson,
        );
        const lockedIsPrimaryBlocks =
          isBlocksPropertyType(lockedDefinition.type as DocumentPropertyType) &&
          isPrimaryBlocksField(lockedOptions);
        if (lockedIsPrimaryBlocks && lockedDefinition.type !== type) {
          throw new Error(
            "The primary Content (Blocks) field cannot change type. Delete it from the database view to remove the body.",
          );
        }
        if (lockedDefinition.type !== type) {
          const memberships = await tx
            .select({ id: schema.contentDatabaseItems.id })
            .from(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.databaseId, database.id));
          await lockDatabaseMemberships(
            tx,
            memberships.map((membership) => membership.id),
          );
          [lockedDefinition] = await tx
            .select()
            .from(schema.documentPropertyDefinitions)
            .where(
              and(
                eq(schema.documentPropertyDefinitions.id, args.id!),
                eq(
                  schema.documentPropertyDefinitions.ownerEmail,
                  document.ownerEmail,
                ),
                eq(schema.documentPropertyDefinitions.databaseId, database.id),
              ),
            );
          if (!lockedDefinition) {
            throw new Error(`Property "${args.id}" not found`);
          }
          const [mappedSourceField] = await tx
            .select({ id: schema.contentDatabaseSourceFields.id })
            .from(schema.contentDatabaseSourceFields)
            .where(eq(schema.contentDatabaseSourceFields.propertyId, args.id!))
            .limit(1);
          if (mappedSourceField) {
            throw new Error(
              "A property bound to a source field must be unbound before changing its type.",
            );
          }
          await tx
            .delete(schema.documentPropertyValues)
            .where(
              and(
                eq(schema.documentPropertyValues.propertyId, args.id!),
                eq(
                  schema.documentPropertyValues.ownerEmail,
                  document.ownerEmail,
                ),
              ),
            );
          await tx
            .delete(schema.contentDatabaseItemKeyClaims)
            .where(
              and(
                eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
                eq(schema.contentDatabaseItemKeyClaims.propertyId, args.id!),
              ),
            );
          if (
            isBlocksPropertyType(
              lockedDefinition.type as DocumentPropertyType,
            ) &&
            !isBlocksPropertyType(type)
          ) {
            await tx
              .delete(schema.documentBlockFieldContents)
              .where(
                eq(schema.documentBlockFieldContents.propertyId, args.id!),
              );
          }
        }

        await tx
          .update(schema.documentPropertyDefinitions)
          .set({
            name,
            ...(args.description === undefined
              ? {}
              : { description: args.description.trim() }),
            type,
            visibility:
              args.visibility === undefined
                ? normalizePropertyVisibility(lockedDefinition.visibility)
                : normalizePropertyVisibility(args.visibility),
            optionsJson:
              lockedIsPrimaryBlocks && isBlocksPropertyType(type)
                ? serializePropertyOptions({ blocks: { primary: true } })
                : optionsJson,
            updatedAt: now,
          })
          .where(eq(schema.documentPropertyDefinitions.id, args.id!));
        await configureNaturalKey(tx, {
          database: lockedDatabase,
          propertyId,
          naturalKey: args.naturalKey,
          ownerEmail: document.ownerEmail,
          now,
        });
      });
    } else {
      await withPositionLock(
        propertyDefinitionsPositionScope(database.id),
        async () => {
          await db.transaction(async (tx) => {
            await lockContentDatabaseMutation(
              tx as unknown as ReturnType<typeof getDb>,
              database.id,
            );
            const [lockedDatabase] = await tx
              .select()
              .from(schema.contentDatabases)
              .where(eq(schema.contentDatabases.id, database.id));
            if (!lockedDatabase) throw new Error("Database not found.");
            const [maxPos] = await tx
              .select({
                max: sql<number>`COALESCE(MAX(position), -1)`,
              })
              .from(schema.documentPropertyDefinitions)
              .where(
                and(
                  eq(
                    schema.documentPropertyDefinitions.ownerEmail,
                    document.ownerEmail,
                  ),
                  eq(
                    schema.documentPropertyDefinitions.databaseId,
                    database.id,
                  ),
                ),
              );

            await tx.insert(schema.documentPropertyDefinitions).values({
              id: propertyId,
              ownerEmail: document.ownerEmail,
              orgId: document.orgId ?? null,
              databaseId: database.id,
              name,
              description: args.description?.trim() ?? "",
              type,
              visibility: normalizePropertyVisibility(args.visibility),
              optionsJson,
              position: (maxPos?.max ?? -1) + 1,
              createdAt: now,
              updatedAt: now,
            });
            await configureNaturalKey(tx, {
              database: lockedDatabase,
              propertyId,
              naturalKey: args.naturalKey,
              ownerEmail: document.ownerEmail,
              now,
            });
          });
        },
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId: args.documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document, database.id),
    };
  },
});

async function configureNaturalKey(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  args: {
    database: typeof schema.contentDatabases.$inferSelect;
    propertyId: string;
    naturalKey: boolean | undefined;
    ownerEmail: string;
    now: string;
  },
) {
  if (args.naturalKey === undefined) return;
  if (!args.naturalKey) {
    if (args.database.naturalKeyPropertyId === args.propertyId) {
      await tx
        .delete(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(
              schema.contentDatabaseItemKeyClaims.databaseId,
              args.database.id,
            ),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, args.propertyId),
          ),
        );
      await tx
        .update(schema.contentDatabases)
        .set({ naturalKeyPropertyId: null, updatedAt: args.now })
        .where(eq(schema.contentDatabases.id, args.database.id));
    }
    return;
  }
  if (
    args.database.naturalKeyPropertyId &&
    args.database.naturalKeyPropertyId !== args.propertyId
  ) {
    throw new Error(
      "Clear the existing database natural key before configuring another one.",
    );
  }
  const [sourceField] = await tx
    .select({ id: schema.contentDatabaseSourceFields.id })
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.propertyId, args.propertyId))
    .limit(1);
  if (sourceField) {
    throw new Error("A source-managed property cannot be a natural key.");
  }
  const values = await tx
    .select({
      valueJson: schema.documentPropertyValues.valueJson,
      itemId: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documentPropertyValues,
      and(
        eq(
          schema.documentPropertyValues.documentId,
          schema.contentDatabaseItems.documentId,
        ),
        eq(schema.documentPropertyValues.propertyId, args.propertyId),
      ),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, args.database.id));
  const claims = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.valueJson);
    } catch {
      throw new Error("Natural key values must be readable strings.");
    }
    if (parsed === null || parsed === "") continue;
    if (typeof parsed !== "string") {
      throw new Error("Natural key values must be non-empty strings.");
    }
    if (claims.has(value.valueJson)) {
      throw new Error(
        `Natural key value ${value.valueJson} belongs to more than one row.`,
      );
    }
    claims.set(value.valueJson, value);
  }
  await tx
    .delete(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, args.database.id),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, args.propertyId),
      ),
    );
  if (claims.size > 0) {
    await tx.insert(schema.contentDatabaseItemKeyClaims).values(
      [...claims.entries()].map(([keyValueJson, value]) => ({
        id: nanoid(),
        ownerEmail: args.ownerEmail,
        orgId: args.database.orgId,
        databaseId: args.database.id,
        propertyId: args.propertyId,
        keyValueJson,
        itemId: value.itemId,
        documentId: value.documentId,
        createdAt: args.now,
        updatedAt: args.now,
      })),
    );
  }
  await tx
    .update(schema.contentDatabases)
    .set({ naturalKeyPropertyId: args.propertyId, updatedAt: args.now })
    .where(eq(schema.contentDatabases.id, args.database.id));
}
