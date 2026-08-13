import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseMutationContract,
  ContentDatabaseRowMutationReceipt,
  ContentDatabaseRowMutationResult,
} from "../shared/api.js";
import {
  isBlocksPropertyType,
  isComputedPropertyType,
  parsePropertyOptions,
  parsePropertyValue,
  serializePropertyValue,
  type DocumentPropertyDateValue,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
} from "./_content-database-mutation-lock.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import {
  databaseItemsPositionScope,
  documentsPositionScope,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid } from "./_property-utils.js";

export const databaseMutationTargetSchema = z.object({
  authorityScope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("personal"), id: z.string().min(1) }),
    z.object({ kind: z.literal("organization"), id: z.string().min(1) }),
  ]),
  spaceId: z.string().min(1).describe("Exact Content space ID"),
  databaseId: z.string().min(1).describe("Exact Content database ID"),
  databaseDocumentId: z
    .string()
    .min(1)
    .describe("Exact page ID backing the Content database"),
});

export const databaseMutationEnvelopeSchema = z.object({
  target: databaseMutationTargetSchema,
  expectedSchemaRevision: z
    .string()
    .min(1)
    .describe("Schema revision returned by get-content-database"),
  idempotencyKey: z.string().min(1).max(200),
});

export type DatabaseMutationTarget = z.infer<
  typeof databaseMutationTargetSchema
>;

type DatabaseRow = typeof schema.contentDatabases.$inferSelect;
type DefinitionRow = typeof schema.documentPropertyDefinitions.$inferSelect;
type Db = ReturnType<typeof getDb>;

interface MutationContext {
  database: DatabaseRow;
  databaseDocument: typeof schema.documents.$inferSelect;
  definitions: DefinitionRow[];
  sourceManagedPropertyIds: Set<string>;
  schemaRevision: string;
}

interface RowSnapshot {
  item: typeof schema.contentDatabaseItems.$inferSelect;
  document: typeof schema.documents.$inferSelect;
  values: Map<string, string>;
  revision: string;
}

export type DatabaseRowMutationOperation = "create" | "update" | "upsert";

export interface CreateDatabaseRowMutationInput {
  target: DatabaseMutationTarget;
  expectedSchemaRevision: string;
  idempotencyKey: string;
  title?: string;
  propertyValues?: Record<string, unknown>;
}

export interface UpdateDatabaseRowMutationInput extends CreateDatabaseRowMutationInput {
  itemId: string;
  documentId: string;
  expectedRowRevision: string;
}

