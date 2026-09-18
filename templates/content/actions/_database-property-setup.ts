import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DOCUMENT_PROPERTY_VISIBILITIES,
  parsePropertyOptions,
  serializePropertyOptions,
  normalizePropertyVisibility,
  type DocumentPropertyOption,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { type MutationContext } from "./_database-row-mutation.js";
import {
  runDatabaseSetupMutation,
  setupError,
  setupGuardSchema,
} from "./_database-setup-mutation.js";
import { nanoid } from "./_property-utils.js";

export const ordinaryPropertyTypes = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "place",
  "files_media",
  "checkbox",
  "url",
  "email",
  "phone",
] as const;

const optionPropertyTypes = ["select", "multi_select", "status"] as const;
const nonOptionPropertyTypes = [
  "number",
  "date",
  "person",
  "place",
  "files_media",
  "checkbox",
  "url",
  "email",
  "phone",
] as const;

const optionColorSchema = z.enum([
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
]);

const propertyOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    color: optionColorSchema,
    description: z.string().max(2_000).optional(),
  })
  .strict();

const propertyDefinitionBase = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().max(2_000).optional(),
  visibility: z.enum(DOCUMENT_PROPERTY_VISIBILITIES).optional(),
});

const createDefinitionSchema = z.discriminatedUnion("type", [
  propertyDefinitionBase
    .extend({
      type: z.literal("text"),
      naturalKey: z.boolean().optional(),
    })
    .strict(),
  propertyDefinitionBase
    .extend({
      type: z.enum(optionPropertyTypes),
      options: z.array(propertyOptionSchema).max(100).optional(),
    })
    .strict(),
  propertyDefinitionBase
    .extend({ type: z.enum(nonOptionPropertyTypes) })
    .strict(),
]);

const optionEditSchema = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("add"), option: propertyOptionSchema })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      optionId: z.string().trim().min(1).max(200),
      patch: z
        .object({
          name: z.string().trim().min(1).max(500).optional(),
          color: optionColorSchema.optional(),
          description: z.string().max(2_000).optional(),
        })
        .strict()
        .refine(
          (patch) => Object.keys(patch).length > 0,
          "Option patch cannot be empty",
        ),
    })
    .strict(),
  z
    .object({
      operation: z.literal("reorder"),
      optionIds: z.array(z.string().trim().min(1).max(200)).max(100),
    })
    .strict(),
]);

const updatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(2_000).optional(),
    visibility: z.enum(DOCUMENT_PROPERTY_VISIBILITIES).optional(),
    optionEdits: z.array(optionEditSchema).max(100).optional(),
    naturalKey: z.boolean().optional(),
  })
  .strict()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "Property patch cannot be empty",
  );

export const configureDocumentPropertyAgentSchema = z.discriminatedUnion(
  "operation",
  [
    setupGuardSchema
      .extend({
        operation: z.literal("create"),
        definition: createDefinitionSchema,
      })
      .strict(),
    setupGuardSchema
      .extend({
        operation: z.literal("update"),
        propertyId: z.string().trim().min(1).max(200),
        patch: updatePatchSchema,
      })
      .strict(),
  ],
);

export type ConfigureDocumentPropertyAgentInput = z.infer<
  typeof configureDocumentPropertyAgentSchema
>;

type Db = ReturnType<typeof getDb>;
type Definition = typeof schema.documentPropertyDefinitions.$inferSelect;

function normalizedOptionName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function validateOptions(options: readonly DocumentPropertyOption[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const option of options) {
    if (ids.has(option.id)) {
      setupError(
        "INVALID_INPUT",
        `Option ID \"${option.id}\" is duplicated.`,
        400,
      );
    }
    const name = normalizedOptionName(option.name);
    if (names.has(name)) {
      setupError(
        "INVALID_INPUT",
        `Option name \"${option.name}\" is duplicated.`,
        400,
      );
    }
    ids.add(option.id);
    names.add(name);
  }
}

