import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, exists, inArray, isNull, like } from "drizzle-orm";

import type {
  CrmAccessScope,
  CrmRelationship,
  CrmValue,
} from "../../shared/crm-contract.js";
import {
  isBoundedCrmValue,
  isSafeCrmMutationFieldName,
} from "../crm/crm-field-firewall.js";
import { createHubSpotCrmAdapter } from "../crm/hubspot-adapter.js";
import {
  parseCrmAccessScope,
  relatedSummaries,
  scopesAreCompatible,
  type RelatedRecordSummary,
} from "../crm/read-through.js";
import { getDb, schema } from "./index.js";

const MAX_RECORD_LIMIT = 100;
const RECORD_DETAIL_LIMIT = 20;
const MAX_SCOPE_VALIDATIONS = 20;
const SAFE_VIEW_COLUMNS = new Set([
  "displayName",
  "primaryEmail",
  "domain",
  "stage",
  "ownerName",
  "nextContactAt",
  "remoteUpdatedAt",
  "updatedAt",
]);
const SAFE_VIEW_SORTS = new Set([
  "displayName",
  "stage",
  "ownerName",
  "nextContactAt",
  "remoteUpdatedAt",
  "updatedAt",
]);

export type CrmListKind =
  | "account"
  | "person"
  | "opportunity"
  | "activity"
  | "task"
  | "custom";

type Primitive = string | number | boolean | null;

type SavedViewConfig = {
  id: string;
  name: string;
  kind?: CrmListKind;
  dataProgramId?: string;
  query?: string;
  fieldEquals: Record<string, Primitive>;
  columns: string[];
  sort: Array<{ field: string; direction: "asc" | "desc" }>;
};

type ScopeValidationTarget = {
  connectionId: string;
  workspaceConnectionId: string | null;
  provider: string;
  objectType: string;
};

export type CrmScopeResolver = (
  target: ScopeValidationTarget,
) => Promise<CrmAccessScope | null>;

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function page<T>(rows: T[], limit: number) {
  return {
    rows: rows.slice(0, limit),
    nextCursor:
      rows.length > limit ? String(decodeCursor(undefined) + limit) : undefined,
  };
}

function toRecordSummary(
  row: {
    id: string;
    displayName: string;
    kind: string;
    primaryEmail: string | null;
    domain: string | null;
    stage: string | null;
    ownerName: string | null;
    nextContactAt: string | null;
    remoteUpdatedAt: string | null;
    updatedAt: string;
  },
  columns?: string[],
) {
  const included = new Set(columns ?? SAFE_VIEW_COLUMNS);
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    ...(included.has("domain") || included.has("primaryEmail")
      ? { subtitle: row.domain ?? row.primaryEmail ?? undefined }
      : {}),
    ...(included.has("ownerName") ? { owner: row.ownerName ?? undefined } : {}),
    ...(included.has("stage") ? { stage: row.stage ?? undefined } : {}),
    ...(included.has("nextContactAt")
      ? { nextStep: row.nextContactAt ?? undefined }
      : {}),
    ...(included.has("remoteUpdatedAt") || included.has("updatedAt")
      ? { updatedAt: row.remoteUpdatedAt ?? row.updatedAt }
      : {}),
  };
}

function parseStoredValue(row: {
  valueType: string;
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}): unknown {
  if (row.booleanValue !== null) return row.booleanValue;
  if (row.numberValue !== null) return row.numberValue;
  if (row.stringValue !== null) return row.stringValue;
  if (!row.jsonValue) return null;
  try {
    return JSON.parse(row.jsonValue) as unknown;
  } catch {
    return null;
  }
}

function parsePrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 2_000)
  );
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseSavedViewConfig(input: {
  id: string;
  name: string;
  kind: string | null;
  filtersJson: string;
  columnsJson: string;
  sortJson: string;
  dataProgramId: string | null;
}): SavedViewConfig {
  if (
    input.kind !== null &&
    input.kind !== "account" &&
    input.kind !== "person" &&
    input.kind !== "opportunity"
  ) {
    throw new Error("CRM saved view has an unsupported record kind.");
  }
  const filters = parseJsonObject(input.filtersJson);
  if (!filters) throw new Error("CRM saved view filters are invalid.");
  const filterKeys = Object.keys(filters);
  if (filterKeys.some((key) => key !== "query" && key !== "fieldEquals")) {
    throw new Error("CRM saved view contains unsupported filters.");
  }
  const query = filters.query;
  if (
    query !== undefined &&
    (typeof query !== "string" || query.length > 120)
  ) {
    throw new Error("CRM saved view query is invalid.");
  }
  const rawFieldEquals = filters.fieldEquals;
  if (
    rawFieldEquals !== undefined &&
    (!rawFieldEquals ||
      typeof rawFieldEquals !== "object" ||
      Array.isArray(rawFieldEquals))
  ) {
    throw new Error("CRM saved view field filters are invalid.");
  }
  const fieldEquals = Object.entries(
    (rawFieldEquals ?? {}) as Record<string, unknown>,
  );
  if (
    fieldEquals.length > 12 ||
    fieldEquals.some(
      ([fieldName, value]) =>
        !fieldName.trim() || fieldName.length > 120 || !parsePrimitive(value),
    )
  ) {
    throw new Error("CRM saved view field filters must be bounded primitives.");
  }
  const columns = JSON.parse(input.columnsJson) as unknown;
  if (
    !Array.isArray(columns) ||
    columns.length > 20 ||
    columns.some(
      (column) => typeof column !== "string" || !SAFE_VIEW_COLUMNS.has(column),
    )
  ) {
    throw new Error("CRM saved view columns are unsupported.");
  }
  const sort = JSON.parse(input.sortJson) as unknown;
  if (
    !Array.isArray(sort) ||
    sort.length > 2 ||
    sort.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        !SAFE_VIEW_SORTS.has((entry as { field?: string }).field ?? "") ||
        ((entry as { direction?: string }).direction !== "asc" &&
          (entry as { direction?: string }).direction !== "desc"),
    )
  ) {
    throw new Error("CRM saved view sort is unsupported.");
  }
  return {
    id: input.id,
    name: input.name,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.dataProgramId ? { dataProgramId: input.dataProgramId } : {}),
    ...(query ? { query } : {}),
    fieldEquals: Object.fromEntries(fieldEquals) as Record<string, Primitive>,
    columns,
    sort: sort as Array<{ field: string; direction: "asc" | "desc" }>,
  };
}

function fieldEqualsCondition(fieldName: string, value: Primitive) {
  const scalarCondition =
    value === null
      ? and(
          isNull(schema.crmRecordFields.stringValue),
          isNull(schema.crmRecordFields.numberValue),
          isNull(schema.crmRecordFields.booleanValue),
          isNull(schema.crmRecordFields.jsonValue),
        )
      : typeof value === "string"
        ? eq(schema.crmRecordFields.stringValue, value)
        : typeof value === "number"
          ? eq(schema.crmRecordFields.numberValue, value)
          : eq(schema.crmRecordFields.booleanValue, value);
  return exists(
    getDb()
      .select({ id: schema.crmRecordFields.id })
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.recordId, schema.crmRecords.id),
          eq(schema.crmRecordFields.fieldName, fieldName),
          eq(schema.crmRecordFields.storagePolicy, "mirrored"),
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
          scalarCondition,
        ),
      ),
  );
}

function orderForSavedView(view: SavedViewConfig | undefined) {
  const sort = view?.sort[0];
  const column =
    sort?.field === "displayName"
      ? schema.crmRecords.displayName
      : sort?.field === "stage"
        ? schema.crmRecords.stage
        : sort?.field === "ownerName"
          ? schema.crmRecords.ownerName
          : sort?.field === "nextContactAt"
            ? schema.crmRecords.nextContactAt
            : sort?.field === "updatedAt"
              ? schema.crmRecords.updatedAt
              : schema.crmRecords.remoteUpdatedAt;
  const direction = sort?.direction === "asc" ? asc : desc;
  return [direction(column), desc(schema.crmRecords.id)];
}

async function defaultScopeResolver(
  target: ScopeValidationTarget,
): Promise<CrmAccessScope | null> {
  if (target.provider !== "hubspot" || !target.workspaceConnectionId)
    return null;
  const adapter = await createHubSpotCrmAdapter({
    connectionId: target.workspaceConnectionId,
  });
  return adapter.getAccessScope(target.objectType);
}