export interface UpsertDatabaseRowMutationInput extends CreateDatabaseRowMutationInput {
  keyValue: string;
  expectedRowRevision: string | null;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function databaseRowRevision(args: {
  itemId: string;
  documentId: string;
  title: string;
  values: Array<{ propertyId: string; value: DocumentPropertyValue }>;
}) {
  return digest({
    itemId: args.itemId,
    documentId: args.documentId,
    title: args.title,
    values: args.values
      .filter((entry) => entry.value !== null)
      .sort((left, right) => left.propertyId.localeCompare(right.propertyId)),
  });
}

function conflict(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ActionContractError(message, { errorCode, details });
}

function invalidProperty(
  definition: Pick<DefinitionRow, "id" | "name" | "type">,
  reason: string,
): never {
  throw new ActionContractError(
    `Invalid value for property "${definition.name}": ${reason}`,
    {
      errorCode: "INVALID_PROPERTY_VALUE",
      details: {
        propertyId: definition.id,
        propertyName: definition.name,
        propertyType: definition.type,
        reason,
      },
      statusCode: 400,
    },
  );
}

function schemaPayload(
  database: DatabaseRow,
  definitions: DefinitionRow[],
  sourceManagedPropertyIds: Set<string>,
) {
  return {
    naturalKeyPropertyId: database.naturalKeyPropertyId,
    properties: definitions
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        type: definition.type,
        description: definition.description,
        systemRole: definition.systemRole,
        visibility: definition.visibility,
        options: parsePropertyOptions(definition.optionsJson),
        sourceManaged: sourceManagedPropertyIds.has(definition.id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function schemaRevisionFor(
  database: DatabaseRow,
  definitions: DefinitionRow[],
  sourceManagedPropertyIds: Set<string>,
) {
  return digest(schemaPayload(database, definitions, sourceManagedPropertyIds));
}

function acceptedShape(type: DocumentPropertyType): string {
  switch (type) {
    case "number":
      return "finite number or null";
    case "checkbox":
      return "boolean or null";
    case "multi_select":
      return "array of option IDs or exact labels, or null";
    case "person":
      return "array of person identifiers, or null";
    case "files_media":
      return "array of http/https URLs, or null";
    case "date":
      return "ISO date/date-time string or { start, end?, includeTime? }, or null";
    case "select":
    case "status":
      return "option ID, exact option label, or null";
    default:
      return "string or null";
  }
}

async function loadContext(
  target: DatabaseMutationTarget,
  role: "viewer" | "editor",
  db: Db = getDb(),
  accessAlreadyResolved = false,
): Promise<MutationContext> {
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, target.databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!database) {
    throw new ActionContractError("Content database not found.", {
      errorCode: "DATABASE_NOT_FOUND",
      statusCode: 404,
    });
  }
  const databaseDocument = accessAlreadyResolved
    ? (
        await db
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.id, database.documentId),
              isNull(schema.documents.trashedAt),
            ),
          )
      )[0]
    : (await assertAccess("document", database.documentId, role)).resource;
  if (!databaseDocument) {
    throw new ActionContractError("Content database backing page not found.", {
      errorCode: "DATABASE_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (!database.spaceId) {
    throw new ActionContractError(
      "This database does not belong to a Content space.",
      { errorCode: "DATABASE_SPACE_REQUIRED", statusCode: 400 },
    );
  }
  const authorityScope = database.orgId
    ? { kind: "organization" as const, id: database.orgId }
    : { kind: "personal" as const, id: database.ownerEmail };
  if (
    target.authorityScope.kind !== authorityScope.kind ||
    target.authorityScope.id !== authorityScope.id ||
    database.spaceId !== target.spaceId ||
    database.documentId !== target.databaseDocumentId ||
    databaseDocument.spaceId !== target.spaceId ||
    databaseDocument.id !== target.databaseDocumentId
  ) {
    conflict("TARGET_MISMATCH", "The Content database target tuple changed.", {
      target,
    });
  }
  if (database.systemRole) {
    throw new ActionContractError(
      "Reliable row mutations are supported only for ordinary Content databases.",
      { errorCode: "SYSTEM_DATABASE_UNSUPPORTED", statusCode: 400 },
    );
  }
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, database.id));
  const sourceFields = await db
    .select({ propertyId: schema.contentDatabaseSourceFields.propertyId })
    .from(schema.contentDatabaseSourceFields)
    .innerJoin(
      schema.contentDatabaseSources,
      eq(
        schema.contentDatabaseSources.id,
        schema.contentDatabaseSourceFields.sourceId,
      ),
    )
    .where(eq(schema.contentDatabaseSources.databaseId, database.id));
  const sourceManagedPropertyIds = new Set(
    sourceFields.flatMap((field) =>
      field.propertyId ? [field.propertyId] : [],
    ),
  );
  return {
    database,
    databaseDocument,
    definitions,
    sourceManagedPropertyIds,
    schemaRevision: schemaRevisionFor(
      database,
      definitions,
      sourceManagedPropertyIds,
    ),
  };
}

