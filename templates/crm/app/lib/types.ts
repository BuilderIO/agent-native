export type CrmKind = "account" | "person" | "opportunity";

export interface CrmRecordSummary {
  id: string;
  displayName: string;
  kind: CrmKind;
  subtitle?: string;
  owner?: string;
  stage?: string;
  cadence?: string;
  nextStep?: string;
  updatedAt?: string;
  fields?: Record<string, unknown>;
}

export interface CrmRecordDetail extends CrmRecordSummary {
  description?: string;
  activity?: Array<{
    id: string;
    title: string;
    summary?: string;
    occurredAt?: string;
    actor?: string;
  }>;
  evidence?: Array<{
    id: string;
    label: string;
    quote?: string;
    url?: string;
    observedAt?: string;
  }>;
  tasks?: Array<CrmTask>;
}

export interface CrmTask {
  id: string;
  title: string;
  status: "open" | "done" | "blocked" | string;
  dueAt?: string;
  recordId?: string;
}

export interface CrmSavedView {
  id: string;
  name: string;
  kind?: CrmKind;
  query?: string;
}

export interface CrmOverview {
  focus?: Array<{ label: string; value: string; detail?: string }>;
  tasks?: CrmTask[];
  records?: CrmRecordSummary[];
}

export function recordId(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const value = record as Record<string, unknown>;
  const ref = value.ref as Record<string, unknown> | undefined;
  return asText(value.id) ?? asText(value.recordId) ?? asText(ref?.localId) ?? asText(ref?.remoteId);
}

export function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

export function normalizeRecord(record: unknown, fallbackKind: CrmKind): CrmRecordSummary | null {
  if (!record || typeof record !== "object") return null;
  const value = record as Record<string, unknown>;
  const id = recordId(value);
  if (!id) return null;
  const fields = isObject(value.fields) ? value.fields : undefined;
  const ref = isObject(value.ref) ? value.ref : undefined;
  const kind = asKind(value.kind) ?? asKind(ref?.kind) ?? fallbackKind;
  return {
    id,
    displayName: asText(value.displayName) ?? asText(value.name) ?? id,
    kind,
    subtitle: asText(value.subtitle) ?? asText(fields?.domain) ?? asText(fields?.email),
    owner: asText(value.owner) ?? asText(fields?.owner),
    stage: asText(value.stage) ?? asText(fields?.stage),
    cadence: asText(value.cadence) ?? asText(fields?.cadence),
    nextStep: asText(value.nextStep) ?? asText(fields?.nextStep),
    updatedAt: asText(value.updatedAt) ?? asText(value.remoteUpdatedAt),
    fields,
  };
}

export function normalizeRecords(data: unknown, kind: CrmKind): CrmRecordSummary[] {
  const values = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.records)
      ? data.records
      : [];
  return values.flatMap((value) => {
    const record = normalizeRecord(value, kind);
    return record ? [record] : [];
  });
}

export function normalizeTasks(data: unknown): CrmTask[] {
  const values = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.tasks)
      ? data.tasks
      : [];
  return values.flatMap((value) => {
    if (!isObject(value)) return [];
    const id = asText(value.id) ?? asText(value.taskId);
    const title = asText(value.title) ?? asText(value.name);
    if (!id || !title) return [];
    return [{ id, title, status: asText(value.status) ?? "open", dueAt: asText(value.dueAt), recordId: asText(value.recordId) }];
  });
}

function asKind(value: unknown): CrmKind | undefined {
  return value === "account" || value === "person" || value === "opportunity" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
