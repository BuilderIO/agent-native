import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";

import { getDb, schema } from "./index.js";

const MAX_RECORD_LIMIT = 100;
const RECORD_DETAIL_LIMIT = 20;

export type CrmListKind =
  | "account"
  | "person"
  | "opportunity"
  | "activity"
  | "task"
  | "custom";

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

function toRecordSummary(row: {
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
}) {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    subtitle: row.domain ?? row.primaryEmail ?? undefined,
    owner: row.ownerName ?? undefined,
    stage: row.stage ?? undefined,
    nextStep: row.nextContactAt ?? undefined,
    updatedAt: row.remoteUpdatedAt ?? row.updatedAt,
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

export async function listCrmRecords(input: {
  kind?: CrmListKind;
  connectionId?: string;
  query?: string;
  limit: number;
  cursor?: string;
}) {
  const db = getDb();
  const offset = decodeCursor(input.cursor);
  const limit = Math.min(input.limit, MAX_RECORD_LIMIT);
  const conditions = [
    accessFilter(schema.crmRecords, schema.crmRecordShares),
    eq(schema.crmRecords.tombstone, false),
  ];

  if (input.kind) conditions.push(eq(schema.crmRecords.kind, input.kind));
  if (input.connectionId) {
    conditions.push(eq(schema.crmRecords.connectionId, input.connectionId));
  }
  if (input.query) {
    conditions.push(like(schema.crmRecords.displayName, `%${input.query}%`));
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
    })
    .from(schema.crmRecords)
    .where(and(...conditions))
    .orderBy(
      desc(schema.crmRecords.remoteUpdatedAt),
      desc(schema.crmRecords.id),
    )
    .limit(limit + 1)
    .offset(offset);
  const result = page(rows, limit);

  return {
    records: result.rows.map(toRecordSummary),
    nextCursor: result.nextCursor ? String(offset + limit) : undefined,
    complete: !result.nextCursor,
  };
}

export async function getCrmRecord(recordId: string) {
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
      remoteUpdatedAt: schema.crmRecords.remoteUpdatedAt,
      updatedAt: schema.crmRecords.updatedAt,
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
    cadence: record.desiredCadenceDays
      ? `Every ${record.desiredCadenceDays} days`
      : undefined,
    fields: Object.fromEntries(
      fieldRows.flatMap((field) => {
        const value = parseStoredValue(field);
        return value === null ? [] : [[field.fieldName, value]];
      }),
    ),
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
      error: schema.crmMutations.error,
      createdAt: schema.crmMutations.createdAt,
      appliedAt: schema.crmMutations.appliedAt,
    })
    .from(schema.crmMutations)
    .where(and(...conditions))
    .orderBy(desc(schema.crmMutations.createdAt), desc(schema.crmMutations.id))
    .limit(limit + 1)
    .offset(offset);
  const result = page(rows, limit);

  return {
    proposals: result.rows,
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