function applyOptionEdits(
  definition: Definition,
  edits: Extract<
    ConfigureDocumentPropertyAgentInput,
    { operation: "update" }
  >["patch"]["optionEdits"],
) {
  if (!edits) return parsePropertyOptions(definition.optionsJson);
  if (!(optionPropertyTypes as readonly string[]).includes(definition.type)) {
    setupError(
      "UNSUPPORTED_SCHEMA_CHANGE",
      "Only select, multi-select, and status properties have editable options.",
      400,
    );
  }
  const current = parsePropertyOptions(definition.optionsJson);
  let options = [...(current.options ?? [])];
  for (const edit of edits) {
    if (edit.operation === "add") {
      if (options.some((option) => option.id === edit.option.id)) {
        setupError(
          "INVALID_INPUT",
          `Option ID \"${edit.option.id}\" already exists.`,
          400,
        );
      }
      options.push(edit.option);
    } else if (edit.operation === "update") {
      const index = options.findIndex((option) => option.id === edit.optionId);
      if (index < 0) {
        setupError(
          "INVALID_INPUT",
          `Option \"${edit.optionId}\" does not exist.`,
          400,
        );
      }
      options[index] = { ...options[index]!, ...edit.patch };
    } else {
      if (
        edit.optionIds.length !== options.length ||
        new Set(edit.optionIds).size !== options.length ||
        edit.optionIds.some((id) => !options.some((option) => option.id === id))
      ) {
        setupError(
          "UNSUPPORTED_SCHEMA_CHANGE",
          "Option reorder must include every existing option ID exactly once.",
          400,
        );
      }
      const byId = new Map(options.map((option) => [option.id, option]));
      options = edit.optionIds.map((id) => byId.get(id)!);
    }
    validateOptions(options);
  }
  return { ...current, options } satisfies DocumentPropertyOptions;
}

function canonicalProperty(definition: Definition, context: MutationContext) {
  return {
    id: definition.id,
    databaseId: definition.databaseId,
    systemRole: definition.systemRole,
    name: definition.name,
    type: definition.type as DocumentPropertyType,
    description: definition.description,
    visibility: normalizePropertyVisibility(definition.visibility),
    options: parsePropertyOptions(definition.optionsJson),
    position: definition.position,
    naturalKey: context.database.naturalKeyPropertyId === definition.id,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

async function readDefinition(tx: Db, databaseId: string, propertyId: string) {
  const [definition] = await tx
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.id, propertyId),
        eq(schema.documentPropertyDefinitions.databaseId, databaseId),
      ),
    );
  if (!definition) {
    setupError(
      "NOT_FOUND_OR_INACCESSIBLE",
      "The property is unavailable.",
      404,
    );
  }
  return definition;
}