export async function getDatabaseMutationContract(
  target: DatabaseMutationTarget,
  options: { accessAlreadyResolved?: boolean } = {},
): Promise<ContentDatabaseMutationContract> {
  const context = await loadContext(
    target,
    "viewer",
    getDb(),
    options.accessAlreadyResolved,
  );
  return {
    target: {
      ...target,
    },
    schemaRevision: context.schemaRevision,
    naturalKeyPropertyId: context.database.naturalKeyPropertyId,
    properties: context.definitions
      .map((definition) => {
        const type = definition.type as DocumentPropertyType;
        const sourceManaged = context.sourceManagedPropertyIds.has(
          definition.id,
        );
        const writable =
          !definition.systemRole &&
          !sourceManaged &&
          type !== "relation" &&
          !isComputedPropertyType(type) &&
          !isBlocksPropertyType(type);
        return {
          id: definition.id,
          name: definition.name,
          type,
          writable,
          sourceManaged,
          acceptedShape: writable ? acceptedShape(type) : null,
          options: parsePropertyOptions(definition.optionsJson),
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function resolveOption(definition: DefinitionRow, candidate: unknown): string {
  if (typeof candidate !== "string") {
    invalidProperty(definition, "expected an option ID or exact label");
  }
  const options = parsePropertyOptions(definition.optionsJson).options ?? [];
  const byId = options.find((option) => option.id === candidate);
  if (byId) return byId.id;
  const matches = options.filter((option) => option.name === candidate);
  if (matches.length !== 1) {
    invalidProperty(
      definition,
      matches.length > 1 ? "option label is ambiguous" : "unknown option",
    );
  }
  return matches[0]!.id;
}

function strictDate(
  definition: DefinitionRow,
  value: unknown,
): DocumentPropertyDateValue {
  const date =
    typeof value === "string"
      ? { start: value }
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
  if (!date || typeof date.start !== "string") {
    invalidProperty(definition, "expected an ISO date or date range object");
  }
  const start = date.start.trim();
  const end = typeof date.end === "string" ? date.end.trim() : undefined;
  const includeTime = date.includeTime;
  const validIso = (candidate: string) => {
    if (
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
        candidate,
      ) ||
      Number.isNaN(Date.parse(candidate))
    ) {
      return false;
    }
    const datePart = candidate.slice(0, 10);
    return new Date(`${datePart}T00:00:00.000Z`)
      .toISOString()
      .startsWith(datePart);
  };
  if (
    start !== date.start ||
    (typeof date.end === "string" && end !== date.end) ||
    !validIso(start) ||
    (end !== undefined && !validIso(end))
  ) {
    invalidProperty(definition, "date is not a valid ISO date/date-time");
  }
  if (end && Date.parse(end) < Date.parse(start)) {
    invalidProperty(definition, "date range ends before it starts");
  }
  if (includeTime !== undefined && typeof includeTime !== "boolean") {
    invalidProperty(definition, "includeTime must be boolean");
  }
  return {
    start,
    ...(end ? { end } : {}),
    ...(includeTime === undefined ? {} : { includeTime }),
  };
}

async function strictValue(
  definition: DefinitionRow,
  value: unknown,
): Promise<DocumentPropertyValue> {
  if (value === null) return null;
  const type = definition.type as DocumentPropertyType;
  switch (type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        invalidProperty(definition, "expected a finite number");
      return value;
    case "checkbox":
      if (typeof value !== "boolean")
        invalidProperty(definition, "expected a boolean");
      return value;
    case "select":
    case "status":
      return resolveOption(definition, value);
    case "multi_select":
      if (!Array.isArray(value))
        invalidProperty(definition, "expected an array of options");
      return [
        ...new Set(
          value.map((candidate) => resolveOption(definition, candidate)),
        ),
      ];
    case "date":
      return strictDate(definition, value);
    case "person":
      if (
        !Array.isArray(value) ||
        value.some(
          (entry) =>
            typeof entry !== "string" || !entry || entry !== entry.trim(),
        )
      )
        invalidProperty(definition, "expected an array of person identifiers");
      return [...new Set(value)];
    case "files_media": {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
      )
        invalidProperty(definition, "expected an array of file URLs");
      const urls = value.map((entry) => entry.trim());
      if (
        value.some((entry, index) => entry !== urls[index]) ||
        urls.some((entry) => {
          try {
            const url = new URL(entry);
            return url.protocol !== "http:" && url.protocol !== "https:";
          } catch {
            return true;
          }
        })
      ) {
        invalidProperty(definition, "files must use http or https URLs");
      }
      return [...new Set(urls)];
    }
    case "url": {
      if (typeof value !== "string" || value !== value.trim())
        invalidProperty(definition, "expected a URL");
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error();
      } catch {
        invalidProperty(definition, "expected an http or https URL");
      }
      return value;
    }
    case "email":
      if (
        typeof value !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      )
        invalidProperty(definition, "expected an email address");
      return value;
    case "text":
    case "place":
    case "phone":
      if (typeof value !== "string")
        invalidProperty(definition, "expected a string");
      return value;
    default:
      invalidProperty(definition, `property type "${type}" is not writable`);
  }
}

async function normalizePatch(
  context: MutationContext,
  propertyValues: Record<string, unknown> | undefined,
) {
  const definitionsById = new Map(
    context.definitions.map((definition) => [definition.id, definition]),
  );
  const normalized = new Map<string, string>();
  for (const [propertyId, input] of Object.entries(propertyValues ?? {})) {
    const definition = definitionsById.get(propertyId);
    if (!definition) {
      throw new ActionContractError(`Unknown property "${propertyId}".`, {
        errorCode: "UNKNOWN_PROPERTY",
        details: { propertyId },
        statusCode: 400,
      });
    }
    const type = definition.type as DocumentPropertyType;
    if (
      definition.systemRole ||
      context.sourceManagedPropertyIds.has(propertyId) ||
      type === "relation" ||
      isComputedPropertyType(type) ||
      isBlocksPropertyType(type)
    ) {
      throw new ActionContractError(
        `Property "${definition.name}" is not writable by database row mutations.`,
        {
          errorCode: "PROPERTY_NOT_WRITABLE",
          details: { propertyId, propertyType: type },
          statusCode: 400,
        },
      );
    }
    normalized.set(
      propertyId,
      serializePropertyValue(await strictValue(definition, input)),
    );
    if (
      propertyId === context.database.naturalKeyPropertyId &&
      (typeof input !== "string" || !input.trim())
    ) {
      invalidProperty(definition, "natural key must be a non-empty string");
    }
  }
  return normalized;
}

async function ensureNaturalKeyClaim(
  db: Db,
  context: MutationContext,
  args: {
    itemId: string;
    documentId: string;
    values: Map<string, string>;
    now: string;
  },
) {
  const propertyId = context.database.naturalKeyPropertyId;
  if (!propertyId) return;
  const keyValueJson = args.values.get(propertyId);
  if (keyValueJson === undefined) return;
  const [existing] = await db
    .select({
      keyValueJson: schema.contentDatabaseItemKeyClaims.keyValueJson,
    })
    .from(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, context.database.id),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
        eq(schema.contentDatabaseItemKeyClaims.documentId, args.documentId),
      ),
    )
    .limit(1);
  if (existing && existing.keyValueJson !== keyValueJson) {
    conflict(
      "NATURAL_KEY_IMMUTABLE",
      "A claimed database natural key cannot be changed. Create a new row instead.",
      { propertyId, itemId: args.itemId, documentId: args.documentId },
    );
  }
  await db
    .insert(schema.contentDatabaseItemKeyClaims)
    .values({
      id: nanoid(),
      ownerEmail: context.database.ownerEmail,
      orgId: context.database.orgId,
      databaseId: context.database.id,
      propertyId,
      keyValueJson,
      itemId: args.itemId,
      documentId: args.documentId,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
  const [claim] = await db
    .select({
      itemId: schema.contentDatabaseItemKeyClaims.itemId,
      documentId: schema.contentDatabaseItemKeyClaims.documentId,
    })
    .from(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, context.database.id),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
        eq(schema.contentDatabaseItemKeyClaims.keyValueJson, keyValueJson),
      ),
    );
  if (
    !claim ||
    claim.itemId !== args.itemId ||
    claim.documentId !== args.documentId
  ) {
    conflict("NATURAL_KEY_CONFLICT", "The natural key is already in use.", {
      propertyId,
    });
  }
}