export async function listCrmRecords(
  input: {
    kind?: CrmListKind;
    connectionId?: string;
    query?: string;
    viewId?: string;
    limit: number;
    cursor?: string;
  },
  options: { resolveScope?: CrmScopeResolver } = {},
) {
  const db = getDb();
  const offset = decodeCursor(input.cursor);
  const limit = Math.min(input.limit, MAX_RECORD_LIMIT);
  const viewRow = input.viewId
    ? await db
        .select({
          id: schema.crmSavedViews.id,
          name: schema.crmSavedViews.name,
          kind: schema.crmSavedViews.kind,
          filtersJson: schema.crmSavedViews.filtersJson,
          columnsJson: schema.crmSavedViews.columnsJson,
          sortJson: schema.crmSavedViews.sortJson,
          dataProgramId: schema.crmSavedViews.dataProgramId,
        })
        .from(schema.crmSavedViews)
        .where(
          and(
            eq(schema.crmSavedViews.id, input.viewId),
            accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
          ),
        )
        .limit(1)
    : [];
  if (input.viewId && !viewRow[0])
    throw new Error("CRM saved view was not found.");
  const view = viewRow[0] ? parseSavedViewConfig(viewRow[0]) : undefined;
  if (input.kind && view?.kind && input.kind !== view.kind) {
    throw new Error("CRM saved view kind cannot be overridden.");
  }
  if (input.query && view?.query && input.query !== view.query) {
    throw new Error("CRM saved view query cannot be overridden.");
  }
  const kind = view?.kind ?? input.kind;
  const query = view?.query ?? input.query;
  const conditions = [
    accessFilter(schema.crmRecords, schema.crmRecordShares),
    accessFilter(schema.crmConnections, schema.crmConnectionShares),
    eq(schema.crmRecords.tombstone, false),
  ];

  if (kind) conditions.push(eq(schema.crmRecords.kind, kind));
  if (input.connectionId) {
    conditions.push(eq(schema.crmRecords.connectionId, input.connectionId));
  }
  if (query) {
    conditions.push(like(schema.crmRecords.displayName, `%${query}%`));
  }
  for (const [fieldName, value] of Object.entries(view?.fieldEquals ?? {})) {
    conditions.push(fieldEqualsCondition(fieldName, value));
  }

  const rows = await db
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
      kind: schema.crmRecords.kind,
      primaryEmail: schema.crmRecords.primaryEmail,
      domain: schema.crmRecords.domain,
      stage: schema.crmRecords.stage,
      ownerName: schema.crmRecords.ownerName,
      nextContactAt: schema.crmRecords.nextContactAt,
      remoteUpdatedAt: schema.crmRecords.remoteUpdatedAt,
      updatedAt: schema.crmRecords.updatedAt,
      connectionId: schema.crmRecords.connectionId,
      objectType: schema.crmRecords.objectType,
      provider: schema.crmRecords.provider,
      accessScopeJson: schema.crmRecords.accessScopeJson,
      workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
    })
    .from(schema.crmRecords)
    .innerJoin(
      schema.crmConnections,
      eq(schema.crmRecords.connectionId, schema.crmConnections.id),
    )
    .where(and(...conditions))
    .orderBy(...orderForSavedView(view))
    .limit(limit + 1)
    .offset(offset);
  const result = page(rows, limit);
  const scopeResolver = options.resolveScope ?? defaultScopeResolver;
  const scopeTargets = Array.from(
    new Map(
      result.rows.map((row) => [
        `${row.connectionId}:${row.objectType}`,
        {
          connectionId: row.connectionId,
          workspaceConnectionId: row.workspaceConnectionId,
          provider: row.provider,
          objectType: row.objectType,
        },
      ]),
    ).values(),
  ).slice(0, MAX_SCOPE_VALIDATIONS);
  const currentScopes = new Map(
    await Promise.all(
      scopeTargets.map(
        async (target) =>
          [
            `${target.connectionId}:${target.objectType}`,
            await scopeResolver(target).catch(() => null),
          ] as const,
      ),
    ),
  );
  const records = result.rows
    .filter((row) => {
      const current = currentScopes.get(
        `${row.connectionId}:${row.objectType}`,
      );
      return Boolean(
        current &&
        scopesAreCompatible(parseCrmAccessScope(row.accessScopeJson), current),
      );
    })
    .map((row) => toRecordSummary(row, view?.columns));

  return {
    records,
    nextCursor: result.nextCursor ? String(offset + limit) : undefined,
    complete: !result.nextCursor,
    ...(view
      ? {
          appliedView: {
            id: view.id,
            name: view.name,
            ...(view.kind ? { kind: view.kind } : {}),
            ...(view.query ? { query: view.query } : {}),
            ...(view.dataProgramId
              ? { dataProgramId: view.dataProgramId }
              : {}),
            fieldEquals: view.fieldEquals,
            columns: view.columns,
            sort: view.sort,
          },
        }
      : {}),
  };
}

