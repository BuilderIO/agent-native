import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseView,
  SubmitContentDatabaseFormResponse,
} from "../shared/api.js";
import { contentDatabaseFormQuestions } from "../shared/database-form.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOption,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { nanoid, parseDatabaseViewConfig } from "./_property-utils.js";

const submitContentDatabaseFormSchema = z.object({
  databaseId: z.string().min(1).describe("Content database ID"),
  viewId: z
    .string()
    .min(1)
    .optional()
    .describe("Form view ID; defaults to the active or first form view"),
  title: z.string().max(500).optional().describe("Row page title"),
  propertyValues: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Form values keyed by property definition ID or exact property name. Select, status, and multi-select values may use option IDs or labels.",
    ),
});

type PropertyDefinitionRow =
  typeof schema.documentPropertyDefinitions.$inferSelect;

function resolveFormView(
  views: ContentDatabaseView[],
  activeViewId: string,
  requestedViewId?: string,
) {
  const requested = requestedViewId
    ? views.find((view) => view.id === requestedViewId)
    : (views.find((view) => view.id === activeViewId && view.type === "form") ??
      views.find((view) => view.type === "form"));
  if (!requested) throw new Error("This database does not have a form view.");
  if (requested.type !== "form") {
    throw new Error(`Database view "${requested.id}" is not a form view.`);
  }
  return requested;
}

function optionCandidates(value: unknown, multiple: boolean): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((candidate): candidate is string => typeof candidate === "string")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  }
  if (value === null || value === undefined || value === "") return [];
  const text = String(value).trim();
  if (!text) return [];
  return multiple
    ? text
        .split(/[\n,]/)
        .map((candidate) => candidate.trim())
        .filter(Boolean)
    : [text];
}

function resolveOption(
  candidate: string,
  options: DocumentPropertyOption[],
  propertyName: string,
) {
  const exactId = options.find((option) => option.id === candidate);
  if (exactId) return exactId.id;
  const normalized = candidate.toLocaleLowerCase();
  const labelMatches = options.filter(
    (option) => option.name.trim().toLocaleLowerCase() === normalized,
  );
  if (labelMatches.length === 1) return labelMatches[0].id;
  if (labelMatches.length > 1) {
    throw new Error(
      `Value "${candidate}" is ambiguous for "${propertyName}". Use an option ID.`,
    );
  }
  const allowed = options.map((option) => option.name).join(", ");
  throw new Error(
    `Unknown option "${candidate}" for "${propertyName}".${allowed ? ` Choose one of: ${allowed}.` : " This property has no options."}`,
  );
}

function normalizeSubmittedPropertyValue(
  definition: PropertyDefinitionRow,
  value: unknown,
): DocumentPropertyValue {
  const type = definition.type as DocumentPropertyType;
  if (type === "select" || type === "status" || type === "multi_select") {
    const options = parsePropertyOptions(definition.optionsJson).options ?? [];
    const values = optionCandidates(value, type === "multi_select").map(
      (candidate) => resolveOption(candidate, options, definition.name),
    );
    return type === "multi_select" ? [...new Set(values)] : (values[0] ?? null);
  }
  return normalizePropertyValue(type, value);
}

function resolveSubmittedProperties(
  definitions: PropertyDefinitionRow[],
  enabledPropertyIds: Set<string>,
  submitted: Record<string, unknown>,
) {
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const byName = new Map<string, PropertyDefinitionRow[]>();
  for (const definition of definitions) {
    const key = definition.name.trim().toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), definition]);
  }

  const resolved = new Map<string, DocumentPropertyValue>();
  for (const [inputKey, inputValue] of Object.entries(submitted)) {
    const exact = byId.get(inputKey);
    const named = byName.get(inputKey.trim().toLocaleLowerCase()) ?? [];
    if (!exact && named.length > 1) {
      throw new Error(
        `Property name "${inputKey}" is ambiguous. Use a property definition ID.`,
      );
    }
    const definition = exact ?? named[0];
    if (!definition) throw new Error(`Unknown form property "${inputKey}".`);
    if (!enabledPropertyIds.has(definition.id)) {
      throw new Error(
        `Property "${definition.name}" is not enabled in this form.`,
      );
    }
    const type = definition.type as DocumentPropertyType;
    if (isComputedPropertyType(type)) {
      throw new Error(
        `Computed property "${definition.name}" cannot be submitted.`,
      );
    }
    if (resolved.has(definition.id)) {
      throw new Error(
        `Property "${definition.name}" was submitted more than once.`,
      );
    }
    resolved.set(
      definition.id,
      normalizeSubmittedPropertyValue(definition, inputValue),
    );
  }
  return resolved;
}

