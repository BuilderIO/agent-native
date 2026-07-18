import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseValidationConfig,
  ContentDatabaseViewConfig,
} from "../shared/api.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  parsePropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

type PropertyDefinition =
  typeof schema.documentPropertyDefinitions.$inferSelect;

export interface MissingContentProperty {
  propertyId: string;
  name: string;
}

export class ContentReadinessError extends Error {
  readonly code = "CONTENT_READINESS_REQUIRED";
  readonly statusCode = 409;

  constructor(
    message: string,
    readonly details: {
      databaseId: string;
      documentId?: string;
      phase: "submission" | "status_transition";
      statusPropertyId?: string;
      statusOptionId?: string;
      missingFields: MissingContentProperty[];
    },
  ) {
    super(message);
    this.name = "ContentReadinessError";
  }
}

export function missingRequiredContentProperties(args: {
  definitions: PropertyDefinition[];
  requiredPropertyIds: string[];
  values: ReadonlyMap<string, DocumentPropertyValue>;
}) {
  const byId = new Map(
    args.definitions.map((definition) => [definition.id, definition]),
  );
  return args.requiredPropertyIds.flatMap((propertyId) => {
    const definition = byId.get(propertyId);
    if (!definition) {
      return [{ propertyId, name: `Missing property (${propertyId})` }];
    }
    return isEmptyPropertyValue(args.values.get(propertyId) ?? null)
      ? [{ propertyId, name: definition.name }]
      : [];
  });
}

export function assertAtomicSubmissionReady(args: {
  databaseId: string;
  config: ContentDatabaseViewConfig;
  definitions: PropertyDefinition[];
  values: ReadonlyMap<string, DocumentPropertyValue>;
}) {
  const missingFields = missingRequiredContentProperties({
    definitions: args.definitions,
    requiredPropertyIds: args.config.validation?.requiredForSubmission ?? [],
    values: args.values,
  });
  if (missingFields.length === 0) return;
  throw new ContentReadinessError(
    `Required submission fields are missing: ${missingFields
      .map((field) => field.name)
      .join(", ")}.`,
    {
      databaseId: args.databaseId,
      phase: "submission",
      missingFields,
    },
  );
}

export async function assertContentStatusTransitionReady(args: {
  databaseId: string;
  documentId: string;
  statusPropertyId: string;
  statusOptionId: string | null;
}) {
  if (!args.statusOptionId) return;
  const db = getDb();
  const [database] = await db
    .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, args.databaseId));
  if (!database) return;
  const config = parseDatabaseViewConfig(database.viewConfigJson);
  const requirement = config.validation?.statusRequirements.find(
    (candidate) =>
      candidate.statusPropertyId === args.statusPropertyId &&
      candidate.statusOptionId === args.statusOptionId,
  );
  if (!requirement) return;

  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.databaseId));
  const [document] = await db
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, args.documentId));
  const values = new Map<string, DocumentPropertyValue>();
  const propertyValues = await db
    .select({
      propertyId: schema.documentPropertyValues.propertyId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.documentId, args.documentId));
  for (const value of propertyValues) {
    values.set(value.propertyId, JSON.parse(value.valueJson));
  }
  const blockValues = await db
    .select({
      propertyId: schema.documentBlockFieldContents.propertyId,
      content: schema.documentBlockFieldContents.content,
    })
    .from(schema.documentBlockFieldContents)
    .where(eq(schema.documentBlockFieldContents.documentId, args.documentId));
  for (const value of blockValues) values.set(value.propertyId, value.content);
  for (const definition of definitions) {
    const type = definition.type as DocumentPropertyType;
    if (
      isBlocksPropertyType(type) &&
      blocksStorageTarget(parsePropertyOptions(definition.optionsJson)) ===
        "document_body"
    ) {
      values.set(definition.id, document?.content ?? "");
    }
  }
  if (values.get(args.statusPropertyId) === args.statusOptionId) return;
  values.set(args.statusPropertyId, args.statusOptionId);

  const missingFields = missingRequiredContentProperties({
    definitions,
    requiredPropertyIds: requirement.requiredPropertyIds,
    values,
  });
  if (missingFields.length === 0) return;
  throw new ContentReadinessError(
    `Status cannot change until these fields are filled: ${missingFields
      .map((field) => field.name)
      .join(", ")}.`,
    {
      databaseId: args.databaseId,
      documentId: args.documentId,
      phase: "status_transition",
      statusPropertyId: args.statusPropertyId,
      statusOptionId: args.statusOptionId,
      missingFields,
    },
  );
}

export async function validateContentDatabaseValidationConfig(
  databaseId: string,
  config: ContentDatabaseValidationConfig,
) {
  const definitions = await getDb()
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const referencedPropertyIds = new Set([
    ...config.requiredForSubmission,
    ...config.statusRequirements.flatMap((requirement) => [
      requirement.statusPropertyId,
      ...requirement.requiredPropertyIds,
    ]),
  ]);
  for (const propertyId of referencedPropertyIds) {
    const property = byId.get(propertyId);
    if (!property) {
      throw new Error(
        `Property "${propertyId}" does not belong to this database.`,
      );
    }
    if (
      property.type === "formula" ||
      property.type === "rollup" ||
      property.type === "id" ||
      property.type === "created_time" ||
      property.type === "created_by" ||
      property.type === "last_edited_time" ||
      property.type === "last_edited_by"
    ) {
      throw new Error(
        `Computed property "${property.name}" cannot be required readiness evidence.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const requirement of config.statusRequirements) {
    const key = `${requirement.statusPropertyId}:${requirement.statusOptionId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate status readiness rule "${key}".`);
    }
    seen.add(key);
    const statusProperty = byId.get(requirement.statusPropertyId)!;
    if (statusProperty.type !== "status") {
      throw new Error(
        `Property "${statusProperty.name}" is not a Status property.`,
      );
    }
    const optionIds = new Set(
      (parsePropertyOptions(statusProperty.optionsJson).options ?? []).map(
        (option) => option.id,
      ),
    );
    if (!optionIds.has(requirement.statusOptionId)) {
      throw new Error(
        `Option "${requirement.statusOptionId}" does not belong to status property "${statusProperty.id}".`,
      );
    }
  }
}