export type CrmRecordReadContext = {
  id: string;
  connectionId: string;
  workspaceConnectionId: string | null;
  provider: string;
  objectType: string;
  kind: CrmListKind;
  remoteId: string;
  accessScopeJson: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  fieldPolicies: Array<{
    fieldName: string;
    storagePolicy:
      | "mirrored"
      | "remote-only"
      | "redacted"
      | "derived-local"
      | "local-authoritative";
    readable: boolean;
    sensitive: boolean;
  }>;
};

export async function getCrmRecordReadContext(
  recordId: string,
): Promise<CrmRecordReadContext | null> {
  const db = getDb();
  const [record] = await db
    .select({
      id: schema.crmRecords.id,
      connectionId: schema.crmRecords.connectionId,
      workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
      provider: schema.crmRecords.provider,
      objectType: schema.crmRecords.objectType,
      kind: schema.crmRecords.kind,
      remoteId: schema.crmRecords.remoteId,
      accessScopeJson: schema.crmRecords.accessScopeJson,
      ownerEmail: schema.crmRecords.ownerEmail,
      orgId: schema.crmRecords.orgId,
      visibility: schema.crmRecords.visibility,
    })
    .from(schema.crmRecords)
    .innerJoin(
      schema.crmConnections,
      eq(schema.crmRecords.connectionId, schema.crmConnections.id),
    )
    .where(
      and(
        eq(schema.crmRecords.id, recordId),
        eq(schema.crmRecords.tombstone, false),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        accessFilter(schema.crmConnections, schema.crmConnectionShares),
      ),
    )
    .limit(1);
  if (!record) return null;
  const fieldPolicies = await db
    .select({
      fieldName: schema.crmFieldPolicies.fieldName,
      storagePolicy: schema.crmFieldPolicies.storagePolicy,
      readable: schema.crmFieldPolicies.readable,
      sensitive: schema.crmFieldPolicies.sensitive,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.connectionId, record.connectionId),
        eq(schema.crmFieldPolicies.objectType, record.objectType),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    );
  return {
    ...record,
    kind: record.kind as CrmListKind,
    visibility: record.visibility as "private" | "org" | "public",
    fieldPolicies: fieldPolicies as CrmRecordReadContext["fieldPolicies"],
  };
}

type ReadThroughRelationshipLocalRecord = {
  id: string;
  remoteId: string;
  objectType: string;
  displayName: string;
  kind: string;
  primaryEmail: string | null;
  domain: string | null;
  accessScopeJson: string;
};

type ReadThroughRelationshipData = {
  relationships: CrmRelationship[];
  localRecords: ReadThroughRelationshipLocalRecord[];
  summaries: Array<
    RelatedRecordSummary & { localId: string; remoteId: string }
  >;
};

async function readThroughRelationshipData(input: {
  context: CrmRecordReadContext;
  relationships: CrmRelationship[];
  currentScopes: Map<string, CrmAccessScope>;
}): Promise<ReadThroughRelationshipData> {
  const relationships = input.relationships
    .filter(
      (relationship) =>
        relationship.from.connectionId === input.context.connectionId &&
        relationship.from.objectType === input.context.objectType &&
        relationship.from.remoteId === input.context.remoteId &&
        relationship.to.connectionId === input.context.connectionId,
    )
    .slice(0, 100);
  if (!relationships.length) {
    return { relationships: [], localRecords: [], summaries: [] };
  }

  const db = getDb();
  const remoteIds = Array.from(
    new Set(relationships.map((relationship) => relationship.to.remoteId)),
  );
  const objectTypes = Array.from(
    new Set(relationships.map((relationship) => relationship.to.objectType)),
  );
  const candidates = await db
    .select({
      id: schema.crmRecords.id,
      remoteId: schema.crmRecords.remoteId,
      objectType: schema.crmRecords.objectType,
      displayName: schema.crmRecords.displayName,
      kind: schema.crmRecords.kind,
      primaryEmail: schema.crmRecords.primaryEmail,
      domain: schema.crmRecords.domain,
      accessScopeJson: schema.crmRecords.accessScopeJson,
    })
    .from(schema.crmRecords)
    .where(
      and(
        eq(schema.crmRecords.connectionId, input.context.connectionId),
        eq(schema.crmRecords.tombstone, false),
        inArray(schema.crmRecords.remoteId, remoteIds),
        inArray(schema.crmRecords.objectType, objectTypes),
        accessFilter(schema.crmRecords, schema.crmRecordShares),
      ),
    );
  const localRecords = candidates.filter((record) => {
    const current = input.currentScopes.get(record.objectType);
    return Boolean(
      current &&
      scopesAreCompatible(parseCrmAccessScope(record.accessScopeJson), current),
    );
  });
  const summaries = relatedSummaries(
    input.context.remoteId,
    relationships,
    localRecords,
  );
  return { relationships, localRecords, summaries };
}

