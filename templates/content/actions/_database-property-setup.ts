import { ActionContractError } from "@agent-native/core/action";
import {
  iconValueSchema,
  parseIconValue,
  serializeIconValue,
} from "@agent-native/core/icons";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  syncPrivateIconReference,
  verifyPrivateIconAssignment,
} from "../server/lib/private-icon-references.js";
import {
  contentDatabaseFilterOperatorNeedsValue,
  selectedFilterValues,
} from "../shared/database-query.js";
import {
  DOCUMENT_PROPERTY_VISIBILITIES,
  defaultPropertyOptions,
  isBlocksPropertyType,
  parsePropertyOptions,
  serializePropertyOptions,
  normalizePropertyVisibility,
  type DocumentPropertyOption,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { type MutationContext } from "./_database-row-mutation.js";
import {
  runDatabaseSetupMutation,
  setupError,
  setupGuardSchema,
} from "./_database-setup-mutation.js";
import {
  type CallProvenance,
  isAgentCall,
  lockPagesAndAssertAgentsMayEditText,
} from "./_document-agent-lock.js";
import { nanoid, parseDatabaseViewConfig } from "./_property-utils.js";
import {
  assertRelationTargetDatabase,
  lockRelationCollections,
} from "./_relation-values.js";

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

/** Types an agent can create through property setup. */
export const setupPropertyTypes = [
  ...ordinaryPropertyTypes,
  "relation",
  "blocks",
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
  icon: iconValueSchema.nullable().optional(),
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
  propertyDefinitionBase
    .extend({
      type: z.literal("relation"),
      relatedDatabaseId: z
        .string()
        .min(1)
        .describe(
          "Exact ID of the collection this relation links to, in the same Content space (may be this collection)",
        ),
    })
    .strict(),
  propertyDefinitionBase
    .extend({
      type: z
        .literal("blocks")
        .describe(
          "A rich-text Blocks field: a new, empty tab on every row's page of this collection",
        ),
    })
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
  z
    .object({
      operation: z.literal("remove"),
      optionId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe(
          "Option to delete. Refused with OPTION_IN_USE while any row's value or a saved view's filter still uses it",
        ),
    })
    .strict(),
]);

const updatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(2_000).optional(),
    icon: iconValueSchema.nullable().optional(),
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
    } else if (edit.operation === "remove") {
      if (!options.some((option) => option.id === edit.optionId)) {
        setupError(
          "INVALID_INPUT",
          `Option \"${edit.optionId}\" does not exist.`,
          400,
        );
      }
      options = options.filter((option) => option.id !== edit.optionId);
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

/**
 * Refuses to delete an option that a row or a saved view still uses, so a
 * removal never leaves a row showing an unknown value or a filter matching
 * nothing. Rows and filters can name an option by ID or by name, in any case,
 * as the view query matches them; a filter that takes no value (such as "is
 * empty") names no option. Each person's own view filters are theirs and
 * aren't checked.
 */
async function assertRemovedOptionsUnused(
  tx: Db,
  context: MutationContext,
  definition: Definition,
  nextOptions: DocumentPropertyOptions,
) {
  const kept = new Set((nextOptions.options ?? []).map((option) => option.id));
  const removed = (
    parsePropertyOptions(definition.optionsJson).options ?? []
  ).filter((option) => !kept.has(option.id));
  if (removed.length === 0) return;

  const usesOption = (candidate: unknown, option: DocumentPropertyOption) =>
    typeof candidate === "string" &&
    (normalizedOptionName(candidate) === normalizedOptionName(option.id) ||
      normalizedOptionName(candidate) === normalizedOptionName(option.name));
  const values = await tx
    .select({
      documentId: schema.documentPropertyValues.documentId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documentPropertyValues,
      and(
        eq(
          schema.documentPropertyValues.documentId,
          schema.contentDatabaseItems.documentId,
        ),
        eq(schema.documentPropertyValues.propertyId, definition.id),
      ),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, context.database.id));
  const { views } = parseDatabaseViewConfig(context.database.viewConfigJson);

  const removedOptionIdsByName = new Map<string, string[]>();
  for (const option of removed) {
    for (const key of new Set([
      normalizedOptionName(option.id),
      normalizedOptionName(option.name),
    ])) {
      removedOptionIdsByName.set(key, [
        ...(removedOptionIdsByName.get(key) ?? []),
        option.id,
      ]);
    }
  }
  const rowDocumentIdsByOption = new Map<string, Set<string>>();
  for (const value of values) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.valueJson);
    } catch {
      parsed = value.valueJson;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof item !== "string") continue;
      for (const optionId of removedOptionIdsByName.get(
        normalizedOptionName(item),
      ) ?? []) {
        const rows = rowDocumentIdsByOption.get(optionId) ?? new Set<string>();
        rows.add(value.documentId);
        rowDocumentIdsByOption.set(optionId, rows);
      }
    }
  }

  for (const option of removed) {
    const rowDocumentIds =
      rowDocumentIdsByOption.get(option.id) ?? new Set<string>();
    const viewIds = views
      .filter((view) =>
        view.filters.some(
          (filter) =>
            filter.key === definition.id &&
            contentDatabaseFilterOperatorNeedsValue(filter.operator) &&
            selectedFilterValues(filter.value).some((candidate) =>
              usesOption(candidate, option),
            ),
        ),
      )
      .map((view) => view.id);
    if (rowDocumentIds.size === 0 && viewIds.length === 0) continue;
    const uses = [
      rowDocumentIds.size > 0
        ? `${rowDocumentIds.size} row${rowDocumentIds.size === 1 ? "" : "s"}`
        : null,
      viewIds.length > 0
        ? `${viewIds.length} saved view filter${viewIds.length === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);
    throw new ActionContractError(
      `Option \"${option.name}\" is still used by ${uses.join(" and ")}. Move those rows to another option and change those filters, then remove it.`,
      {
        errorCode: "OPTION_IN_USE",
        statusCode: 409,
        details: {
          propertyId: definition.id,
          optionId: option.id,
          rowCount: rowDocumentIds.size,
          viewIds,
        },
      },
    );
  }
}