async function configureNaturalKey(
  tx: Db,
  context: MutationContext,
  propertyId: string,
  naturalKey: boolean | undefined,
) {
  if (naturalKey === undefined) return;
  if (!naturalKey) {
    if (context.database.naturalKeyPropertyId !== propertyId) return;
    await tx
      .delete(schema.contentDatabaseItemKeyClaims)
      .where(
        and(
          eq(
            schema.contentDatabaseItemKeyClaims.databaseId,
            context.database.id,
          ),
          eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
        ),
      );
    await tx
      .update(schema.contentDatabases)
      .set({ naturalKeyPropertyId: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.contentDatabases.id, context.database.id));
    return;
  }

  const definition = await readDefinition(tx, context.database.id, propertyId);
  if (definition.type !== "text") {
    setupError(
      "UNSUPPORTED_SCHEMA_CHANGE",
      "A database natural key must be an ordinary text property.",
      400,
    );
  }
  if (context.sourceManagedPropertyIds.has(propertyId)) {
    setupError(
      "SOURCE_MANAGED_PROPERTY",
      "A source-managed property cannot be a natural key.",
      400,
    );
  }
  if (
    context.database.naturalKeyPropertyId &&
    context.database.naturalKeyPropertyId !== propertyId
  ) {
    setupError(
      "NATURAL_KEY_CONFLICT",
      "Clear the existing natural key before configuring another one.",
    );
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
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, context.database.id));
  const claims = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.valueJson);
    } catch {
      setupError(
        "NATURAL_KEY_CONFLICT",
        "Natural key values must be readable strings.",
        400,
      );
    }
    if (parsed === null || parsed === "") continue;
    if (typeof parsed !== "string" || !parsed.trim()) {
      setupError(
        "NATURAL_KEY_CONFLICT",
        "Natural key values must be non-empty strings.",
        400,
      );
    }
    if (claims.has(value.valueJson)) {
      setupError(
        "NATURAL_KEY_CONFLICT",
        "A natural key value belongs to more than one row.",
        409,
      );
    }
    claims.set(value.valueJson, value);
  }
  await tx
    .delete(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, context.database.id),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
      ),
    );
  if (claims.size > 0) {
    const now = new Date().toISOString();
    await tx.insert(schema.contentDatabaseItemKeyClaims).values(
      [...claims.entries()].map(([keyValueJson, value]) => ({
        id: nanoid(),
        ownerEmail: context.database.ownerEmail,
        orgId: context.database.orgId,
        databaseId: context.database.id,
        propertyId,
        keyValueJson,
        itemId: value.itemId,
        documentId: value.documentId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  await tx
    .update(schema.contentDatabases)
    .set({
      naturalKeyPropertyId: propertyId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.contentDatabases.id, context.database.id));
}

export async function runConfigureDocumentProperty(
  input: ConfigureDocumentPropertyAgentInput,
) {
  return runDatabaseSetupMutation({
    operation: `configure-document-property.${input.operation}`,
    input,
    payload:
      input.operation === "create"
        ? { operation: input.operation, definition: input.definition }
        : {
            operation: input.operation,
            propertyId: input.propertyId,
            patch: input.patch,
          },
    apply: async (tx, context) => {
      if (context.database.systemRole) {
        setupError(
          "SYSTEM_DATABASE_UNSUPPORTED",
          "Ordinary property setup is unavailable for system databases.",
          400,
        );
      }
      if (input.operation === "create") {
        const propertyId = nanoid();
        const definition = input.definition;
        const options =
          "options" in definition ? { options: definition.options ?? [] } : {};
        if ("options" in definition) validateOptions(definition.options ?? []);
        const [maxPosition] = await tx
          .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
          .from(schema.documentPropertyDefinitions)
          .where(
            eq(
              schema.documentPropertyDefinitions.databaseId,
              context.database.id,
            ),
          );
        const now = new Date().toISOString();
        await tx.insert(schema.documentPropertyDefinitions).values({
          id: propertyId,
          ownerEmail: context.database.ownerEmail,
          orgId: context.database.orgId,
          databaseId: context.database.id,
          name: definition.name,
          description: definition.description?.trim() ?? "",
          type: definition.type,
          visibility: normalizePropertyVisibility(definition.visibility),
          optionsJson: serializePropertyOptions(options),
          position: Number(maxPosition?.max ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        });
        await configureNaturalKey(
          tx,
          context,
          propertyId,
          "naturalKey" in definition ? definition.naturalKey : undefined,
        );
        const canonical = await readDefinition(
          tx,
          context.database.id,
          propertyId,
        );
        const nextContext = {
          ...context,
          database: {
            ...context.database,
            naturalKeyPropertyId:
              "naturalKey" in definition && definition.naturalKey
                ? propertyId
                : context.database.naturalKeyPropertyId,
          },
        };
        return {
          outcome: "created" as const,
          propertyId,
          value: canonicalProperty(canonical, nextContext),
        };
      }

      const existing = context.definitions.find(
        (definition) => definition.id === input.propertyId,
      );
      if (!existing) {
        setupError(
          "NOT_FOUND_OR_INACCESSIBLE",
          "The property is unavailable.",
          404,
        );
      }
      if (existing.systemRole) {
        setupError(
          "UNSUPPORTED_SCHEMA_CHANGE",
          "System properties cannot be changed.",
          400,
        );
      }
      if (context.sourceManagedPropertyIds.has(existing.id)) {
        setupError(
          "SOURCE_MANAGED_PROPERTY",
          "Source-managed property definitions cannot be changed here.",
          400,
        );
      }
      if (input.patch.naturalKey !== undefined && existing.type !== "text") {
        setupError(
          "UNSUPPORTED_SCHEMA_CHANGE",
          "Only an ordinary text property can be a natural key.",
          400,
        );
      }
      const nextOptions = applyOptionEdits(existing, input.patch.optionEdits);
      const now = new Date().toISOString();
      const nextValues = {
        name: input.patch.name ?? existing.name,
        description:
          input.patch.description === undefined
            ? existing.description
            : input.patch.description.trim(),
        visibility:
          input.patch.visibility === undefined
            ? normalizePropertyVisibility(existing.visibility)
            : input.patch.visibility,
        optionsJson: serializePropertyOptions(nextOptions),
      };
      const changed =
        nextValues.name !== existing.name ||
        nextValues.description !== existing.description ||
        nextValues.visibility !==
          normalizePropertyVisibility(existing.visibility) ||
        nextValues.optionsJson !==
          serializePropertyOptions(
            parsePropertyOptions(existing.optionsJson),
          ) ||
        (input.patch.naturalKey !== undefined &&
          input.patch.naturalKey !==
            (context.database.naturalKeyPropertyId === existing.id));
      if (changed) {
        await tx
          .update(schema.documentPropertyDefinitions)
          .set({ ...nextValues, updatedAt: now })
          .where(eq(schema.documentPropertyDefinitions.id, existing.id));
        await configureNaturalKey(
          tx,
          context,
          existing.id,
          input.patch.naturalKey,
        );
      }
      const canonical = await readDefinition(
        tx,
        context.database.id,
        existing.id,
      );
      const nextContext = {
        ...context,
        database: {
          ...context.database,
          naturalKeyPropertyId:
            input.patch.naturalKey === undefined
              ? context.database.naturalKeyPropertyId
              : input.patch.naturalKey
                ? existing.id
                : context.database.naturalKeyPropertyId === existing.id
                  ? null
                  : context.database.naturalKeyPropertyId,
        },
      };
      return {
        outcome: changed ? ("updated" as const) : ("unchanged" as const),
        propertyId: existing.id,
        value: canonicalProperty(canonical, nextContext),
      };
    },
  });
}

export const ordinaryPropertyTypeSchema = z.enum(ordinaryPropertyTypes);
