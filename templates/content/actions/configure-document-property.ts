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
import { deleteBlocksFieldIdentity } from "./_blocks-field-identity.js";
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
            await deleteBlocksFieldIdentity({
              db: tx as unknown as ReturnType<typeof getDb>,
              propertyId: args.id!,
            });
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