export async function getReadThroughRelationshipSummaries(input: {
  context: CrmRecordReadContext;
  relationships: CrmRelationship[];
  currentScopes: Map<string, CrmAccessScope>;
}): Promise<RelatedRecordSummary[]> {
  const { summaries } = await readThroughRelationshipData(input);
  return summaries;
}

export async function persistReadThroughRelationships(input: {
  context: CrmRecordReadContext;
  relationships: CrmRelationship[];
  currentScopes: Map<string, CrmAccessScope>;
}): Promise<RelatedRecordSummary[]> {
  await assertAccess("crm-record", input.context.id, "editor");
  const { relationships, localRecords, summaries } =
    await readThroughRelationshipData(input);
  if (!summaries.length) return [];

  const db = getDb();
  const relationshipByTarget = new Map(
    relationships.map((relationship) => [
      `${relationship.to.objectType}:${relationship.to.remoteId}:${relationship.relationshipType}`,
      relationship,
    ]),
  );
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const summary of summaries) {
      const target = localRecords.find((record) => record.id === summary.id);
      const relationship = target
        ? relationshipByTarget.get(
            `${target.objectType}:${summary.remoteId}:${summary.relationshipType}`,
          )
        : undefined;
      if (!relationship) continue;
      const [existing] = await tx
        .select({ id: schema.crmRelationships.id })
        .from(schema.crmRelationships)
        .where(
          and(
            eq(
              schema.crmRelationships.connectionId,
              input.context.connectionId,
            ),
            eq(schema.crmRelationships.fromRecordId, input.context.id),
            eq(schema.crmRelationships.toRecordId, summary.id),
            eq(
              schema.crmRelationships.relationshipType,
              relationship.relationshipType,
            ),
            accessFilter(schema.crmRelationships, schema.crmRelationshipShares),
          ),
        )
        .limit(1);
      const values = {
        label: relationship.label ?? null,
        inverseLabel: relationship.inverseLabel ?? null,
        sourceField: relationship.sourceField ?? null,
        tombstone: false,
        lastSyncedAt: now,
        updatedAt: now,
      };
      if (existing) {
        await tx
          .update(schema.crmRelationships)
          .set(values)
          .where(
            and(
              eq(schema.crmRelationships.id, existing.id),
              accessFilter(
                schema.crmRelationships,
                schema.crmRelationshipShares,
                undefined,
                "editor",
              ),
            ),
          );
      } else {
        await tx.insert(schema.crmRelationships).values({
          id: crypto.randomUUID(),
          connectionId: input.context.connectionId,
          fromRecordId: input.context.id,
          toRecordId: summary.id,
          relationshipType: relationship.relationshipType,
          ...values,
          ownerEmail: input.context.ownerEmail,
          orgId: input.context.orgId,
          visibility: input.context.visibility,
          createdAt: now,
        });
      }
    }
  });
  return summaries;
}