async function rowSnapshot(
  db: Db,
  databaseId: string,
  itemId: string,
  documentId: string,
  revisionPropertyIds: Set<string>,
): Promise<RowSnapshot | null> {
  const [row] = await db
    .select({ item: schema.contentDatabaseItems, document: schema.documents })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.id, itemId),
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        eq(schema.contentDatabaseItems.documentId, documentId),
        isNull(schema.documents.trashedAt),
      ),
    );
  if (!row) return null;
  const values =
    revisionPropertyIds.size === 0
      ? []
      : await db
          .select()
          .from(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.documentId, documentId),
              inArray(schema.documentPropertyValues.propertyId, [
                ...revisionPropertyIds,
              ]),
            ),
          );
  const valueMap = new Map(
    values.map((value) => [value.propertyId, value.valueJson]),
  );
  const revision = databaseRowRevision({
    itemId,
    documentId,
    title: row.document.title,
    values: [...valueMap.entries()].map(([propertyId, valueJson]) => ({
      propertyId,
      value: parsePropertyValue(valueJson),
    })),
  });
  return { ...row, values: valueMap, revision };
}

function revisionPropertyIds(context: MutationContext) {
  return new Set(
    context.definitions
      .filter(
        (definition) =>
          !isBlocksPropertyType(definition.type as DocumentPropertyType) &&
          !isComputedPropertyType(definition.type as DocumentPropertyType),
      )
      .map((definition) => definition.id),
  );
}

function payloadDigest(
  operation: DatabaseRowMutationOperation,
  input:
    | CreateDatabaseRowMutationInput
    | UpdateDatabaseRowMutationInput
    | UpsertDatabaseRowMutationInput,
) {
  return digest({ operation, ...input });
}

function resultForReceipt(
  operation: DatabaseRowMutationOperation,
  outcome: "created" | "updated" | "unchanged",
  context: MutationContext,
  snapshot: RowSnapshot,
  args: {
    receiptId: string;
    idempotencyKey: string;
    payloadDigest: string;
    preRowRevision: string | null;
    affectedPropertyIds: string[];
    titleAffected: boolean;
    idempotencyResult: "applied" | "replayed";
  },
): ContentDatabaseRowMutationResult {
  const target = {
    authorityScope: context.database.orgId
      ? ({ kind: "organization", id: context.database.orgId } as const)
      : ({ kind: "personal", id: context.database.ownerEmail } as const),
    spaceId: context.database.spaceId!,
    databaseId: context.database.id,
    databaseDocumentId: context.database.documentId,
  };
  const receipt: ContentDatabaseRowMutationReceipt = {
    receiptId: args.receiptId,
    operation,
    outcome,
    target,
    schemaRevision: context.schemaRevision,
    row: {
      itemId: snapshot.item.id,
      documentId: snapshot.document.id,
      urlPath: `/page/${snapshot.document.id}`,
      rowRevision: snapshot.revision,
    },
    affected: {
      title: args.titleAffected,
      propertyIds: args.affectedPropertyIds.sort(),
    },
    idempotency: {
      key: args.idempotencyKey,
      result: args.idempotencyResult,
      payloadDigest: args.payloadDigest,
    },
    revisions: {
      before: args.preRowRevision,
      after: snapshot.revision,
    },
    readback: {
      verified: true,
      title: snapshot.document.title,
      propertyValues: Object.fromEntries(
        [...snapshot.values.entries()].map(([propertyId, valueJson]) => [
          propertyId,
          parsePropertyValue(valueJson),
        ]),
      ),
    },
  };
  return { receipt };
}

