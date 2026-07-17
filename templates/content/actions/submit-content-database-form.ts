import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseView,
  SubmitContentDatabaseFormResponse,
} from "../shared/api.js";
import { contentDatabaseFormQuestions } from "../shared/database-form.js";
import {
  isEmptyPropertyValue,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  type DocumentPropertyOption,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { commitContentDatabaseItem } from "./_content-database-item-mutations.js";
import { assertAtomicSubmissionReady } from "./_content-database-validation.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

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
  run: async (
    { databaseId, viewId, title, propertyValues },
    ctx,
  ): Promise<SubmitContentDatabaseFormResponse> => {
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
    if (!database.spaceId) {
      throw new Error("Database does not belong to a Content space.");
    }

    const access = await assertAccess(
      "document",
      database.documentId,
      "editor",
    );
    const databaseDocument = access.resource;
    if (databaseDocument.spaceId !== database.spaceId) {
      throw new Error(
        "Database page and database belong to different Content spaces.",
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
    assertAtomicSubmissionReady({
      databaseId,
      config: viewConfig,
      definitions,
      values,
    });

    const mutation = await commitContentDatabaseItem({
      databaseId,
      title: normalizedTitle,
      values,
      intent: "submitted",
      formViewId: formView.id,
      actionContext: ctx,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    const deepLink = buildDeepLink({
      app: "content",
      view: "editor",
      params: { documentId: mutation.documentId },
    });
    return {
      databaseId,
      viewId: formView.id,
      createdItemId: mutation.itemId,
      createdDocumentId: mutation.documentId,
      urlPath: `/page/${mutation.documentId}`,
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