export async function getCrmRecord(
  recordId: string,
  readThrough?: {
    displayName?: string;
    fields?: Record<string, CrmValue>;
    remoteRevision?: string;
    remoteUpdatedAt?: string;
    relatedRecords?: RelatedRecordSummary[];
    accessScope?: CrmAccessScope;
  },
) {
  const db = getDb();
  const [record] = await db
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
      kind: schema.crmRecords.kind,
      primaryEmail: schema.crmRecords.primaryEmail,
      domain: schema.crmRecords.domain,
      stage: schema.crmRecords.stage,
      ownerName: schema.crmRecords.ownerName,
      desiredCadenceDays: schema.crmRecords.desiredCadenceDays,
      nextContactAt: schema.crmRecords.nextContactAt,
      remoteRevision: schema.crmRecords.remoteRevision,
      remoteUpdatedAt: schema.crmRecords.remoteUpdatedAt,
      updatedAt: schema.crmRecords.updatedAt,
      accessScopeJson: schema.crmRecords.accessScopeJson,
    })
    .from(schema.crmRecords)
    .where(
      and(
        accessFilter(schema.crmRecords, schema.crmRecordShares),
        eq(schema.crmRecords.id, recordId),
        eq(schema.crmRecords.tombstone, false),
      ),
    )
    .limit(1);

  if (!record) return null;

  const [fieldRows, activityRows, evidenceRows, taskRows] = await Promise.all([
    db
      .select({
        fieldName: schema.crmRecordFields.fieldName,
        valueType: schema.crmRecordFields.valueType,
        stringValue: schema.crmRecordFields.stringValue,
        numberValue: schema.crmRecordFields.numberValue,
        booleanValue: schema.crmRecordFields.booleanValue,
        jsonValue: schema.crmRecordFields.jsonValue,
        accessScopeJson: schema.crmRecordFields.accessScopeJson,
      })
      .from(schema.crmRecordFields)
      .where(
        and(
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
          eq(schema.crmRecordFields.recordId, recordId),
        ),
      )
      .orderBy(desc(schema.crmRecordFields.updatedAt))
      .limit(MAX_RECORD_LIMIT),
    db
      .select({
        id: schema.crmInteractions.id,
        title: schema.crmInteractions.title,
        summary: schema.crmInteractions.summary,
        occurredAt: schema.crmInteractions.occurredAt,
        sourceApp: schema.crmInteractions.sourceApp,
      })
      .from(schema.crmInteractions)
      .where(
        and(
          accessFilter(schema.crmInteractions, schema.crmInteractionShares),
          eq(schema.crmInteractions.recordId, recordId),
        ),
      )
      .orderBy(desc(schema.crmInteractions.occurredAt))
      .limit(RECORD_DETAIL_LIMIT),
    db
      .select({
        id: schema.crmCallEvidence.id,
        artifactType: schema.crmCallEvidence.artifactType,
        quote: schema.crmCallEvidence.quote,
        sourceUrl: schema.crmCallEvidence.sourceUrl,
        capturedAt: schema.crmCallEvidence.capturedAt,
        summary: schema.crmCallEvidence.summary,
      })
      .from(schema.crmCallEvidence)
      .where(
        and(
          accessFilter(schema.crmCallEvidence, schema.crmCallEvidenceShares),
          eq(schema.crmCallEvidence.recordId, recordId),
        ),
      )
      .orderBy(desc(schema.crmCallEvidence.capturedAt))
      .limit(RECORD_DETAIL_LIMIT),
    db
      .select({
        id: schema.crmTasks.id,
        title: schema.crmTasks.title,
        status: schema.crmTasks.status,
        dueAt: schema.crmTasks.dueAt,
        recordId: schema.crmTasks.recordId,
      })
      .from(schema.crmTasks)
      .where(
        and(
          accessFilter(schema.crmTasks, schema.crmTaskShares),
          eq(schema.crmTasks.recordId, recordId),
        ),
      )
      .orderBy(desc(schema.crmTasks.updatedAt))
      .limit(RECORD_DETAIL_LIMIT),
  ]);

  return {
    ...toRecordSummary(record),
    ...(readThrough?.displayName
      ? { displayName: readThrough.displayName }
      : {}),
    ...(readThrough?.remoteUpdatedAt
      ? { updatedAt: readThrough.remoteUpdatedAt }
      : {}),
    ...(readThrough?.remoteRevision
      ? { remoteRevision: readThrough.remoteRevision }
      : record.remoteRevision
        ? { remoteRevision: record.remoteRevision }
        : {}),
    cadence: record.desiredCadenceDays
      ? `Every ${record.desiredCadenceDays} days`
      : undefined,
    fields: {
      ...Object.fromEntries(
        fieldRows.flatMap((field) => {
          const scope =
            readThrough?.accessScope ??
            parseCrmAccessScope(record.accessScopeJson);
          if (
            !scope ||
            !scopesAreCompatible(
              parseCrmAccessScope(field.accessScopeJson),
              scope,
            )
          ) {
            return [];
          }
          const value = parseStoredValue(field);
          return value === null ? [] : [[field.fieldName, value]];
        }),
      ),
      ...(readThrough?.fields ?? {}),
    },
    activity: activityRows.map((activity) => ({
      ...activity,
      actor: activity.sourceApp ?? undefined,
    })),
    evidence: evidenceRows.map((evidence) => ({
      id: evidence.id,
      label: evidence.summary || evidence.artifactType,
      quote: evidence.quote || undefined,
      url: evidence.sourceUrl,
      observedAt: evidence.capturedAt,
    })),
    tasks: taskRows,
    relatedRecords: readThrough?.relatedRecords ?? [],
  };
}