async function replayReceipt(
  context: MutationContext,
  idempotencyKey: string,
  expectedPayloadDigest: string,
  db: Db = getDb(),
): Promise<ContentDatabaseRowMutationResult | null> {
  const [stored] = await db
    .select()
    .from(schema.contentDatabaseRowMutationReceipts)
    .where(
      and(
        eq(
          schema.contentDatabaseRowMutationReceipts.databaseId,
          context.database.id,
        ),
        eq(
          schema.contentDatabaseRowMutationReceipts.idempotencyKey,
          idempotencyKey,
        ),
      ),
    );
  if (!stored) return null;
  if (stored.payloadDigest !== expectedPayloadDigest) {
    conflict(
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different row mutation.",
      { idempotencyKey },
    );
  }
  await assertAccess("document", stored.documentId, "viewer");
  const parsed = JSON.parse(
    stored.resultJson,
  ) as ContentDatabaseRowMutationResult;
  if (
    parsed.receipt.receiptId !== stored.id ||
    parsed.receipt.row.itemId !== stored.itemId ||
    parsed.receipt.row.documentId !== stored.documentId ||
    parsed.receipt.row.rowRevision !== stored.postRowRevision
  ) {
    conflict(
      "RECEIPT_MISMATCH",
      "The stored database row mutation receipt is inconsistent.",
      { receiptId: stored.id },
    );
  }
  return {
    receipt: {
      ...parsed.receipt,
      idempotency: { ...parsed.receipt.idempotency, result: "replayed" },
    },
  };
}

async function insertReceipt(
  db: Db,
  context: MutationContext,
  operation: DatabaseRowMutationOperation,
  input: { idempotencyKey: string },
  inputDigest: string,
  result: ContentDatabaseRowMutationResult,
) {
  const now = new Date().toISOString();
  const receipt = result.receipt;
  await db.insert(schema.contentDatabaseRowMutationReceipts).values({
    id: receipt.receiptId,
    ownerEmail: context.database.ownerEmail,
    orgId: context.database.orgId,
    spaceId: context.database.spaceId!,
    databaseId: context.database.id,
    databaseDocumentId: context.database.documentId,
    operation,
    itemId: receipt.row.itemId,
    documentId: receipt.row.documentId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest: inputDigest,
    schemaRevision: receipt.schemaRevision,
    preRowRevision: receipt.revisions.before,
    postRowRevision: receipt.revisions.after,
    resultJson: JSON.stringify(result),
    createdAt: now,
    updatedAt: now,
  });
}

function assertSchema(context: MutationContext, expected: string) {
  if (context.schemaRevision !== expected) {
    conflict("SCHEMA_REVISION_CONFLICT", "The database schema changed.", {
      expected,
      actual: context.schemaRevision,
    });
  }
}

async function withMutationLocks<T>(
  database: DatabaseRow,
  run: () => Promise<T>,
): Promise<T> {
  return withPositionLock(
    documentsPositionScope(database.ownerEmail, database.documentId),
    () => withPositionLock(databaseItemsPositionScope(database.id), run),
  );
}

