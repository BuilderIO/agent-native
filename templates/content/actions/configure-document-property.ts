import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  DOCUMENT_PROPERTY_VISIBILITIES,
  DOCUMENT_PROPERTY_TYPES,
  isComputedPropertyType,
  normalizePropertyVisibility,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  listPropertiesForDocument,
  nanoid,
  optionsForNewProperty,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Create or update a Notion-style property definition for content documents.",
  schema: z.object({
    id: z.string().optional().describe("Existing property definition ID"),
    documentId: z
      .string()
      .describe("Document ID used to scope the property workspace"),
    name: z.string().min(1).describe("Property name"),
    type: z.enum(DOCUMENT_PROPERTY_TYPES).describe("Property type"),
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
            }),
          )
          .optional(),
      })
      .optional()
      .describe("Select/status/multi-select options"),
  }),
  run: async (args) => {
    const access = await assertAccess("document", args.documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const now = new Date().toISOString();
    const name = args.name.trim();
    const type = args.type as DocumentPropertyType;
    const optionsJson = optionsForNewProperty(type, args.options as any);

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
          ),
        );
      if (!existing) throw new Error(`Property "${args.id}" not found`);
      if (
        isComputedPropertyType(existing.type as DocumentPropertyType) &&
        existing.type !== type
      ) {
        throw new Error("Computed property types cannot be changed.");
      }
      if (existing.type !== type) {
        await db
          .delete(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.propertyId, args.id),
              eq(schema.documentPropertyValues.ownerEmail, document.ownerEmail),
            ),
          );
      }

      await db
        .update(schema.documentPropertyDefinitions)
        .set({
          name,
          type,
          visibility:
            args.visibility === undefined
              ? normalizePropertyVisibility(existing.visibility)
              : normalizePropertyVisibility(args.visibility),
          optionsJson,
          updatedAt: now,
        })
        .where(eq(schema.documentPropertyDefinitions.id, args.id));
    } else {
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
            document.orgId
              ? eq(schema.documentPropertyDefinitions.orgId, document.orgId)
              : sql`${schema.documentPropertyDefinitions.orgId} IS NULL`,
          ),
        );

      await db.insert(schema.documentPropertyDefinitions).values({
        id: nanoid(),
        ownerEmail: document.ownerEmail,
        orgId: document.orgId ?? null,
        name,
        type,
        visibility: normalizePropertyVisibility(args.visibility),
        optionsJson,
        position: (maxPos?.max ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId: args.documentId,
      properties: await listPropertiesForDocument(document),
    };
  },
});