export async function listCrmTasks(input: {
  recordId?: string;
  status?: "open" | "done" | "cancelled";
  limit: number;
  cursor?: string;
}) {
  const db = getDb();
  const offset = decodeCursor(input.cursor);
  const limit = Math.min(input.limit, MAX_RECORD_LIMIT);
  const conditions = [accessFilter(schema.crmTasks, schema.crmTaskShares)];
  if (input.recordId)
    conditions.push(eq(schema.crmTasks.recordId, input.recordId));
  if (input.status) conditions.push(eq(schema.crmTasks.status, input.status));

  const rows = await db
    .select({
      id: schema.crmTasks.id,
      title: schema.crmTasks.title,
      status: schema.crmTasks.status,
      dueAt: schema.crmTasks.dueAt,
      recordId: schema.crmTasks.recordId,
      assignedTo: schema.crmTasks.assignedTo,
      authority: schema.crmTasks.authority,
      updatedAt: schema.crmTasks.updatedAt,
    })
    .from(schema.crmTasks)
    .where(and(...conditions))
    .orderBy(desc(schema.crmTasks.dueAt), desc(schema.crmTasks.id))
    .limit(limit + 1)
    .offset(offset);
  const result = page(rows, limit);

  return {
    tasks: result.rows,
    nextCursor: result.nextCursor ? String(offset + limit) : undefined,
    complete: !result.nextCursor,
  };
}

export async function listCrmSavedViews(input: { limit: number }) {
  const rows = await getDb()
    .select({
      id: schema.crmSavedViews.id,
      name: schema.crmSavedViews.name,
      description: schema.crmSavedViews.description,
      kind: schema.crmSavedViews.kind,
      filtersJson: schema.crmSavedViews.filtersJson,
      dataProgramId: schema.crmSavedViews.dataProgramId,
      pinned: schema.crmSavedViews.pinned,
      updatedAt: schema.crmSavedViews.updatedAt,
    })
    .from(schema.crmSavedViews)
    .where(accessFilter(schema.crmSavedViews, schema.crmSavedViewShares))
    .orderBy(
      desc(schema.crmSavedViews.pinned),
      desc(schema.crmSavedViews.updatedAt),
    )
    .limit(Math.min(input.limit, MAX_RECORD_LIMIT));

  return {
    views: rows.map((view) => ({
      id: view.id,
      name: view.name,
      description: view.description || undefined,
      kind: view.kind ?? undefined,
      query: view.filtersJson === "{}" ? undefined : view.filtersJson,
      dataProgramId: view.dataProgramId ?? undefined,
      pinned: view.pinned,
      updatedAt: view.updatedAt,
    })),
  };
}

export function safeProposalValues(value: string): Record<string, Primitive> {
  const parsed = parseJsonObject(value);
  const fields = parsed?.fields;
  const source =
    fields && typeof fields === "object" && !Array.isArray(fields)
      ? (fields as Record<string, unknown>)
      : (parsed ?? {});
  return Object.fromEntries(
    Object.entries(source)
      .filter(
        ([fieldName, fieldValue]) =>
          fieldName.length <= 120 &&
          isSafeCrmMutationFieldName(fieldName) &&
          isBoundedCrmValue(fieldValue) &&
          parsePrimitive(fieldValue),
      )
      .slice(0, 20),
  ) as Record<string, Primitive>;
}