async function createInsideTransaction(
  tx: Db,
  context: MutationContext,
  args: {
    title?: string;
    values: Map<string, string>;
    itemId?: string;
    documentId?: string;
  },
) {
  const now = new Date().toISOString();
  const documentId = args.documentId ?? nanoid();
  const itemId = args.itemId ?? nanoid();
  const [maxDoc] = await tx
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.ownerEmail, context.database.ownerEmail),
        eq(schema.documents.parentId, context.database.documentId),
      ),
    );
  const [maxItem] = await tx
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, context.database.id));
  const shares = await tx
    .select({
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
      role: schema.documentShares.role,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, context.database.documentId));
  await tx.insert(schema.documents).values({
    id: documentId,
    spaceId: context.database.spaceId,
    ownerEmail: context.database.ownerEmail,
    orgId: context.database.orgId,
    parentId: context.database.documentId,
    title: args.title?.trim() ?? "",
    content: "",
    icon: null,
    position: (maxDoc?.max ?? -1) + 1,
    isFavorite: 0,
    hideFromSearch: context.databaseDocument.hideFromSearch ?? 0,
    visibility: context.databaseDocument.visibility ?? "private",
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: context.database.ownerEmail,
    orgId: context.database.orgId,
    databaseId: context.database.id,
    documentId,
    position: (maxItem?.max ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  });
  if (args.values.size > 0) {
    await tx.insert(schema.documentPropertyValues).values(
      [...args.values.entries()].map(([propertyId, valueJson]) => ({
        id: nanoid(),
        ownerEmail: context.database.ownerEmail,
        documentId,
        propertyId,
        valueJson,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  if (shares.length > 0) {
    await tx.insert(schema.documentShares).values(
      shares.map((share) => ({
        id: nanoid(),
        resourceId: documentId,
        principalType: share.principalType,
        principalId: share.principalId,
        role: share.role,
        createdBy: getRequestUserEmail() ?? context.database.ownerEmail,
        createdAt: now,
      })),
    );
  }
  await ensureDocumentFilesMembership(tx, documentId, now);
  await ensureNaturalKeyClaim(tx, context, {
    itemId,
    documentId,
    values: args.values,
    now,
  });
  const snapshot = await rowSnapshot(
    tx,
    context.database.id,
    itemId,
    documentId,
    revisionPropertyIds(context),
  );
  if (!snapshot)
    throw new Error("Created row could not be read in its transaction.");
  return snapshot;
}

async function updateInsideTransaction(
  tx: Db,
  context: MutationContext,
  args: {
    itemId: string;
    documentId: string;
    expectedRowRevision: string;
    title?: string;
    values: Map<string, string>;
  },
) {
  await assertAccess("document", args.documentId, "editor");
  const [lockedDocument] = await tx
    .update(schema.documents)
    .set({ updatedAt: sql`${schema.documents.updatedAt}` })
    .where(
      and(
        eq(schema.documents.id, args.documentId),
        isNull(schema.documents.trashedAt),
      ),
    )
    .returning({ id: schema.documents.id });
  if (!lockedDocument) {
    throw new ActionContractError("The exact database row was not found.", {
      errorCode: "ROW_NOT_FOUND",
      statusCode: 404,
    });
  }
  await tx
    .update(schema.contentDatabaseItems)
    .set({ updatedAt: sql`${schema.contentDatabaseItems.updatedAt}` })
    .where(
      and(
        eq(schema.contentDatabaseItems.id, args.itemId),
        eq(schema.contentDatabaseItems.databaseId, context.database.id),
        eq(schema.contentDatabaseItems.documentId, args.documentId),
      ),
    );
  const before = await rowSnapshot(
    tx,
    context.database.id,
    args.itemId,
    args.documentId,
    revisionPropertyIds(context),
  );
  if (!before) {
    throw new ActionContractError("The exact database row was not found.", {
      errorCode: "ROW_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (before.revision !== args.expectedRowRevision) {
    conflict("ROW_REVISION_CONFLICT", "The database row changed.", {
      expected: args.expectedRowRevision,
      actual: before.revision,
      itemId: args.itemId,
      documentId: args.documentId,
    });
  }
  const now = new Date().toISOString();
  const changedValues = [...args.values.entries()].filter(
    ([propertyId, valueJson]) => before.values.get(propertyId) !== valueJson,
  );
  const titleChanged =
    args.title !== undefined && args.title.trim() !== before.document.title;
  if (titleChanged) {
    const nextUpdatedAt =
      now > before.document.updatedAt
        ? now
        : new Date(
            new Date(before.document.updatedAt).getTime() + 1,
          ).toISOString();
    const [updatedDocument] = await tx
      .update(schema.documents)
      .set({ title: args.title!.trim(), updatedAt: nextUpdatedAt })
      .where(
        and(
          eq(schema.documents.id, args.documentId),
          eq(schema.documents.updatedAt, before.document.updatedAt),
          isNull(schema.documents.trashedAt),
        ),
      )
      .returning({ id: schema.documents.id });
    if (!updatedDocument) {
      conflict("ROW_REVISION_CONFLICT", "The database row changed.", {
        expected: args.expectedRowRevision,
        itemId: args.itemId,
        documentId: args.documentId,
      });
    }
  }
  for (const [propertyId, valueJson] of changedValues) {
    const existing = before.values.get(propertyId);
    if (existing !== undefined) {
      await tx
        .update(schema.documentPropertyValues)
        .set({ valueJson, updatedAt: now })
        .where(
          and(
            eq(schema.documentPropertyValues.documentId, args.documentId),
            eq(schema.documentPropertyValues.propertyId, propertyId),
          ),
        );
    } else {
      await tx.insert(schema.documentPropertyValues).values({
        id: nanoid(),
        ownerEmail: context.database.ownerEmail,
        documentId: args.documentId,
        propertyId,
        valueJson,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await ensureNaturalKeyClaim(tx, context, {
    itemId: args.itemId,
    documentId: args.documentId,
    values: args.values,
    now,
  });
  const after = await rowSnapshot(
    tx,
    context.database.id,
    args.itemId,
    args.documentId,
    revisionPropertyIds(context),
  );
  if (!after)
    throw new Error("Updated row could not be read in its transaction.");
  return {
    before,
    after,
    changedPropertyIds: changedValues.map(([propertyId]) => propertyId),
    titleChanged,
  };
}

export async function createDatabaseRow(
  input: CreateDatabaseRowMutationInput,
): Promise<ContentDatabaseRowMutationResult> {
  const initial = await loadContext(input.target, "editor");
  const inputDigest = payloadDigest("create", input);
  const replay = await replayReceipt(
    initial,
    input.idempotencyKey,
    inputDigest,
  );
  if (replay) return replay;
  assertSchema(initial, input.expectedSchemaRevision);
  const values = await normalizePatch(initial, input.propertyValues);
  const result = await withMutationLocks(initial.database, () =>
    getDb().transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as Db,
        initial.database.id,
      );
      const locked = await loadContext(
        input.target,
        "editor",
        tx as unknown as Db,
      );
      const lockedReplay = await replayReceipt(
        locked,
        input.idempotencyKey,
        inputDigest,
        tx as unknown as Db,
      );
      if (lockedReplay) return lockedReplay;
      assertSchema(locked, input.expectedSchemaRevision);
      await touchContentDatabase(
        tx as unknown as Db,
        locked.database.id,
        new Date().toISOString(),
      );
      const snapshot = await createInsideTransaction(
        tx as unknown as Db,
        locked,
        {
          title: input.title,
          values,
        },
      );
      const built = resultForReceipt("create", "created", locked, snapshot, {
        receiptId: nanoid(),
        idempotencyKey: input.idempotencyKey,
        payloadDigest: inputDigest,
        preRowRevision: null,
        affectedPropertyIds: [...values.keys()],
        titleAffected: input.title !== undefined,
        idempotencyResult: "applied",
      });
      await insertReceipt(
        tx as unknown as Db,
        locked,
        "create",
        input,
        inputDigest,
        built,
      );
      return built;
    }),
  );
  return result;
}

export async function updateDatabaseRow(
  input: UpdateDatabaseRowMutationInput,
): Promise<ContentDatabaseRowMutationResult> {
  const initial = await loadContext(input.target, "editor");
  await assertAccess("document", input.documentId, "editor");
  const inputDigest = payloadDigest("update", input);
  const replay = await replayReceipt(
    initial,
    input.idempotencyKey,
    inputDigest,
  );
  if (replay) return replay;
  assertSchema(initial, input.expectedSchemaRevision);
  const values = await normalizePatch(initial, input.propertyValues);
  const result = await withMutationLocks(initial.database, () =>
    getDb().transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as Db,
        initial.database.id,
      );
      const locked = await loadContext(
        input.target,
        "editor",
        tx as unknown as Db,
      );
      const lockedReplay = await replayReceipt(
        locked,
        input.idempotencyKey,
        inputDigest,
        tx as unknown as Db,
      );
      if (lockedReplay) return lockedReplay;
      assertSchema(locked, input.expectedSchemaRevision);
      const updated = await updateInsideTransaction(
        tx as unknown as Db,
        locked,
        {
          itemId: input.itemId,
          documentId: input.documentId,
          expectedRowRevision: input.expectedRowRevision,
          title: input.title,
          values,
        },
      );
      await touchContentDatabase(
        tx as unknown as Db,
        locked.database.id,
        new Date().toISOString(),
      );
      const built = resultForReceipt(
        "update",
        updated.titleChanged || updated.changedPropertyIds.length > 0
          ? "updated"
          : "unchanged",
        locked,
        updated.after,
        {
          receiptId: nanoid(),
          idempotencyKey: input.idempotencyKey,
          payloadDigest: inputDigest,
          preRowRevision: updated.before.revision,
          affectedPropertyIds: updated.changedPropertyIds,
          titleAffected: updated.titleChanged,
          idempotencyResult: "applied",
        },
      );
      await insertReceipt(
        tx as unknown as Db,
        locked,
        "update",
        input,
        inputDigest,
        built,
      );
      return built;
    }),
  );
  return result;
}

export async function upsertDatabaseRow(
  input: UpsertDatabaseRowMutationInput,
): Promise<ContentDatabaseRowMutationResult> {
  const initial = await loadContext(input.target, "editor");
  const replayKeyPropertyId = initial.database.naturalKeyPropertyId;
  const replayKeyDefinition = replayKeyPropertyId
    ? initial.definitions.find(
        (definition) => definition.id === replayKeyPropertyId,
      )
    : undefined;
  if (
    replayKeyDefinition?.type === "text" &&
    Object.prototype.hasOwnProperty.call(
      input.propertyValues ?? {},
      replayKeyPropertyId,
    ) &&
    input.propertyValues?.[replayKeyPropertyId] !== input.keyValue
  ) {
    invalidProperty(
      replayKeyDefinition,
      "must match the upsert keyValue when provided in propertyValues",
    );
  }
  const inputDigest = payloadDigest("upsert", input);
  const replay = await replayReceipt(
    initial,
    input.idempotencyKey,
    inputDigest,
  );
  if (replay) return replay;
  assertSchema(initial, input.expectedSchemaRevision);
  const keyPropertyId = initial.database.naturalKeyPropertyId;
  if (!keyPropertyId) {
    throw new ActionContractError(
      "This database has no configured natural key.",
      {
        errorCode: "NATURAL_KEY_NOT_CONFIGURED",
        statusCode: 400,
      },
    );
  }
  const keyDefinition = initial.definitions.find(
    (definition) => definition.id === keyPropertyId,
  );
  if (!keyDefinition || keyDefinition.type !== "text") {
    conflict(
      "NATURAL_KEY_INVALID",
      "The configured natural key is missing or no longer a text property.",
      { keyPropertyId },
    );
  }
  const values = await normalizePatch(initial, {
    ...(input.propertyValues ?? {}),
    [keyPropertyId]: input.keyValue,
  });
  const keyValueJson = values.get(keyPropertyId)!;
  const [initialClaim] = await getDb()
    .select({
      itemId: schema.contentDatabaseItemKeyClaims.itemId,
      documentId: schema.contentDatabaseItemKeyClaims.documentId,
    })
    .from(schema.contentDatabaseItemKeyClaims)
    .where(
      and(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, initial.database.id),
        eq(schema.contentDatabaseItemKeyClaims.propertyId, keyPropertyId),
        eq(schema.contentDatabaseItemKeyClaims.keyValueJson, keyValueJson),
      ),
    );
  if (initialClaim) {
    await assertAccess("document", initialClaim.documentId, "editor");
  }
  const result = await withMutationLocks(initial.database, () =>
    getDb().transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as Db,
        initial.database.id,
      );
      const locked = await loadContext(
        input.target,
        "editor",
        tx as unknown as Db,
      );
      const lockedReplay = await replayReceipt(
        locked,
        input.idempotencyKey,
        inputDigest,
        tx as unknown as Db,
      );
      if (lockedReplay) return lockedReplay;
      assertSchema(locked, input.expectedSchemaRevision);
      if (locked.database.naturalKeyPropertyId !== keyPropertyId) {
        conflict("SCHEMA_REVISION_CONFLICT", "The natural key changed.");
      }
      const [claim] = await tx
        .select()
        .from(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(
              schema.contentDatabaseItemKeyClaims.databaseId,
              locked.database.id,
            ),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, keyPropertyId),
            eq(schema.contentDatabaseItemKeyClaims.keyValueJson, keyValueJson),
          ),
        );
      if (!claim && input.expectedRowRevision !== null) {
        conflict("ROW_NOT_FOUND", "No row exists for this natural key.", {
          keyPropertyId,
          keyValue: input.keyValue,
        });
      }
      if (claim && input.expectedRowRevision === null) {
        conflict(
          "ROW_ALREADY_EXISTS",
          "A row already exists for this natural key.",
        );
      }
      if (
        claim &&
        (!initialClaim ||
          initialClaim.itemId !== claim.itemId ||
          initialClaim.documentId !== claim.documentId)
      ) {
        conflict(
          "ROW_REVISION_CONFLICT",
          "The natural-key row changed while the mutation was starting.",
        );
      }
      if (!claim) {
        const itemId = nanoid();
        const documentId = nanoid();
        const now = new Date().toISOString();
        await tx.insert(schema.contentDatabaseItemKeyClaims).values({
          id: nanoid(),
          ownerEmail: locked.database.ownerEmail,
          orgId: locked.database.orgId,
          databaseId: locked.database.id,
          propertyId: keyPropertyId,
          keyValueJson,
          itemId,
          documentId,
          createdAt: now,
          updatedAt: now,
        });
        const snapshot = await createInsideTransaction(
          tx as unknown as Db,
          locked,
          {
            title: input.title,
            values,
            itemId,
            documentId,
          },
        );
        await touchContentDatabase(
          tx as unknown as Db,
          locked.database.id,
          now,
        );
        const built = resultForReceipt("upsert", "created", locked, snapshot, {
          receiptId: nanoid(),
          idempotencyKey: input.idempotencyKey,
          payloadDigest: inputDigest,
          preRowRevision: null,
          affectedPropertyIds: [...values.keys()],
          titleAffected: input.title !== undefined,
          idempotencyResult: "applied",
        });
        await insertReceipt(
          tx as unknown as Db,
          locked,
          "upsert",
          input,
          inputDigest,
          built,
        );
        return built;
      }
      const updated = await updateInsideTransaction(
        tx as unknown as Db,
        locked,
        {
          itemId: claim.itemId,
          documentId: claim.documentId,
          expectedRowRevision: input.expectedRowRevision!,
          title: input.title,
          values,
        },
      );
      await touchContentDatabase(
        tx as unknown as Db,
        locked.database.id,
        new Date().toISOString(),
      );
      const built = resultForReceipt(
        "upsert",
        updated.titleChanged || updated.changedPropertyIds.length > 0
          ? "updated"
          : "unchanged",
        locked,
        updated.after,
        {
          receiptId: nanoid(),
          idempotencyKey: input.idempotencyKey,
          payloadDigest: inputDigest,
          preRowRevision: updated.before.revision,
          affectedPropertyIds: updated.changedPropertyIds,
          titleAffected: updated.titleChanged,
          idempotencyResult: "applied",
        },
      );
      await insertReceipt(
        tx as unknown as Db,
        locked,
        "upsert",
        input,
        inputDigest,
        built,
      );
      return built;
    }),
  );
  return result;
}
