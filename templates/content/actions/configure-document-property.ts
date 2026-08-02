import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
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
    let optionsJson = optionsForNewProperty(type, args.options as any);
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

    if (args.id) {
      const propertyId = args.id;
      const [existing] = await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.id, propertyId),
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              document.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
      if (!existing) throw new Error(`Property "${propertyId}" not found`);
      if (existing.systemRole) {
        throw new Error("System properties cannot be changed.");
      }
      if (
        isComputedPropertyType(existing.type as DocumentPropertyType) &&
        existing.type !== type
      ) {
        throw new Error("Computed property types cannot be changed.");
      }

      const existingOptions = parsePropertyOptions(existing.optionsJson);
      const existingIsPrimaryBlocks =
        isBlocksPropertyType(existing.type as DocumentPropertyType) &&
        isPrimaryBlocksField(existingOptions);

      // The primary "Content" Blocks field backs the document body — it can be
      // renamed/hidden but not retyped (delete it from the database view to
      // remove the body). Block the type switch defensively.
      if (existingIsPrimaryBlocks && existing.type !== type) {
        throw new Error(
          "The primary Content (Blocks) field cannot change type. Delete it from the database view to remove the body.",
        );
      }

      // Preserve the primary flag when re-saving the primary Blocks field (a
      // rename or visibility change must NOT demote it to a normal Blocks field).
      if (existingIsPrimaryBlocks && isBlocksPropertyType(type)) {
        optionsJson = serializePropertyOptions({ blocks: { primary: true } });
      }

      await db.transaction(async (tx) => {
        const [lockedDatabase] = await tx
          .update(schema.contentDatabases)
          .set({ updatedAt: sql`${schema.contentDatabases.updatedAt}` })
          .where(
            and(
              eq(schema.contentDatabases.id, database.id),
              eq(schema.contentDatabases.documentId, database.documentId),
              eq(schema.contentDatabases.ownerEmail, document.ownerEmail),
              isNull(schema.contentDatabases.deletedAt),
            ),
          )
          .returning({ id: schema.contentDatabases.id });
        if (!lockedDatabase) throw new Error("Database is no longer active.");
        const [lockedExisting] = await tx
          .update(schema.documentPropertyDefinitions)
          .set({
            updatedAt: sql`${schema.documentPropertyDefinitions.updatedAt}`,
          })
          .where(
            and(
              eq(schema.documentPropertyDefinitions.id, propertyId),
              eq(
                schema.documentPropertyDefinitions.ownerEmail,
                document.ownerEmail,
              ),
              eq(schema.documentPropertyDefinitions.databaseId, database.id),
            ),
          )
          .returning();
        if (!lockedExisting)
          throw new Error(`Property "${propertyId}" not found`);
        if (lockedExisting.systemRole)
          throw new Error("System properties cannot be changed.");
        if (
          isComputedPropertyType(lockedExisting.type as DocumentPropertyType) &&
          lockedExisting.type !== type
        ) {
          throw new Error("Computed property types cannot be changed.");
        }
        const lockedIsPrimaryBlocks =
          isBlocksPropertyType(lockedExisting.type as DocumentPropertyType) &&
          isPrimaryBlocksField(
            parsePropertyOptions(lockedExisting.optionsJson),
          );
        if (lockedIsPrimaryBlocks && lockedExisting.type !== type) {
          throw new Error(
            "The primary Content (Blocks) field cannot change type. Delete it from the database view to remove the body.",
          );
        }

        if (lockedExisting.type !== type) {
          const [mappedSourceField] = await tx
            .select({ id: schema.contentDatabaseSourceFields.id })
            .from(schema.contentDatabaseSourceFields)
            .where(
              eq(schema.contentDatabaseSourceFields.propertyId, propertyId),
            )
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
                eq(schema.documentPropertyValues.propertyId, propertyId),
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
                eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
              ),
            );
          // Switching a Blocks field to another type drops its independent content.
          if (
            isBlocksPropertyType(lockedExisting.type as DocumentPropertyType) &&
            !isBlocksPropertyType(type)
          ) {
            await tx
              .delete(schema.documentBlockFieldContents)
              .where(
                eq(schema.documentBlockFieldContents.propertyId, propertyId),
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
                ? normalizePropertyVisibility(lockedExisting.visibility)
                : normalizePropertyVisibility(args.visibility),
            optionsJson:
              lockedIsPrimaryBlocks && isBlocksPropertyType(type)
                ? serializePropertyOptions({ blocks: { primary: true } })
                : optionsJson,
            updatedAt: now,
          })
          .where(eq(schema.documentPropertyDefinitions.id, propertyId));
      });
    } else {
      await withPositionLock(
        propertyDefinitionsPositionScope(database.id),
        async () => {
          const [maxPos] = await db
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
                eq(schema.documentPropertyDefinitions.databaseId, database.id),
              ),
            );

          await db.insert(schema.documentPropertyDefinitions).values({
            id: nanoid(),
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