export async function listCrmProposals(input: {
  recordId?: string;
  status?:
    | "pending"
    | "approved"
    | "applied"
    | "rejected"
    | "conflict"
    | "failed";
  limit: number;
  cursor?: string;
}) {
  const db = getDb();
  const offset = decodeCursor(input.cursor);
  const limit = Math.min(input.limit, MAX_RECORD_LIMIT);
  const conditions = [
    accessFilter(schema.crmMutations, schema.crmMutationShares),
  ];
  if (input.recordId) {
    conditions.push(eq(schema.crmMutations.recordId, input.recordId));
  }
  if (input.status)
    conditions.push(eq(schema.crmMutations.status, input.status));

  const rows = await db
    .select({
      id: schema.crmMutations.id,
      recordId: schema.crmMutations.recordId,
      operation: schema.crmMutations.operation,
      initiatedBy: schema.crmMutations.initiatedBy,
      target: schema.crmMutations.target,
      policyDecision: schema.crmMutations.policyDecision,
      risk: schema.crmMutations.risk,
      status: schema.crmMutations.status,
      expectedRemoteRevision: schema.crmMutations.expectedRemoteRevision,
      patchJson: schema.crmMutations.patchJson,
      beforeJson: schema.crmMutations.beforeJson,
      afterJson: schema.crmMutations.afterJson,
      createdAt: schema.crmMutations.createdAt,
      appliedAt: schema.crmMutations.appliedAt,
    })
    .from(schema.crmMutations)
    .where(and(...conditions))
    .orderBy(desc(schema.crmMutations.createdAt), desc(schema.crmMutations.id))
    .limit(limit + 1)
    .offset(offset);
  const result = page(rows, limit);
  const recordIds = result.rows
    .map((row) => row.recordId)
    .filter((recordId): recordId is string => Boolean(recordId));
  const records = recordIds.length
    ? await db
        .select({
          id: schema.crmRecords.id,
          displayName: schema.crmRecords.displayName,
        })
        .from(schema.crmRecords)
        .where(
          and(
            inArray(schema.crmRecords.id, recordIds),
            accessFilter(schema.crmRecords, schema.crmRecordShares),
          ),
        )
    : [];
  const displayNameByRecordId = new Map(
    records.map((record) => [record.id, record.displayName]),
  );

  return {
    proposals: result.rows.map((proposal) => {
      const patch = safeProposalValues(proposal.patchJson);
      const before = safeProposalValues(proposal.beforeJson);
      const after = safeProposalValues(proposal.afterJson);
      const fieldNames = Array.from(
        new Set([
          ...Object.keys(before),
          ...Object.keys(after),
          ...Object.keys(patch),
        ]),
      ).slice(0, 20);
      return {
        id: proposal.id,
        recordId: proposal.recordId,
        ...(proposal.recordId && displayNameByRecordId.get(proposal.recordId)
          ? { recordName: displayNameByRecordId.get(proposal.recordId) }
          : {}),
        operation: proposal.operation,
        initiatedBy: proposal.initiatedBy,
        target: proposal.target,
        policyDecision: proposal.policyDecision,
        risk: proposal.risk,
        status: proposal.status,
        expectedRemoteRevision: proposal.expectedRemoteRevision,
        createdAt: proposal.createdAt,
        appliedAt: proposal.appliedAt,
        fields: fieldNames.map((name) => ({
          name,
          ...(Object.prototype.hasOwnProperty.call(before, name)
            ? { before: before[name] }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(
            Object.keys(after).length ? after : patch,
            name,
          )
            ? { after: (Object.keys(after).length ? after : patch)[name] }
            : {}),
        })),
      };
    }),
    nextCursor: result.nextCursor ? String(offset + limit) : undefined,
    complete: !result.nextCursor,
  };
}

export async function getCrmOverview() {
  const [taskResult, recordResult, proposalResult] = await Promise.all([
    listCrmTasks({ status: "open", limit: 8 }),
    listCrmRecords({ limit: 5 }),
    listCrmProposals({ status: "pending", limit: 1 }),
  ]);

  return {
    tasks: taskResult.tasks,
    records: recordResult.records,
    focus: [
      {
        label: "Open follow-up",
        value: String(taskResult.tasks.length),
        detail: taskResult.complete
          ? "Tasks currently due for attention."
          : "Showing the first 8 tasks due for attention.",
      },
      ...(proposalResult.proposals.length
        ? [
            {
              label: "Pending proposal",
              value: "1+",
              detail: "A CRM write is waiting for review.",
            },
          ]
        : []),
    ],
  };
}