function canonicalProperty(definition: Definition, context: MutationContext) {
  return {
    id: definition.id,
    databaseId: definition.databaseId,
    systemRole: definition.systemRole,
    name: definition.name,
    type: definition.type as DocumentPropertyType,
    description: definition.description,
    icon: definition.icon ? parseIconValue(definition.icon) : null,
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

/** Every row shows a Blocks field as a tab, so an agent's change to one waits for, and is held to, each row's lock. */
export async function lockRowsAndAssertAgentsMayEditTabs(
  tx: Db,
  databaseId: string,
  provenance: CallProvenance | undefined,
) {
  if (!isAgentCall(provenance)) return;
  const memberships = await tx
    .select({
      id: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
  await lockDatabaseMemberships(
    tx,
    memberships.map((membership) => membership.id),
  );
  await lockPagesAndAssertAgentsMayEditText(
    tx,
    memberships.map((membership) => membership.documentId),
    provenance,
  );
}

export async function runConfigureDocumentProperty(
  input: ConfigureDocumentPropertyAgentInput,
  provenance: CallProvenance | undefined,
) {
  const relatedDatabaseId =
    input.operation === "create" && input.definition.type === "relation"
      ? input.definition.relatedDatabaseId
      : null;
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
    // The relation's target is checked again under its lock in apply.
    ...(relatedDatabaseId
      ? {
          lock: (tx: Parameters<typeof lockRelationCollections>[0]) =>
            lockRelationCollections(tx, [
              input.target.databaseId,
              relatedDatabaseId,
            ]),
        }
      : {}),
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
        const userEmail = getRequestUserEmail();
        if (!userEmail)
          setupError("UNAUTHENTICATED", "Authentication is required.", 401);
        await verifyPrivateIconAssignment({
          icon: definition.icon,
          userEmail,
          orgId: context.database.orgId,
        });
        // A new Blocks field adds a tab to every row.
        if (definition.type === "blocks")
          await lockRowsAndAssertAgentsMayEditTabs(
            tx,
            context.database.id,
            provenance,
          );
        const options: DocumentPropertyOptions =
          definition.type === "relation"
            ? {
                relation: {
                  databaseId: (
                    await assertRelationTargetDatabase(tx, {
                      sourceDatabase: context.database,
                      targetDatabaseId: definition.relatedDatabaseId,
                    })
                  ).id,
                },
              }
            : definition.type === "blocks"
              ? defaultPropertyOptions("blocks")
              : "options" in definition
                ? { options: definition.options ?? [] }
                : {};
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
          icon:
            definition.icon === undefined || definition.icon === null
              ? null
              : serializeIconValue(definition.icon),
          type: definition.type,
          visibility: normalizePropertyVisibility(definition.visibility),
          optionsJson: serializePropertyOptions(options),
          position: Number(maxPosition?.max ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        });
        await syncPrivateIconReference(tx, {
          elementType: "property",
          elementId: propertyId,
          documentId: context.database.documentId,
          icon: definition.icon,
          ownerEmail: context.database.ownerEmail,
          orgId: context.database.orgId,
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
      await assertRemovedOptionsUnused(tx, context, existing, nextOptions);
      if (input.patch.icon !== undefined) {
        const userEmail = getRequestUserEmail();
        if (!userEmail)
          setupError("UNAUTHENTICATED", "Authentication is required.", 401);
        await verifyPrivateIconAssignment({
          icon: input.patch.icon,
          userEmail,
          orgId: context.database.orgId,
        });
      }
      const now = new Date().toISOString();
      const nextValues = {
        name: input.patch.name ?? existing.name,
        description:
          input.patch.description === undefined
            ? existing.description
            : input.patch.description.trim(),
        icon:
          input.patch.icon === undefined
            ? existing.icon
            : input.patch.icon === null
              ? null
              : serializeIconValue(input.patch.icon),
        visibility:
          input.patch.visibility === undefined
            ? normalizePropertyVisibility(existing.visibility)
            : input.patch.visibility,
        optionsJson: serializePropertyOptions(nextOptions),
      };
      // Renaming or hiding a Blocks field renames or hides every row's tab.
      if (
        isBlocksPropertyType(existing.type as DocumentPropertyType) &&
        (nextValues.name !== existing.name ||
          nextValues.visibility !==
            normalizePropertyVisibility(existing.visibility))
      )
        await lockRowsAndAssertAgentsMayEditTabs(
          tx,
          context.database.id,
          provenance,
        );
      const changed =
        nextValues.name !== existing.name ||
        nextValues.description !== existing.description ||
        nextValues.icon !== existing.icon ||
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
        if (input.patch.icon !== undefined) {
          await syncPrivateIconReference(tx, {
            elementType: "property",
            elementId: existing.id,
            documentId: context.database.documentId,
            icon: nextValues.icon,
            ownerEmail: context.database.ownerEmail,
            orgId: context.database.orgId,
          });
        }
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