export default defineAction({
  description:
    "Submit one row through a Content database form. Validates that form's required questions, resolves option labels safely, writes the title, Blocks, and property values atomically, verifies the saved row, and returns its exact page link.",
  schema: submitContentDatabaseFormSchema,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Open submitted page",
      description: "Open the new database row in Content.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async ({
    databaseId,
    viewId,
    title,
    propertyValues,
  }): Promise<SubmitContentDatabaseFormResponse> => {
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

    const access = await assertAccess(
      "document",
      database.documentId,
      "editor",
    );
    const databaseDocument = access.resource;
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
    const viewConfig = parseDatabaseViewConfig(database.viewConfigJson);
    const formView = resolveFormView(
      viewConfig.views,
      viewConfig.activeViewId,
      viewId,
    );
    const properties = definitions.map((definition) => ({
      definition: {
        id: definition.id,
        type: definition.type as DocumentPropertyType,
      },
    }));
    const questions = contentDatabaseFormQuestions(formView, properties);
    const enabledQuestions = questions.filter((question) => question.enabled);
    const enabledPropertyIds = new Set(
      enabledQuestions
        .filter((question) => question.key !== "name")
        .map((question) => question.key),
    );
    const values = resolveSubmittedProperties(
      definitions,
      enabledPropertyIds,
      propertyValues ?? {},
    );
    const normalizedTitle = title?.trim() ?? "";
    const definitionById = new Map(
      definitions.map((definition) => [definition.id, definition]),
    );

    const missing = enabledQuestions.flatMap((question) => {
      if (!question.required) return [];
      if (question.key === "name") return normalizedTitle ? [] : ["Name"];
      const definition = definitionById.get(question.key);
      if (!definition) return [`Missing property (${question.key})`];
      return isEmptyPropertyValue(values.get(question.key) ?? null)
        ? [definition.name]
        : [];
    });
    if (missing.length > 0) {
      throw new Error(
        `Required form fields are missing: ${missing.join(", ")}.`,
      );
    }

    const documentId = nanoid();
    const itemId = nanoid();
    const now = new Date().toISOString();
    const primaryBlocks = definitions.find((definition) => {
      const type = definition.type as DocumentPropertyType;
      return (
        isBlocksPropertyType(type) &&
        blocksStorageTarget(parsePropertyOptions(definition.optionsJson)) ===
          "document_body"
      );
    });
    const primaryContent = primaryBlocks
      ? values.get(primaryBlocks.id)
      : undefined;
    const documentContent =
      typeof primaryContent === "string" ? primaryContent : "";
    const standardValues = [...values.entries()].filter(([propertyId]) => {
      const definition = definitionById.get(propertyId);
      return (
        definition &&
        !isBlocksPropertyType(definition.type as DocumentPropertyType)
      );
    });
    const additionalBlocks = [...values.entries()].filter(([propertyId]) => {
      const definition = definitionById.get(propertyId);
      return (
        definition &&
        isBlocksPropertyType(definition.type as DocumentPropertyType) &&
        propertyId !== primaryBlocks?.id
      );
    });
    const createdBy = getRequestUserEmail() ?? database.ownerEmail;

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
        .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
      const inheritedShares = await tx
        .select({
          principalType: schema.documentShares.principalType,
          principalId: schema.documentShares.principalId,
          role: schema.documentShares.role,
        })
        .from(schema.documentShares)
        .where(eq(schema.documentShares.resourceId, database.documentId));

      await tx.insert(schema.documents).values({
        id: documentId,
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
        databaseId,
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

      const [savedDocument] = await tx
        .select({
          id: schema.documents.id,
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
            eq(schema.contentDatabaseItems.databaseId, databaseId),
          ),
        );
      const savedPropertyValues =
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
                  eq(schema.documentPropertyValues.documentId, documentId),
                  inArray(
                    schema.documentPropertyValues.propertyId,
                    standardValues.map(([propertyId]) => propertyId),
                  ),
                ),
              );
      const savedByPropertyId = new Map(
        savedPropertyValues.map((value) => [value.propertyId, value.valueJson]),
      );
      const standardValuesVerified = standardValues.every(
        ([propertyId, value]) =>
          savedByPropertyId.get(propertyId) === serializePropertyValue(value),
      );
      const savedAdditionalBlocks =
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
                  eq(schema.documentBlockFieldContents.documentId, documentId),
                  inArray(
                    schema.documentBlockFieldContents.propertyId,
                    additionalBlocks.map(([propertyId]) => propertyId),
                  ),
                ),
              );
      const savedBlockByPropertyId = new Map(
        savedAdditionalBlocks.map((value) => [value.propertyId, value.content]),
      );
      const additionalBlocksVerified = additionalBlocks.every(
        ([propertyId, value]) =>
          savedBlockByPropertyId.get(propertyId) ===
          (typeof value === "string" ? value : ""),
      );
      if (
        !savedDocument ||
        !savedItem ||
        savedDocument.title !== normalizedTitle ||
        savedDocument.content !== documentContent ||
        !standardValuesVerified ||
        !additionalBlocksVerified
      ) {
        throw new Error(
          "The form submission could not be verified; no row was saved.",
        );
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    const deepLink = buildDeepLink({
      app: "content",
      view: "editor",
      params: { documentId },
    });
    return {
      databaseId,
      viewId: formView.id,
      createdItemId: itemId,
      createdDocumentId: documentId,
      urlPath: `/page/${documentId}`,
      deepLink,
      verified: true,
    };
  },
  link: ({ result }) => {
    const documentId = (result as SubmitContentDatabaseFormResponse | null)
      ?.createdDocumentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open submitted page",
      view: "editor",
    };
  },
});
