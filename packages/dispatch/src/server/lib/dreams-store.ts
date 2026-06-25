import crypto from "node:crypto";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from "@agent-native/core/db/schema";
import {
  resourceGetByPath,
  resourceList,
  resourcePut,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

import { getDb, schema } from "../../db/index.js";
import {
  createApprovalRequest,
  currentOrgId,
  currentOwnerEmail,
  getApprovalPolicy,
  recordAudit,
  type DispatchCtx,
} from "./dispatch-store.js";
import {
  getAgentThreadDebug,
  listThreadDebugSources,
  searchAgentThreads,
} from "./thread-debug-store.js";
import {
  createWorkspaceResource,
  listWorkspaceResources,
  updateWorkspaceResource,
  type WorkspaceResourceKind,
  type WorkspaceResourceScope,
} from "./workspace-resources-store.js";

const DEFAULT_DREAM_LIMIT = 20;
const MAX_DREAM_LIMIT = 50;
const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;
const MAX_SOURCE_TIMEOUT_MS = 60_000;
const DEFAULT_SOURCE_CONCURRENCY = 2;
const MAX_SOURCE_CONCURRENCY = 8;
const DEFAULT_SOURCE_START_STAGGER_MS = 250;
const MAX_SOURCE_START_STAGGER_MS = 5_000;
const DEFAULT_THREAD_CONCURRENCY = 3;
const MAX_THREAD_CONCURRENCY = 10;
const DEFAULT_THREAD_TIMEOUT_MS = 8_000;
const MAX_THREAD_TIMEOUT_MS = 30_000;
const MEMORY_INDEX_PATH = "memory/MEMORY.md";
const DREAM_JOB_PATH = "jobs/dispatch-dream.md";
const DEFAULT_DREAM_CRON = "0 9 * * 1";
const DREAM_SETTINGS_KEY = "dispatch-dream-settings";

type DreamRow = typeof schema.dispatchDreams.$inferSelect;
type DreamProposalRow = typeof schema.dispatchDreamProposals.$inferSelect;

type DreamStatus = "running" | "completed" | "failed";
type ProposalStatus = "pending" | "approval_requested" | "applied" | "rejected";
type ProposalTargetType =
  | "personal-memory"
  | "shared-learnings"
  | "workspace-instruction"
  | "workspace-skill"
  | "workspace-knowledge"
  | "workspace-agent";
type ProposalRisk = "low" | "medium" | "high";
type DreamSourceStatus = "ok" | "timed_out" | "error";

export interface DreamSourceHealth {
  sourceId: string;
  label?: string | null;
  status: DreamSourceStatus;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  timeoutMs: number;
  inspectedThreadCount: number;
  candidateCount: number;
  errorCount: number;
  threadErrorCount: number;
  message?: string | null;
}

interface DreamCandidateReason {
  code: string;
  label: string;
  score: number;
  evidenceCount: number;
}

export interface DreamEvidence {
  kind: string;
  label: string;
  snippet: string;
  threadId: string;
  threadTitle?: string;
  sourceId?: string | null;
  runId?: string | null;
  messageIndex?: number;
  createdAt?: number | null;
}

export interface DreamCandidate {
  thread: {
    id: string;
    ownerEmail: string;
    title: string;
    preview: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
  };
  sourceId: string;
  score: number;
  reasons: DreamCandidateReason[];
  evidenceCounts: Record<string, number>;
  evidence: DreamEvidence[];
  latestRunStatus: string | null;
}

export interface DreamProposalInput {
  targetType: ProposalTargetType;
  targetPath: string;
  title: string;
  summary: string;
  rationale: string;
  content: string;
  evidence: DreamEvidence[];
  confidence: number;
  risk: ProposalRisk;
}

export interface DreamMemoryNote {
  path: string;
  content: string;
}

export interface DreamMemoryContext {
  personalIndex: string;
  personalNotes: DreamMemoryNote[];
  sharedLearnings: string;
  workspaceResources?: DreamMemoryNote[];
}

export interface DreamProposalBuildResult {
  proposals: DreamProposalInput[];
  guardrailNotes: string[];
}

export interface DreamProposalBuildOptions {
  personalMemoryAllowed?: boolean;
  personalMemoryBlockReason?: string | null;
}

export interface DreamSettings {
  scope: "user" | "org";
  scopeId: string;
  enabled: boolean;
  schedule: string;
  sourceId: string;
  sourceIds: string[];
  allSources: boolean;
  query: string | null;
  limit: number;
  sourceTimeoutMs: number;
  sourceConcurrency: number;
  sourceStartStaggerMs: number;
  threadConcurrency: number;
  threadTimeoutMs: number;
  minCandidateCount: number;
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(MAX_DREAM_LIMIT, limit ?? DEFAULT_DREAM_LIMIT));
}

function clampSourceTimeoutMs(timeoutMs: number | undefined) {
  const parsed = Number(timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_SOURCE_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_SOURCE_TIMEOUT_MS, Math.floor(parsed)));
}

function clampSourceConcurrency(value: number | undefined) {
  const parsed = Number(value ?? DEFAULT_SOURCE_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_SOURCE_CONCURRENCY;
  return Math.max(1, Math.min(MAX_SOURCE_CONCURRENCY, Math.floor(parsed)));
}

function clampSourceStartStaggerMs(value: number | undefined) {
  const parsed = Number(value ?? DEFAULT_SOURCE_START_STAGGER_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_SOURCE_START_STAGGER_MS;
  return Math.max(0, Math.min(MAX_SOURCE_START_STAGGER_MS, Math.floor(parsed)));
}

function clampThreadConcurrency(value: number | undefined) {
  const parsed = Number(value ?? DEFAULT_THREAD_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_THREAD_CONCURRENCY;
  return Math.max(1, Math.min(MAX_THREAD_CONCURRENCY, Math.floor(parsed)));
}

function clampThreadTimeoutMs(
  value: number | undefined,
  sourceTimeoutMs: number,
) {
  const fallback = Math.min(
    DEFAULT_THREAD_TIMEOUT_MS,
    Math.max(1_000, Math.floor(sourceTimeoutMs * 0.6)),
  );
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(
    1,
    Math.min(MAX_THREAD_TIMEOUT_MS, sourceTimeoutMs, Math.floor(parsed)),
  );
}

function clampMinCandidateCount(value: number | undefined) {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(50, Math.floor(parsed)));
}

function dreamSettingsScope() {
  const orgId = currentOrgId();
  if (orgId) return { scope: "org" as const, scopeId: orgId };
  return { scope: "user" as const, scopeId: currentOwnerEmail() };
}

function normalizeSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, 50),
    ),
  );
}

function normalizeDreamSettings(
  raw: Record<string, unknown> | null | undefined,
): Omit<DreamSettings, "scope" | "scopeId"> {
  const sourceIds = normalizeSourceIds(raw?.sourceIds);
  const sourceId = String(raw?.sourceId ?? "").trim() || "all";
  return {
    enabled: raw?.enabled === true,
    schedule:
      typeof raw?.schedule === "string" && cronLooksValid(raw.schedule)
        ? raw.schedule
        : DEFAULT_DREAM_CRON,
    sourceId,
    sourceIds,
    allSources:
      raw?.allSources === true || sourceId === "all" || sourceIds.length > 0,
    query:
      typeof raw?.query === "string" && raw.query.trim()
        ? raw.query.trim()
        : null,
    limit: clampLimit(Number(raw?.limit ?? 8)),
    sourceTimeoutMs: clampSourceTimeoutMs(
      Number(raw?.sourceTimeoutMs ?? 30_000),
    ),
    sourceConcurrency: clampSourceConcurrency(
      Number(raw?.sourceConcurrency ?? DEFAULT_SOURCE_CONCURRENCY),
    ),
    sourceStartStaggerMs: clampSourceStartStaggerMs(
      Number(raw?.sourceStartStaggerMs ?? DEFAULT_SOURCE_START_STAGGER_MS),
    ),
    threadConcurrency: clampThreadConcurrency(
      Number(raw?.threadConcurrency ?? DEFAULT_THREAD_CONCURRENCY),
    ),
    threadTimeoutMs: clampThreadTimeoutMs(
      Number(raw?.threadTimeoutMs ?? DEFAULT_THREAD_TIMEOUT_MS),
      clampSourceTimeoutMs(Number(raw?.sourceTimeoutMs ?? 30_000)),
    ),
    minCandidateCount: clampMinCandidateCount(
      Number(raw?.minCandidateCount ?? 1),
    ),
  };
}

export async function getDreamSettings(): Promise<DreamSettings> {
  const scope = dreamSettingsScope();
  const raw =
    scope.scope === "org"
      ? await getOrgSetting(scope.scopeId, DREAM_SETTINGS_KEY)
      : await getUserSetting(scope.scopeId, DREAM_SETTINGS_KEY);
  return {
    ...scope,
    ...normalizeDreamSettings(raw as Record<string, unknown> | null),
  };
}

export async function setDreamSettings(
  input: Partial<
    Pick<
      DreamSettings,
      | "enabled"
      | "schedule"
      | "sourceId"
      | "sourceIds"
      | "allSources"
      | "query"
      | "limit"
      | "sourceTimeoutMs"
      | "sourceConcurrency"
      | "sourceStartStaggerMs"
      | "threadConcurrency"
      | "threadTimeoutMs"
      | "minCandidateCount"
    >
  >,
): Promise<DreamSettings> {
  if (input.schedule && !cronLooksValid(input.schedule)) {
    throw new Error(
      'Invalid cron expression. Use a standard five-field cron like "0 9 * * 1".',
    );
  }
  const current = await getDreamSettings();
  const next = normalizeDreamSettings({
    ...current,
    ...input,
    sourceIds:
      input.sourceIds !== undefined
        ? normalizeSourceIds(input.sourceIds)
        : current.sourceIds,
    query:
      input.query === undefined
        ? current.query
        : input.query?.trim()
          ? input.query.trim()
          : null,
  });
  const scope = dreamSettingsScope();
  if (scope.scope === "org") {
    await putOrgSetting(scope.scopeId, DREAM_SETTINGS_KEY, next);
  } else {
    await putUserSetting(scope.scopeId, DREAM_SETTINGS_KEY, next);
  }
  await recordAudit({
    action: "dream.settings.updated",
    targetType: "dream-settings",
    targetId: DREAM_SETTINGS_KEY,
    summary: next.enabled
      ? "Updated and enabled recurring Dispatch dream settings"
      : "Updated recurring Dispatch dream settings",
    metadata: next,
  });
  return getDreamSettings();
}

class DreamSourceTimeoutError extends Error {
  readonly code = "DREAM_SOURCE_TIMEOUT";

  constructor(sourceId: string, timeoutMs: number) {
    super(`Dream source "${sourceId}" timed out after ${timeoutMs}ms.`);
    this.name = "DreamSourceTimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  sourceId: string,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new DreamSourceTimeoutError(sourceId, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isDreamSourceTimeout(error: unknown): boolean {
  return (
    error instanceof DreamSourceTimeoutError ||
    (error as any)?.code === "DREAM_SOURCE_TIMEOUT"
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactErrorMessage(error: unknown): string {
  return compactText((error as Error)?.message ?? error, 320);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    }),
  );
  return results;
}

function scopeFor<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: DispatchCtx,
) {
  if (!ctx.orgId) {
    return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
  }
  return or(eq(table.ownerEmail, ctx.ownerEmail), eq(table.orgId, ctx.orgId));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function compactText(value: unknown, max = 260): string {
  const raw =
    typeof value === "string" ? value : value == null ? "" : safeJson(value);
  const redacted = raw
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-REDACTED")
    .replace(/anthropic-[A-Za-z0-9_-]{12,}/gi, "anthropic-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer REDACTED")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "REDACTED_TOKEN")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max - 1).trimEnd()}…`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "dispatch-dream";
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectText(value: unknown): string {
  return compactText(value, 1_200).toLowerCase();
}

function isFailureStatus(status: unknown): boolean {
  const value = String(status ?? "").toLowerCase();
  return (
    value.includes("fail") ||
    value.includes("error") ||
    value.includes("abort") ||
    value.includes("cancel") ||
    value.includes("timeout")
  );
}

function isSuccessStatus(status: unknown): boolean {
  const value = String(status ?? "").toLowerCase();
  return (
    value === "success" ||
    value === "succeeded" ||
    value === "completed" ||
    value === "complete"
  );
}

function isNegativeFeedback(row: Record<string, unknown>): boolean {
  const text = objectText(row);
  const rating =
    parseNumber((row as any).rating) ??
    parseNumber((row as any).score) ??
    parseNumber((row as any).value);
  return (
    text.includes("thumbs_down") ||
    text.includes("negative") ||
    text.includes("bad") ||
    text.includes("incorrect") ||
    text.includes("not helpful") ||
    (rating != null && rating <= 2)
  );
}

function lowerString(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function sameOwnerEmail(a: unknown, b: unknown): boolean {
  const left = String(a ?? "")
    .trim()
    .toLowerCase();
  const right = String(b ?? "")
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}

function isEvalFailure(row: Record<string, unknown>): boolean {
  const passed = (row as any).passed;
  const score = parseNumber((row as any).score);
  const status = lowerString((row as any).status);
  const result = lowerString((row as any).result ?? (row as any).outcome);
  return (
    passed === false ||
    status === "failed" ||
    status === "failure" ||
    status === "regression" ||
    result === "failed" ||
    result === "failure" ||
    result === "regression" ||
    (score != null && score < 0.7)
  );
}

function isLowSatisfaction(row: Record<string, unknown>): boolean {
  const text = objectText(row);
  const score =
    parseNumber((row as any).score) ??
    parseNumber((row as any).satisfaction) ??
    parseNumber((row as any).value);
  return (
    text.includes("frustrat") ||
    text.includes("unsatisfied") ||
    text.includes("low") ||
    (score != null && score < 0.65)
  );
}

function reason(
  code: string,
  label: string,
  score: number,
  evidenceCount: number,
): DreamCandidateReason {
  return { code, label, score, evidenceCount };
}

type DreamEvidenceInput = Omit<DreamEvidence, "snippet"> & {
  snippet: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = parseNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = safeJsonParse<Record<string, unknown> | null>(value, null);
  return isRecord(parsed) ? parsed : {};
}

function maybeJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;
  const parsed = safeJsonParse<Record<string, unknown> | null>(value, null);
  return isRecord(parsed) ? parsed : null;
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatMetadataComparison(
  metadata: Record<string, unknown>,
): string | null {
  for (const [key, rawActual] of Object.entries(metadata)) {
    if (!/^actual/i.test(key)) continue;
    const expectedKey = key.replace(/^actual/i, "expected");
    const actual = parseNumber(rawActual);
    const expected = parseNumber(metadata[expectedKey]);
    if (actual == null || expected == null) continue;
    const rawMetric = key.replace(/^actual/i, "");
    const normalizedMetric = rawMetric
      .replace(/[^a-z0-9]+/gi, "")
      .toLowerCase();
    const metric =
      normalizedMetric === "ms"
        ? "latency"
        : normalizedMetric.includes("cx")
          ? "cost"
          : humanizeKey(rawMetric) || "value";
    const unit = /ms$/i.test(key) ? "ms" : "";
    return `${metric}: actual ${formatNumber(actual)}${unit}, expected ${formatNumber(expected)}${unit}`;
  }

  const actualMs = firstNumber(metadata, [
    "actualMs",
    "actual_ms",
    "durationMs",
    "duration_ms",
  ]);
  const expectedMs = firstNumber(metadata, [
    "expectedMs",
    "expected_ms",
    "maxMs",
    "max_ms",
    "thresholdMs",
    "threshold_ms",
  ]);
  if (actualMs != null && expectedMs != null) {
    return `latency: actual ${formatNumber(actualMs)}ms, expected ${formatNumber(expectedMs)}ms`;
  }

  return null;
}

function formatEvalFailureEvidence(value: unknown): string {
  const record = maybeJsonRecord(value);
  if (!record) return compactText(value);
  const metadata = metadataRecord(record.metadata ?? record.details);
  const name =
    firstString(record, [
      "name",
      "criteria",
      "criterion",
      "evalName",
      "eval_id",
      "metric",
      "type",
    ]) ?? "evaluation";
  const score = firstNumber(record, ["score", "value"]);
  const status =
    firstString(record, ["status", "result", "outcome"]) ??
    (record.passed === false ? "failed" : null);
  const message = firstString(record, [
    "message",
    "error",
    "reason",
    "summary",
    "notes",
  ]);
  const comparison = formatMetadataComparison(metadata);
  const pieces = [`${humanizeKey(name)}${status ? ` ${status}` : " failed"}`];
  if (score != null) pieces.push(`score ${formatNumber(score)}`);
  if (comparison) pieces.push(comparison);
  if (message) pieces.push(compactText(message, 120));
  return compactText(pieces.join("; "), 240);
}

function formatToolErrorEvidence(value: unknown): string {
  const record = maybeJsonRecord(value);
  if (!record) return compactText(value);
  const event = isRecord(record.event) ? record.event : record;
  const parsedResult = safeJsonParse<Record<string, unknown> | null>(
    event.result,
    null,
  );
  const source = isRecord(parsedResult) ? parsedResult : event;
  const code = firstString(source, ["errorCode", "code", "status"]);
  const message =
    firstString(source, ["error", "message", "reason", "result"]) ??
    firstString(event, ["error", "message", "reason", "result"]);
  if (message && /^tool error\b/i.test(message.trim())) {
    return compactText(message, 240);
  }
  const prefix = code ? `Tool error (${code})` : "Tool error";
  return compactText(`${prefix}: ${message ?? compactText(value, 180)}`, 240);
}

function formatFeedbackEvidence(kind: string, value: unknown): string {
  const record = maybeJsonRecord(value);
  if (!record) return compactText(value);
  const rating = firstNumber(record, ["rating", "score", "satisfaction"]);
  const message =
    firstString(record, [
      "feedback",
      "comment",
      "message",
      "reason",
      "text",
      "body",
    ]) ?? firstString(record, ["status", "result", "outcome"]);
  const prefix =
    kind === "low-satisfaction"
      ? "Low satisfaction signal"
      : "Negative feedback";
  const ratingText = rating != null ? ` (score ${formatNumber(rating)})` : "";
  return compactText(
    `${prefix}${ratingText}: ${message ?? compactText(value, 180)}`,
    240,
  );
}

function formatSuccessEvidence(value: unknown): string {
  const record = maybeJsonRecord(value);
  if (!record) return compactText(value);
  const label =
    firstString(record, ["title", "name", "summary", "description", "path"]) ??
    firstString(record, ["run_id", "id"]);
  return compactText(`Successful checkpoint${label ? `: ${label}` : ""}`, 220);
}

function formatEvidenceSnippet(kind: string, value: unknown): string {
  if (kind === "eval-failure") return formatEvalFailureEvidence(value);
  if (kind === "tool-error") return formatToolErrorEvidence(value);
  if (kind === "negative-feedback" || kind === "low-satisfaction") {
    return formatFeedbackEvidence(kind, value);
  }
  if (kind === "verified-success") return formatSuccessEvidence(value);
  return compactText(value);
}

function normalizeEvidenceQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, " id ")
    .replace(
      /\b(?:run|thread|message|event)[_-]?id[:=]?\s*[a-z0-9._:-]+/gi,
      " id ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceDedupeKey(entry: DreamEvidence): string {
  return [
    entry.threadId,
    entry.kind,
    normalizeEvidenceQuote(entry.snippet),
  ].join("\u0000");
}

function normalizeEvidence(input: DreamEvidenceInput): DreamEvidence | null {
  const snippet = formatEvidenceSnippet(input.kind, input.snippet);
  if (!snippet.trim()) return null;
  return { ...input, snippet };
}

function addEvidence(
  bucket: DreamEvidence[],
  input: DreamEvidenceInput,
  max = 12,
) {
  const normalized = normalizeEvidence(input);
  if (!normalized) return;
  const key = evidenceDedupeKey(normalized);
  if (bucket.some((entry) => evidenceDedupeKey(entry) === key)) return;
  if (bucket.length >= max) return;
  bucket.push(normalized);
}

function stripInjectedUserContext(text: string): string {
  const marker = text.search(/(?:^|\n)\s*<context>/i);
  return (marker >= 0 ? text.slice(0, marker) : text).trim();
}

function isCorrectionSignal(lower: string): boolean {
  return (
    /\b(actually|wrong|not what i meant|you should)\b/.test(lower) ||
    /\b(don't|do not|never)\b/.test(lower) ||
    /\b(no|instead)\b[,.!?:;-]/.test(lower) ||
    /\bfrom now on\b/.test(lower)
  );
}

function isToolErrorEvent(value: unknown): boolean {
  const event = (value as any)?.event ?? value;
  const type = lowerString(event?.type);
  const status = lowerString(event?.status);
  if (
    type.includes("error") ||
    type.includes("exception") ||
    type.includes("failed") ||
    status === "error" ||
    status === "failed"
  ) {
    return true;
  }

  const result =
    typeof event?.result === "string"
      ? event.result.trim().toLowerCase()
      : typeof event?.error === "string"
        ? event.error.trim().toLowerCase()
        : "";
  if (!result) return false;
  if (
    result.startsWith("error:") ||
    result.startsWith("failed:") ||
    result.includes("exception") ||
    result.includes("timed out")
  ) {
    return true;
  }

  const parsed = safeJsonParse<Record<string, unknown> | null>(
    event?.result,
    null,
  );
  const parsedStatus = lowerString(parsed?.status ?? parsed?.state);
  return parsedStatus === "failed" || parsedStatus === "error";
}

function analyzeThreadDebug(debug: any, sourceId: string): DreamCandidate {
  const evidence: DreamEvidence[] = [];
  const reasons: DreamCandidateReason[] = [];
  const counts: Record<string, number> = {
    explicitCorrections: 0,
    rememberRequests: 0,
    failedRuns: 0,
    toolErrors: 0,
    negativeFeedback: 0,
    evalFailures: 0,
    lowSatisfaction: 0,
    frustration: 0,
    verifiedSuccess: 0,
  };

  const thread = debug.thread;
  const threadTitle = thread.title || thread.preview || thread.id;
  const messages = Array.isArray(debug.messages) ? debug.messages : [];

  for (const message of messages) {
    const text = stripInjectedUserContext(String(message?.text ?? ""));
    if (message?.role !== "user" || !text.trim()) continue;
    const lower = text.toLowerCase();
    const isRemember =
      /\b(remember|for future|next time|from now on|always)\b/.test(lower);
    const isCorrection = isCorrectionSignal(lower);
    const isFrustration =
      /\b(frustrat|again|still|why did|keeps? doing|same mistake)\b/.test(
        lower,
      );
    if (isRemember) {
      counts.rememberRequests += 1;
      addEvidence(evidence, {
        kind: "remember-request",
        label: "User asked the agent to remember something",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
    if (isCorrection) {
      counts.explicitCorrections += 1;
      addEvidence(evidence, {
        kind: "explicit-correction",
        label: "User corrected the agent",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
    if (isFrustration) {
      counts.frustration += 1;
      addEvidence(evidence, {
        kind: "frustration",
        label: "User expressed friction or repeated failure",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
  }

  const runs = Array.isArray(debug.runs) ? debug.runs : [];
  for (const run of runs) {
    if (isFailureStatus(run?.status) || run?.abortReason) {
      counts.failedRuns += 1;
      addEvidence(evidence, {
        kind: "failed-run",
        label: "Run failed or aborted",
        snippet: `${run?.status ?? "unknown"}${run?.abortReason ? `: ${run.abortReason}` : ""}`,
        threadId: thread.id,
        threadTitle,
        runId: run?.id ?? null,
        createdAt: parseNumber(run?.completedAt ?? run?.startedAt),
      });
    }
    const events = Array.isArray(run?.events) ? run.events : [];
    for (const event of events) {
      if (!isToolErrorEvent(event)) continue;
      counts.toolErrors += 1;
      addEvidence(evidence, {
        kind: "tool-error",
        label: "Tool call reported an error",
        snippet: event,
        threadId: thread.id,
        threadTitle,
        runId: run?.id ?? null,
      });
    }
  }

  const feedback = Array.isArray(debug.feedback) ? debug.feedback : [];
  for (const row of feedback) {
    if (!isNegativeFeedback(row)) continue;
    counts.negativeFeedback += 1;
    addEvidence(evidence, {
      kind: "negative-feedback",
      label: "Negative feedback was recorded",
      snippet: row,
      threadId: thread.id,
      threadTitle,
    });
  }

  const evals = Array.isArray(debug.evals) ? debug.evals : [];
  for (const row of evals) {
    if (!isEvalFailure(row)) continue;
    counts.evalFailures += 1;
    addEvidence(evidence, {
      kind: "eval-failure",
      label: "Evaluation failed or scored low",
      snippet: row,
      threadId: thread.id,
      threadTitle,
      runId: typeof row?.run_id === "string" ? row.run_id : null,
    });
  }

  const satisfaction = Array.isArray(debug.satisfaction)
    ? debug.satisfaction
    : [];
  for (const row of satisfaction) {
    if (!isLowSatisfaction(row)) continue;
    counts.lowSatisfaction += 1;
    addEvidence(evidence, {
      kind: "low-satisfaction",
      label: "Satisfaction signal was low",
      snippet: row,
      threadId: thread.id,
      threadTitle,
    });
  }

  const checkpoints = Array.isArray(debug.checkpoints) ? debug.checkpoints : [];
  const latestRunStatus =
    runs.length > 0 && typeof runs[0]?.status === "string"
      ? runs[0].status
      : null;
  if (
    runs.some((run: any) => isSuccessStatus(run?.status)) &&
    checkpoints.length > 0 &&
    counts.failedRuns === 0
  ) {
    counts.verifiedSuccess += 1;
    addEvidence(evidence, {
      kind: "verified-success",
      label: "Successful run produced a checkpoint",
      snippet: checkpoints[0],
      threadId: thread.id,
      threadTitle,
      runId:
        typeof checkpoints[0]?.run_id === "string"
          ? checkpoints[0].run_id
          : null,
    });
  }

  if (counts.rememberRequests) {
    reasons.push(
      reason(
        "remember-request",
        "User explicitly asked the agent to remember something",
        counts.rememberRequests * 30,
        counts.rememberRequests,
      ),
    );
  }
  if (counts.explicitCorrections) {
    reasons.push(
      reason(
        "explicit-correction",
        "User corrections should be considered for memory",
        counts.explicitCorrections * 25,
        counts.explicitCorrections,
      ),
    );
  }
  if (counts.failedRuns) {
    reasons.push(
      reason(
        "failed-run",
        "Failed or aborted runs are useful dream material",
        counts.failedRuns * 12,
        counts.failedRuns,
      ),
    );
  }
  if (counts.toolErrors) {
    reasons.push(
      reason(
        "tool-error",
        "Tool errors repeated inside the run",
        Math.min(30, counts.toolErrors * 4),
        counts.toolErrors,
      ),
    );
  }
  if (counts.negativeFeedback) {
    reasons.push(
      reason(
        "negative-feedback",
        "User feedback indicates the run may contain a lesson",
        counts.negativeFeedback * 20,
        counts.negativeFeedback,
      ),
    );
  }
  if (counts.evalFailures) {
    reasons.push(
      reason(
        "eval-failure",
        "Evaluation signals found a failure",
        counts.evalFailures * 20,
        counts.evalFailures,
      ),
    );
  }
  if (counts.lowSatisfaction || counts.frustration) {
    const total = counts.lowSatisfaction + counts.frustration;
    reasons.push(
      reason(
        "satisfaction-friction",
        "Satisfaction or user wording suggests friction",
        total * 10,
        total,
      ),
    );
  }
  if (counts.verifiedSuccess) {
    reasons.push(
      reason(
        "verified-success",
        "Successful checkpointed workflow may be worth preserving",
        8,
        counts.verifiedSuccess,
      ),
    );
  }

  const score = reasons.reduce((sum, entry) => sum + entry.score, 0);

  return {
    thread: {
      id: thread.id,
      ownerEmail: thread.ownerEmail,
      title: thread.title,
      preview: thread.preview,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    sourceId,
    score,
    reasons,
    evidenceCounts: counts,
    evidence: evidence.map((entry) => ({
      ...entry,
      sourceId: entry.sourceId ?? sourceId,
    })),
    latestRunStatus,
  };
}

interface ListDreamCandidatesInput {
  sourceId?: string;
  sourceIds?: string[];
  allSources?: boolean;
  query?: string;
  ownerEmail?: string;
  limit?: number;
  sourceTimeoutMs?: number;
  sourceConcurrency?: number;
  sourceStartStaggerMs?: number;
  threadConcurrency?: number;
  threadTimeoutMs?: number;
}

interface DreamSourceRef {
  id: string;
  label?: string | null;
}

interface DreamSourceScanResult {
  source: Record<string, unknown>;
  access: Record<string, unknown> | null;
  query: string | null;
  inspectedThreadCount: number;
  candidateCount: number;
  errors: Array<Record<string, unknown>>;
  candidates: DreamCandidate[];
  sources: DreamSourceHealth[];
}

function wantsAllDreamSources(input: ListDreamCandidatesInput): boolean {
  return Boolean(input.allSources || input.sourceId?.trim() === "all");
}

async function dreamSourceRefs(
  input: ListDreamCandidatesInput,
): Promise<DreamSourceRef[]> {
  const explicit = Array.from(
    new Set(
      (input.sourceIds ?? [])
        .map((sourceId) => sourceId.trim())
        .filter(Boolean),
    ),
  );
  if (explicit.length > 0) {
    return explicit.map((sourceId) => ({ id: sourceId, label: sourceId }));
  }

  const sourceId = input.sourceId?.trim() || "current";
  if (!wantsAllDreamSources(input)) {
    return [{ id: sourceId, label: sourceId }];
  }

  const listed = await listThreadDebugSources();
  const sources = listed.sources
    .filter((source) => source.connected)
    .map((source) => ({ id: source.id, label: source.label }));
  return sources.length > 0
    ? sources
    : [{ id: "current", label: "Current Dispatch DB" }];
}

async function inspectDreamSource(
  input: ListDreamCandidatesInput,
  sourceId: string,
  sourceTimeoutMs: number,
): Promise<Omit<DreamSourceScanResult, "sources">> {
  const limit = clampLimit(input.limit);
  const threadConcurrency = clampThreadConcurrency(input.threadConcurrency);
  const threadTimeoutMs = clampThreadTimeoutMs(
    input.threadTimeoutMs,
    sourceTimeoutMs,
  );
  const search = await searchAgentThreads({
    sourceId,
    query: input.query,
    ownerEmail: input.ownerEmail,
    limit,
  });

  const inspected = await mapWithConcurrency(
    search.threads,
    threadConcurrency,
    async (thread) => {
      const startedAt = now();
      try {
        const debug = await withTimeout(
          getAgentThreadDebug({
            sourceId,
            threadId: thread.id,
            ownerEmail: input.ownerEmail,
            maxRuns: 10,
            maxEvents: 300,
            maxTraceSpans: 200,
          }),
          `${sourceId}:${thread.id}`,
          threadTimeoutMs,
        );
        return {
          candidate: analyzeThreadDebug(debug, sourceId),
          error: null,
        };
      } catch (error) {
        const timedOut = isDreamSourceTimeout(error);
        return {
          candidate: null,
          error: {
            threadId: thread.id,
            sourceId,
            durationMs: now() - startedAt,
            timedOut,
            message: timedOut
              ? `Timed out after ${threadTimeoutMs}ms`
              : String((error as Error)?.message ?? error),
          },
        };
      }
    },
  );

  const candidates = inspected
    .map((entry) => entry.candidate)
    .filter((entry): entry is DreamCandidate => Boolean(entry))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt,
    );

  return {
    source: search.source,
    access: search.access,
    query: search.query,
    inspectedThreadCount: search.threads.length,
    candidateCount: candidates.length,
    errors: inspected
      .map((entry) => entry.error)
      .filter(
        (
          entry,
        ): entry is {
          threadId: string;
          sourceId: string;
          durationMs: number;
          timedOut: boolean;
          message: string;
        } => entry !== null,
      ) as Array<Record<string, unknown>>,
    candidates,
  };
}

async function scanDreamSource(
  input: ListDreamCandidatesInput,
  source: DreamSourceRef,
  timeoutMs: number,
): Promise<DreamSourceScanResult> {
  const startedAt = now();
  try {
    const result = await withTimeout(
      inspectDreamSource(input, source.id, timeoutMs),
      source.id,
      timeoutMs,
    );
    const completedAt = now();
    const durationMs = completedAt - startedAt;
    const sourceInfo = result.source ?? {};
    const sourceId = String(sourceInfo.id ?? source.id);
    const label = String(sourceInfo.label ?? source.label ?? source.id);
    return {
      ...result,
      sources: [
        {
          sourceId,
          label,
          status: "ok",
          startedAt,
          completedAt,
          durationMs,
          timeoutMs,
          inspectedThreadCount: result.inspectedThreadCount,
          candidateCount: result.candidateCount,
          errorCount: result.errors.length,
          threadErrorCount: result.errors.length,
        },
      ],
    };
  } catch (error) {
    const completedAt = now();
    const durationMs = completedAt - startedAt;
    const timedOut = isDreamSourceTimeout(error);
    const message = timedOut
      ? `Timed out after ${timeoutMs}ms`
      : compactErrorMessage(error);
    const status: DreamSourceStatus = timedOut ? "timed_out" : "error";
    return {
      source: {
        id: source.id,
        label: source.label ?? source.id,
        kind: "unknown",
        databaseUrlEnv: null,
      },
      access: null,
      query: input.query?.trim() || null,
      inspectedThreadCount: 0,
      candidateCount: 0,
      errors: [{ sourceId: source.id, message }],
      candidates: [],
      sources: [
        {
          sourceId: source.id,
          label: source.label ?? source.id,
          status,
          startedAt,
          completedAt,
          durationMs,
          timeoutMs,
          inspectedThreadCount: 0,
          candidateCount: 0,
          errorCount: 1,
          threadErrorCount: 0,
          message,
        },
      ],
    };
  }
}

export async function listDreamCandidates(input: ListDreamCandidatesInput) {
  const timeoutMs = clampSourceTimeoutMs(input.sourceTimeoutMs);
  const sources = await dreamSourceRefs(input);
  const sourceConcurrency = clampSourceConcurrency(input.sourceConcurrency);
  const sourceStartStaggerMs = clampSourceStartStaggerMs(
    input.sourceStartStaggerMs,
  );
  const scanResults = await mapWithConcurrency(
    sources,
    sourceConcurrency,
    async (source, index) => {
      if (sources.length > 1 && sourceStartStaggerMs > 0) {
        await sleep((index % sourceConcurrency) * sourceStartStaggerMs);
      }
      return scanDreamSource(input, source, timeoutMs);
    },
  );
  const aggregate = wantsAllDreamSources(input) || sources.length > 1;
  const candidates = dedupeDreamCandidates(
    scanResults.flatMap((result) => result.candidates),
  ).sort(
    (a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt,
  );
  const sourceHealth = scanResults.flatMap((result) => result.sources);

  return {
    source: aggregate
      ? {
          id: "all",
          label: "All configured sources",
          kind: "aggregate",
          databaseUrlEnv: null,
        }
      : scanResults[0]?.source,
    access: aggregate
      ? { scope: "combined", sourceCount: sources.length }
      : scanResults[0]?.access,
    query: input.query?.trim() || scanResults[0]?.query || null,
    inspectedThreadCount: scanResults.reduce(
      (sum, result) => sum + result.inspectedThreadCount,
      0,
    ),
    candidateCount: candidates.length,
    errors: scanResults.flatMap((result) => result.errors),
    sources: sourceHealth,
    candidates,
  };
}

function describeOwnerScope(scope: string): string {
  return scope.includes("@") ? "another user" : `"${scope}"`;
}

function personalMemoryBlockReasonForDream(
  result: Awaited<ReturnType<typeof listDreamCandidates>>,
  creatorEmail: string,
): string | null {
  const otherOwnerCount = new Set(
    result.candidates
      .map((candidate) => candidate.thread.ownerEmail)
      .filter((owner) => owner && !sameOwnerEmail(owner, creatorEmail))
      .map((owner) => owner.trim().toLowerCase()),
  ).size;
  if (otherOwnerCount === 1) {
    return "source evidence includes a thread owned by another user";
  }
  if (otherOwnerCount > 1) {
    return `source evidence includes threads owned by ${otherOwnerCount} other users`;
  }

  const scope = String((result.access as any)?.scope ?? "").trim();
  if (scope && !sameOwnerEmail(scope, creatorEmail)) {
    return `the source owner scope is ${describeOwnerScope(scope)} rather than the dream creator's personal scope`;
  }
  return null;
}

function evidenceSummary(evidence: DreamEvidence[], max = 6): string {
  return evidence
    .slice(0, max)
    .map((entry) => {
      const title = entry.threadTitle || entry.threadId;
      return `- ${entry.label} in ${title} (${entry.threadId}): ${entry.snippet}`;
    })
    .join("\n");
}

function collectCandidateEvidence(
  candidates: DreamCandidate[],
  kinds: string[],
): DreamEvidence[] {
  const allowed = new Set(kinds);
  const evidence: DreamEvidence[] = [];
  for (const candidate of candidates) {
    for (const entry of candidate.evidence) {
      if (!allowed.has(entry.kind)) continue;
      addEvidence(
        evidence,
        {
          ...entry,
          sourceId: entry.sourceId ?? candidate.sourceId,
        },
        80,
      );
    }
  }
  return evidence;
}

function dedupeDreamCandidates(candidates: DreamCandidate[]): DreamCandidate[] {
  const byThread = new Map<string, DreamCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.thread.ownerEmail.trim().toLowerCase()}:${candidate.thread.id}`;
    const existing = byThread.get(key);
    if (
      !existing ||
      candidate.score > existing.score ||
      (candidate.score === existing.score &&
        candidate.thread.updatedAt > existing.thread.updatedAt)
    ) {
      byThread.set(key, candidate);
    }
  }
  return [...byThread.values()];
}

function uniqueEvidenceThreads(evidence: DreamEvidence[]): Set<string> {
  return new Set(
    evidence
      .map((entry) => entry.threadId?.trim())
      .filter((threadId): threadId is string => Boolean(threadId)),
  );
}

function uniqueEvidenceSources(evidence: DreamEvidence[]): Set<string> {
  return new Set(
    evidence
      .map((entry) => entry.sourceId?.trim())
      .filter((sourceId): sourceId is string => Boolean(sourceId)),
  );
}

function evidenceSpansMultipleThreadsOrSources(
  evidence: DreamEvidence[],
): boolean {
  return (
    uniqueEvidenceThreads(evidence).size >= 2 ||
    uniqueEvidenceSources(evidence).size >= 2
  );
}

function evidenceStrengthCount(evidence: DreamEvidence[]): number {
  return Math.max(
    uniqueEvidenceThreads(evidence).size,
    uniqueEvidenceSources(evidence).size,
  );
}

const UI_WORDING_TERMS =
  /\b(ui|screen|page|view|button|label|copy|wording|modal|dialog|dropdown|menu|toolbar|sidebar|composer|sheet|tab|card|toast|form|field|layout|click|open|close)\b/i;

function looksLikeSingleAppUiWordingCorrection(
  evidence: DreamEvidence[],
): boolean {
  if (uniqueEvidenceSources(evidence).size > 1) return false;
  return evidence.some((entry) => {
    if (!["explicit-correction", "remember-request"].includes(entry.kind)) {
      return false;
    }
    return UI_WORDING_TERMS.test(entry.snippet);
  });
}

const NON_DURABLE_FAILURE_TERMS =
  /\b(credits[- ]?limit|daily ai credits|current plan|missing[_ -]?credentials|no llm provider|provider key|connect builder\.io|email[_ -]?verification[_ -]?required|verify their email|gateway)\b/i;

function isDurableFailureEvidence(entry: DreamEvidence): boolean {
  if (entry.kind === "eval-failure") return false;
  if (entry.kind === "tool-error") {
    return !NON_DURABLE_FAILURE_TERMS.test(entry.snippet);
  }
  if (entry.kind === "failed-run") {
    const normalized = normalizeEvidenceQuote(entry.snippet);
    return Boolean(
      normalized && !["errored", "failed", "aborted"].includes(normalized),
    );
  }
  return true;
}

function proposalFailureEvidence(
  evidence: DreamEvidence[],
  max = 10,
): DreamEvidence[] {
  const durable = evidence.filter(isDurableFailureEvidence);
  const supporting = evidence.filter((entry) => entry.kind === "eval-failure");
  return [...durable, ...supporting].slice(0, max);
}

function evidenceProvenance(date: string, evidence: DreamEvidence[]): string {
  const threads = [...uniqueEvidenceThreads(evidence)].slice(0, 8).join(", ");
  const sources = [...uniqueEvidenceSources(evidence)].slice(0, 8).join(", ");
  return `Provenance: Dispatch dream ${date}; source threads: ${threads || "none recorded"}${sources ? `; sources: ${sources}` : ""}`;
}

function addSuppressionNote(notes: string[], note: string) {
  if (!notes.includes(note)) notes.push(note);
}

function noProposalSuppressionNotes(input: {
  explicitEvidence: DreamEvidence[];
  failureEvidence: DreamEvidence[];
  durableFailureEvidence: DreamEvidence[];
  successEvidence: DreamEvidence[];
  personalMemoryAllowed: boolean;
  personalMemoryBlockReason: string;
}): string[] {
  const notes: string[] = [];

  if (input.explicitEvidence.length > 0) {
    if (!input.personalMemoryAllowed) {
      if (!evidenceSpansMultipleThreadsOrSources(input.explicitEvidence)) {
        addSuppressionNote(
          notes,
          `Skipped explicit user-correction proposals because personal memory is blocked (${input.personalMemoryBlockReason}) and the remaining correction evidence did not span multiple threads or source apps.`,
        );
      } else if (input.explicitEvidence.length < 2) {
        addSuppressionNote(
          notes,
          `Skipped explicit user-correction proposals because personal memory is blocked (${input.personalMemoryBlockReason}) and only one source-backed correction survived filtering.`,
        );
      }
    }

    if (looksLikeSingleAppUiWordingCorrection(input.explicitEvidence)) {
      addSuppressionNote(
        notes,
        "Skipped workspace-instruction promotion for explicit corrections because the evidence looked like single-app UI wording rather than an all-app operating rule.",
      );
    }
  }

  if (input.failureEvidence.length > 0) {
    if (input.durableFailureEvidence.length === 0) {
      addSuppressionNote(
        notes,
        "Skipped failure proposals because the signals were eval-only noise or non-durable setup, quota, provider, or verification issues.",
      );
    } else if (input.durableFailureEvidence.length < 2) {
      addSuppressionNote(
        notes,
        "Skipped failure proposals because fewer than two durable failure signals survived filtering.",
      );
    } else if (
      !evidenceSpansMultipleThreadsOrSources(input.durableFailureEvidence)
    ) {
      addSuppressionNote(
        notes,
        "Skipped failure proposals because durable failure evidence did not span multiple threads or source apps.",
      );
    } else if (input.durableFailureEvidence.length < 4) {
      addSuppressionNote(
        notes,
        "Skipped workspace-instruction promotion for failures because fewer than four durable failure signals survived filtering.",
      );
    }
  }

  if (
    input.successEvidence.length > 0 &&
    (input.successEvidence.length < 2 ||
      !evidenceSpansMultipleThreadsOrSources(input.successEvidence))
  ) {
    addSuppressionNote(
      notes,
      "Skipped success-pattern proposals because successful checkpoint evidence did not repeat across multiple threads or source apps.",
    );
  }

  return notes;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "agent",
  "always",
  "because",
  "before",
  "being",
  "could",
  "dispatch",
  "doing",
  "dream",
  "found",
  "from",
  "have",
  "into",
  "just",
  "latest",
  "memory",
  "next",
  "note",
  "please",
  "proposal",
  "recent",
  "remember",
  "review",
  "should",
  "source",
  "summary",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "thread",
  "threads",
  "user",
  "using",
  "with",
  "would",
]);

function emptyMemoryContext(): DreamMemoryContext {
  return {
    personalIndex: "",
    personalNotes: [],
    sharedLearnings: "",
    workspaceResources: [],
  };
}

function normalizeMemoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9@._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  const tokens = normalizeMemoryText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function containmentScore(needle: string, haystack: string): number {
  const needleTokens = tokenSet(needle);
  if (needleTokens.size === 0) return 0;
  const haystackTokens = tokenSet(haystack);
  let matches = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) matches += 1;
  }
  return matches / needleTokens.size;
}

function hasExactSourceMatch(
  evidence: DreamEvidence[],
  content: string,
): boolean {
  const normalized = normalizeMemoryText(content);
  return evidence.some((entry) => {
    if (entry.threadId && normalized.includes(entry.threadId.toLowerCase())) {
      return true;
    }
    if (entry.runId && normalized.includes(entry.runId.toLowerCase())) {
      return true;
    }
    return false;
  });
}

function evidenceSignalText(evidence: DreamEvidence[]): string {
  return evidence.map((entry) => entry.snippet).join("\n");
}

function hasCorrectionLanguage(evidence: DreamEvidence[]): boolean {
  return evidence.some((entry) => {
    if (entry.kind !== "explicit-correction") return false;
    const text = entry.snippet.toLowerCase();
    return /\b(actually|instead|don't|do not|never|wrong|not what i meant|from now on|you should)\b/.test(
      text,
    );
  });
}

function findPersonalMemoryMatch(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): {
  note: DreamMemoryNote;
  score: number;
  exactSource: boolean;
} | null {
  const signal = evidenceSignalText(evidence);
  let best: {
    note: DreamMemoryNote;
    score: number;
    exactSource: boolean;
  } | null = null;

  for (const note of memoryContext.personalNotes) {
    const exactSource = hasExactSourceMatch(evidence, note.content);
    const score = exactSource ? 1 : containmentScore(signal, note.content);
    if (!best || score > best.score) {
      best = { note, score, exactSource };
    }
  }

  if (!best) return null;
  if (best.exactSource || best.score >= 0.42) return best;
  return null;
}

function sharedLearningLooksCaptured(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): boolean {
  if (!memoryContext.sharedLearnings.trim()) return false;
  if (hasExactSourceMatch(evidence, memoryContext.sharedLearnings)) return true;
  return (
    containmentScore(
      evidenceSignalText(evidence),
      memoryContext.sharedLearnings,
    ) >= 0.58
  );
}

function workspaceResourceLooksCaptured(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): boolean {
  const resources = memoryContext.workspaceResources ?? [];
  if (resources.length === 0) return false;
  return resources.some((resource) => {
    if (hasExactSourceMatch(evidence, resource.content)) return true;
    return (
      containmentScore(evidenceSignalText(evidence), resource.content) >= 0.62
    );
  });
}

function personalIndexLooksCaptured(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): boolean {
  if (!memoryContext.personalIndex.trim()) return false;
  if (hasExactSourceMatch(evidence, memoryContext.personalIndex)) return true;
  return (
    containmentScore(
      evidenceSignalText(evidence),
      memoryContext.personalIndex,
    ) >= 0.72
  );
}

function proposalLooksCaptured(
  proposal: DreamProposalInput,
  memoryContext: DreamMemoryContext,
): boolean {
  if (proposal.targetType === "shared-learnings") {
    return sharedLearningLooksCaptured(memoryContext, proposal.evidence);
  }
  if (proposal.targetType.startsWith("workspace-")) {
    return workspaceResourceLooksCaptured(memoryContext, proposal.evidence);
  }
  if (personalIndexLooksCaptured(memoryContext, proposal.evidence)) {
    return true;
  }
  const match = findPersonalMemoryMatch(memoryContext, proposal.evidence);
  return Boolean(match?.exactSource || (match && match.score >= 0.72));
}

async function loadDreamMemoryContext(
  owner: string,
): Promise<DreamMemoryContext> {
  const [index, shared, personalMetas, workspaceResources] = await Promise.all([
    resourceGetByPath(owner, MEMORY_INDEX_PATH),
    resourceGetByPath(SHARED_OWNER, "LEARNINGS.md"),
    resourceList(owner, "memory/").catch(() => []),
    listWorkspaceResources().catch(() => []),
  ]);
  const paths = personalMetas
    .map((entry) => entry.path)
    .filter((path) => path !== MEMORY_INDEX_PATH && path.endsWith(".md"))
    .slice(0, 30);
  const personalNotes = (
    await Promise.all(
      paths.map(async (path) => {
        const resource = await resourceGetByPath(owner, path).catch(() => null);
        if (!resource?.content) return null;
        return { path, content: resource.content };
      }),
    )
  ).filter((entry): entry is DreamMemoryNote => Boolean(entry));

  return {
    personalIndex: index?.content ?? "",
    personalNotes,
    sharedLearnings: shared?.content ?? "",
    workspaceResources: workspaceResources.map((resource) => ({
      path: resource.path,
      content: resource.content,
    })),
  };
}

function applyMemoryGuardrails(
  proposals: DreamProposalInput[],
  memoryContext: DreamMemoryContext,
): DreamProposalBuildResult {
  const guarded: DreamProposalInput[] = [];
  const guardrailNotes: string[] = [];

  for (const proposal of proposals) {
    if (
      proposal.targetType === "personal-memory" &&
      hasCorrectionLanguage(proposal.evidence)
    ) {
      const match = findPersonalMemoryMatch(memoryContext, proposal.evidence);
      if (match?.exactSource) {
        guardrailNotes.push(
          `Skipped duplicate proposal "${proposal.title}" because existing memory already appears to capture the source evidence.`,
        );
        continue;
      }
      if (match && match.score >= 0.42) {
        guarded.push({
          ...proposal,
          targetPath: match.note.path,
          title: "Update existing memory from recent corrections",
          summary: `Existing memory at ${match.note.path} may be stale; update it with the latest explicit correction evidence.`,
          rationale: `${proposal.rationale} A related personal memory already exists, so the dream should update it instead of creating a parallel note.`,
          content: [
            "# Dispatch Dream Memory Update",
            "",
            `Existing memory: ${match.note.path}`,
            "",
            "Recent agent runs contained newer explicit user-grounded lessons:",
            "",
            evidenceSummary(proposal.evidence, 10),
          ].join("\n"),
        });
        guardrailNotes.push(
          `Retargeted proposal "${proposal.title}" to existing memory ${match.note.path} to avoid creating a stale duplicate.`,
        );
        continue;
      }
    }

    if (proposalLooksCaptured(proposal, memoryContext)) {
      guardrailNotes.push(
        `Skipped duplicate proposal "${proposal.title}" because existing memory already appears to capture the source evidence.`,
      );
      continue;
    }

    guarded.push(proposal);
  }

  return { proposals: guarded, guardrailNotes };
}

function makeReport(input: {
  title: string;
  sourceId: string;
  query: string | null;
  candidates: DreamCandidate[];
  inspectedThreadCount: number;
  proposals: DreamProposalInput[];
  guardrailNotes?: string[];
  sourceHealth?: DreamSourceHealth[];
}) {
  const completedSourceCount =
    input.sourceHealth?.filter((source) => source.status === "ok").length ?? 0;
  const lines = [
    `# ${input.title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${input.sourceId}`,
    `Query: ${input.query || "(recent threads)"}`,
    `Inspected threads: ${input.inspectedThreadCount}`,
    `Candidates: ${input.candidates.length}`,
    `Proposals: ${input.proposals.length}`,
  ];

  if (input.sourceHealth && input.sourceHealth.length > 0) {
    lines.push(
      `Sources completed: ${completedSourceCount}/${input.sourceHealth.length}`,
    );
    lines.push("", "## Source Health");
    for (const source of input.sourceHealth) {
      const label = source.label || source.sourceId;
      const message = source.message
        ? ` — ${compactText(source.message, 160)}`
        : "";
      lines.push(
        `- ${label} (${source.sourceId}): ${source.status} in ${source.durationMs}ms, ${source.inspectedThreadCount} inspected, ${source.candidateCount} candidates, ${source.errorCount} errors${message}`,
      );
    }
  }

  lines.push("", "## Candidate Signals");

  if (input.candidates.length === 0) {
    lines.push("", "No dream-worthy signals were found in this pass.");
  } else {
    for (const candidate of input.candidates.slice(0, 12)) {
      lines.push(
        "",
        `### ${candidate.thread.title || candidate.thread.id}`,
        "",
        `- Thread: ${candidate.thread.id}`,
        `- Score: ${candidate.score}`,
        `- Latest run status: ${candidate.latestRunStatus || "unknown"}`,
        `- Reasons: ${candidate.reasons.map((entry) => entry.label).join("; ")}`,
        "",
        "Evidence:",
        evidenceSummary(candidate.evidence, 4) ||
          "- No compact evidence available.",
      );
    }
  }

  if (input.guardrailNotes && input.guardrailNotes.length > 0) {
    lines.push("", "## Proposal Guardrails");
    for (const note of input.guardrailNotes) {
      lines.push("", `- ${note}`);
    }
  }

  lines.push("", "## Proposals");
  if (input.proposals.length === 0) {
    lines.push("", "No durable changes were proposed.");
  } else {
    for (const proposal of input.proposals) {
      lines.push(
        "",
        `### ${proposal.title}`,
        "",
        `- Target: ${proposal.targetType} at ${proposal.targetPath}`,
        `- Confidence: ${proposal.confidence}`,
        `- Risk: ${proposal.risk}`,
        `- Summary: ${proposal.summary}`,
        "",
        "Evidence:",
        evidenceSummary(proposal.evidence, 5),
      );
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function buildProposalInputs(
  candidates: DreamCandidate[],
  memoryContext: DreamMemoryContext = emptyMemoryContext(),
  options: DreamProposalBuildOptions = {},
): DreamProposalBuildResult {
  const proposals: DreamProposalInput[] = [];
  const personalMemoryAllowed = options.personalMemoryAllowed ?? true;
  const personalMemoryBlockReason =
    options.personalMemoryBlockReason?.trim() ||
    "source owner scope differs from the dream creator's personal scope";
  let routedPersonalMemory = false;
  const explicitEvidence = collectCandidateEvidence(candidates, [
    "remember-request",
    "explicit-correction",
  ]);
  const failureEvidence = collectCandidateEvidence(candidates, [
    "failed-run",
    "tool-error",
    "negative-feedback",
    "eval-failure",
    "low-satisfaction",
    "frustration",
  ]);
  const durableFailureEvidence = failureEvidence.filter(
    isDurableFailureEvidence,
  );
  const failureProposalEvidence = proposalFailureEvidence(failureEvidence, 10);
  const successEvidence = collectCandidateEvidence(candidates, [
    "verified-success",
  ]);
  const date = today();
  const explicitStrengthCount = evidenceStrengthCount(explicitEvidence);
  const durableFailureStrengthCount = evidenceStrengthCount(
    durableFailureEvidence,
  );
  const successStrengthCount = evidenceStrengthCount(successEvidence);

  if (explicitEvidence.length > 0) {
    const title = `Dispatch dream memory ${date}`;
    if (personalMemoryAllowed) {
      proposals.push({
        targetType: "personal-memory",
        targetPath: `memory/${slugify(title)}.md`,
        title: "Save explicit user corrections from recent agent runs",
        summary:
          "Recent threads contain explicit user corrections or remember requests that may be worth preserving as personal memory.",
        rationale:
          "Explicit user corrections and remember requests are high-signal, user-grounded evidence for personal memory.",
        content: [
          "# Dispatch Dream Memory",
          "",
          "Recent agent runs contained explicit user-grounded lessons:",
          "",
          evidenceSummary(explicitEvidence, 10),
        ].join("\n"),
        evidence: explicitEvidence.slice(0, 10),
        confidence: Math.min(95, 70 + explicitEvidence.length * 5),
        risk: "low",
      });
    } else if (
      explicitEvidence.length >= 2 &&
      evidenceSpansMultipleThreadsOrSources(explicitEvidence)
    ) {
      routedPersonalMemory = true;
      proposals.push({
        targetType: "shared-learnings",
        targetPath: "LEARNINGS.md",
        title: "Review explicit user corrections as shared learnings",
        summary:
          "Recent admin-visible threads contain explicit user corrections or remember requests that should stay reviewable as shared learnings instead of personal memory.",
        rationale: `Personal memory is blocked because ${personalMemoryBlockReason}. Shared learnings keep the evidence visible for review without writing another user's snippets into the dream creator's memory.`,
        content: [
          "Recent Dispatch dream review found explicit user-grounded lessons in admin-visible threads.",
          "",
          `Provenance: Personal memory was disabled for this proposal because ${personalMemoryBlockReason}.`,
          "",
          evidenceSummary(explicitEvidence, 10),
        ].join("\n"),
        evidence: explicitEvidence.slice(0, 10),
        confidence: Math.min(95, 70 + explicitEvidence.length * 5),
        risk: "medium",
      });
    }
  }

  if (
    durableFailureEvidence.length >= 2 &&
    evidenceSpansMultipleThreadsOrSources(durableFailureEvidence)
  ) {
    proposals.push({
      targetType: "shared-learnings",
      targetPath: "LEARNINGS.md",
      title: "Record recurring Dispatch agent-run failure patterns",
      summary:
        "Multiple recent threads or source apps show failure, tool-error, eval, or satisfaction signals that should be reviewed as a team learning.",
      rationale:
        "Repeated grounded failure signals across more than one thread or source app are good candidates for shared learnings, but remain pending for review.",
      content: [
        "Recent Dispatch dream review found recurring agent-run failure signals.",
        "",
        evidenceSummary(failureProposalEvidence, 8),
      ].join("\n"),
      evidence: failureProposalEvidence.slice(0, 8),
      confidence: Math.min(85, 50 + durableFailureStrengthCount * 10),
      risk: "medium",
    });
  }

  if (
    explicitEvidence.length >= 3 &&
    evidenceSpansMultipleThreadsOrSources(explicitEvidence) &&
    !looksLikeSingleAppUiWordingCorrection(explicitEvidence)
  ) {
    proposals.push({
      targetType: "workspace-instruction",
      targetPath: `instructions/${slugify(`dream-corrections-${date}`)}.md`,
      title: "Create workspace instruction from repeated user corrections",
      summary:
        "Repeated explicit user corrections or remember requests should become an all-app workspace instruction after review.",
      rationale:
        "Repeated corrections across more than one thread or source app are stronger than one-off memory. A workspace instruction lets every app inherit the reviewed behavior.",
      content: [
        "# Dream-Derived Workspace Instruction",
        "",
        "Apply this only after reviewing the cited source threads.",
        "",
        "Recent agent runs contained repeated user-grounded corrections or remember requests:",
        "",
        evidenceSummary(explicitEvidence, 10),
        "",
        "Instruction draft:",
        "",
        "- Preserve explicit user corrections as durable behavior only when the evidence is user-authored and source-backed.",
        "- Prefer existing workspace resources, skills, and app conventions before introducing a new pattern.",
        "- If the same correction appears across apps or threads, treat it as a candidate for a workspace-level instruction instead of only personal memory.",
        "",
        evidenceProvenance(date, explicitEvidence),
      ].join("\n"),
      evidence: explicitEvidence.slice(0, 10),
      confidence: Math.min(90, 60 + explicitStrengthCount * 8),
      risk: "medium",
    });
  }

  if (
    durableFailureEvidence.length >= 4 &&
    evidenceSpansMultipleThreadsOrSources(durableFailureEvidence)
  ) {
    proposals.push({
      targetType: "workspace-instruction",
      targetPath: `instructions/${slugify(`dream-run-reliability-${date}`)}.md`,
      title: "Create workspace instruction for recurring agent-run friction",
      summary:
        "Recurring frustration and failure signals across threads or source apps should become a reviewed workspace reliability instruction.",
      rationale:
        "Repeated failure or frustration signals across multiple threads or source apps are useful as a shared guardrail, but they need review before they affect all app agents.",
      content: [
        "# Dream-Derived Agent Reliability Instruction",
        "",
        "Apply this only after reviewing the cited source threads.",
        "",
        "Recent agent runs contained recurring friction or failure signals:",
        "",
        evidenceSummary(failureProposalEvidence, 10),
        "",
        "Instruction draft:",
        "",
        "- When a task repeats a prior failure mode, pause to inspect source context, previous attempts, and existing docs before changing code or data.",
        "- Prefer small, verified changes with provenance over broad rewrites when responding to user frustration.",
        "- Convert repeated failures into a durable workspace resource only after evidence spans multiple threads or apps.",
        "",
        evidenceProvenance(date, failureProposalEvidence),
      ].join("\n"),
      evidence: failureProposalEvidence.slice(0, 10),
      confidence: Math.min(85, 50 + durableFailureStrengthCount * 8),
      risk: "medium",
    });
  }

  if (
    proposals.length === 0 &&
    successEvidence.length >= 2 &&
    evidenceSpansMultipleThreadsOrSources(successEvidence)
  ) {
    if (personalMemoryAllowed) {
      proposals.push({
        targetType: "personal-memory",
        targetPath: `memory/${slugify(`dispatch-success-patterns-${date}`)}.md`,
        title: "Preserve successful Dispatch workflow patterns",
        summary:
          "Recent successful checkpointed runs may contain reusable workflow patterns.",
        rationale:
          "Checkpointed successful runs are lower-risk candidates for personal memory when no correction or failure proposals are present.",
        content: [
          "# Successful Dispatch Patterns",
          "",
          "Recent checkpointed runs worth reviewing:",
          "",
          evidenceSummary(successEvidence, 8),
        ].join("\n"),
        evidence: successEvidence.slice(0, 8),
        confidence: 60,
        risk: "low",
      });
    } else {
      routedPersonalMemory = true;
      proposals.push({
        targetType: "shared-learnings",
        targetPath: "LEARNINGS.md",
        title: "Review successful Dispatch workflow patterns",
        summary:
          "Recent successful checkpointed runs may contain reusable workflow patterns, but the source scope is not personal to the dream creator.",
        rationale: `Personal memory is blocked because ${personalMemoryBlockReason}. Shared learnings keep the cross-owner workflow evidence reviewable.`,
        content: [
          "Recent Dispatch dream review found checkpointed runs worth reviewing.",
          "",
          `Provenance: Personal memory was disabled for this proposal because ${personalMemoryBlockReason}.`,
          "",
          evidenceSummary(successEvidence, 8),
        ].join("\n"),
        evidence: successEvidence.slice(0, 8),
        confidence: 60,
        risk: "medium",
      });
    }
  }

  if (
    successEvidence.length >= 2 &&
    evidenceSpansMultipleThreadsOrSources(successEvidence)
  ) {
    proposals.push({
      targetType: "workspace-skill",
      targetPath: `skills/${slugify(`dispatch-success-patterns-${date}`)}/SKILL.md`,
      title: "Create workspace skill from successful Dispatch patterns",
      summary:
        "Successful checkpointed workflows across multiple threads may deserve a reusable all-app skill.",
      rationale:
        "Repeated successful, checkpointed workflows are candidates for reusable skills when they can be stated as a repeatable procedure and reviewed by a human.",
      content: [
        "---",
        `name: ${slugify(`dispatch-success-patterns-${date}`)}`,
        "description: >-",
        "  Use when a task resembles recent successful Dispatch workflows and the agent needs a reviewed repeatable procedure.",
        "---",
        "",
        "# Dispatch Success Patterns",
        "",
        "This skill was drafted from a Dispatch dream report. Review and tighten it before applying broadly.",
        "",
        "## Source Evidence",
        "",
        evidenceSummary(successEvidence, 10),
        "",
        "## Procedure Draft",
        "",
        "1. Identify the source thread or workflow that most closely matches the current task.",
        "2. Reuse the verified sequence of actions only after checking current app state and available actions.",
        "3. Run the smallest relevant verification step before presenting the result.",
        "4. Record any user correction as a new dream candidate rather than silently broadening the skill.",
      ].join("\n"),
      evidence: successEvidence.slice(0, 10),
      confidence: Math.min(80, 50 + successStrengthCount * 10),
      risk: "medium",
    });
  }

  const suppressionNotes = noProposalSuppressionNotes({
    explicitEvidence,
    failureEvidence,
    durableFailureEvidence,
    successEvidence,
    personalMemoryAllowed,
    personalMemoryBlockReason,
  });
  const result = applyMemoryGuardrails(proposals, memoryContext);
  if (routedPersonalMemory) {
    result.guardrailNotes.unshift(
      `Routed personal-memory dream proposals to shared learnings because ${personalMemoryBlockReason}.`,
    );
  }
  if (result.proposals.length === 0) {
    for (const note of suppressionNotes) {
      addSuppressionNote(result.guardrailNotes, note);
    }
  }
  return result;
}

function summarizeDream(
  candidates: DreamCandidate[],
  proposals: number,
  sourceHealth: DreamSourceHealth[] = [],
): string {
  const failedSources = sourceHealth.filter((source) => source.status !== "ok");
  const sourcePrefix =
    sourceHealth.length > 1
      ? `${sourceHealth.length - failedSources.length}/${sourceHealth.length} sources completed${failedSources.length > 0 ? ` with ${failedSources.length} partial` : ""}. `
      : "";
  if (candidates.length === 0) {
    return `${sourcePrefix}No dream-worthy signals were found in the inspected threads.`;
  }
  const topReason = candidates[0]?.reasons[0]?.label ?? "agent-run signals";
  return `${sourcePrefix}Reviewed ${candidates.length} candidate thread(s), led by ${topReason}. Created ${proposals} proposal(s).`;
}

function serializeProposal(row: DreamProposalRow) {
  return {
    ...row,
    evidence: safeJsonParse<DreamEvidence[]>(row.evidence, []),
  };
}

function serializeDream(row: DreamRow) {
  return {
    ...row,
    sourceHealth: safeJsonParse<DreamSourceHealth[]>(
      (row as DreamRow & { sourceHealth?: string | null }).sourceHealth,
      [],
    ),
  };
}

async function getDreamRow(
  dreamId: string,
  ctx: DispatchCtx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() },
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchDreams)
    .where(
      and(
        eq(schema.dispatchDreams.id, dreamId),
        scopeFor(schema.dispatchDreams, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getProposalRow(
  proposalId: string,
  ctx: DispatchCtx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() },
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchDreamProposals)
    .where(
      and(
        eq(schema.dispatchDreamProposals.id, proposalId),
        scopeFor(schema.dispatchDreamProposals, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createDreamReport(input: {
  sourceId?: string;
  sourceIds?: string[];
  allSources?: boolean;
  query?: string;
  ownerEmail?: string;
  limit?: number;
  sourceTimeoutMs?: number;
  sourceConcurrency?: number;
  sourceStartStaggerMs?: number;
  threadConcurrency?: number;
  threadTimeoutMs?: number;
  title?: string;
}) {
  const db = getDb();
  const timestamp = now();
  const ownerEmail = currentOwnerEmail();
  const orgId = currentOrgId();
  const dreamId = id();
  const allSources =
    wantsAllDreamSources(input) || (input.sourceIds?.length ?? 0) > 0;
  const sourceId = allSources ? "all" : input.sourceId?.trim() || "current";
  const query = input.query?.trim() || null;
  const title = input.title?.trim() || `Dispatch dream ${today()}`;

  await db.insert(schema.dispatchDreams).values({
    id: dreamId,
    ownerEmail,
    orgId,
    sourceId,
    title,
    status: "running" satisfies DreamStatus,
    query,
    report: null,
    summary: null,
    sourceHealth: null,
    candidateCount: 0,
    inspectedThreadCount: 0,
    createdBy: ownerEmail,
    error: null,
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    const result = await listDreamCandidates({
      sourceId,
      sourceIds: input.sourceIds,
      allSources,
      query: input.query,
      ownerEmail: input.ownerEmail,
      limit: input.limit,
      sourceTimeoutMs: input.sourceTimeoutMs,
      sourceConcurrency: input.sourceConcurrency,
      sourceStartStaggerMs: input.sourceStartStaggerMs,
      threadConcurrency: input.threadConcurrency,
      threadTimeoutMs: input.threadTimeoutMs,
    });
    const memoryContext = await loadDreamMemoryContext(ownerEmail).catch(() =>
      emptyMemoryContext(),
    );
    const personalMemoryBlockReason = personalMemoryBlockReasonForDream(
      result,
      ownerEmail,
    );
    const proposalBuild = buildProposalInputs(
      result.candidates,
      memoryContext,
      {
        personalMemoryAllowed: personalMemoryBlockReason == null,
        personalMemoryBlockReason,
      },
    );
    const proposalInputs = proposalBuild.proposals;
    const report = makeReport({
      title,
      sourceId,
      query,
      candidates: result.candidates,
      inspectedThreadCount: result.inspectedThreadCount,
      proposals: proposalInputs,
      guardrailNotes: proposalBuild.guardrailNotes,
      sourceHealth: result.sources,
    });
    const summary = summarizeDream(
      result.candidates,
      proposalInputs.length,
      result.sources,
    );
    const completedAt = now();

    if (proposalInputs.length > 0) {
      await db.insert(schema.dispatchDreamProposals).values(
        proposalInputs.map((proposal) => ({
          id: id(),
          dreamId,
          ownerEmail,
          orgId,
          targetType: proposal.targetType,
          targetPath: proposal.targetPath,
          title: proposal.title,
          summary: proposal.summary,
          rationale: proposal.rationale,
          content: proposal.content,
          evidence: safeJson(proposal.evidence),
          confidence: proposal.confidence,
          risk: proposal.risk,
          status: "pending" satisfies ProposalStatus,
          appliedBy: null,
          appliedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          createdAt: completedAt,
          updatedAt: completedAt,
        })),
      );
    }

    await db
      .update(schema.dispatchDreams)
      .set({
        status: "completed" satisfies DreamStatus,
        report,
        summary,
        sourceHealth: safeJson(result.sources),
        candidateCount: result.candidateCount,
        inspectedThreadCount: result.inspectedThreadCount,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(schema.dispatchDreams.id, dreamId));

    await recordAudit({
      action: "dream.created",
      targetType: "dream",
      targetId: dreamId,
      summary,
      metadata: {
        sourceId,
        query,
        candidates: result.candidateCount,
        inspectedThreads: result.inspectedThreadCount,
        proposals: proposalInputs.length,
        sources: result.sources,
        personalMemoryBlocked: personalMemoryBlockReason,
      },
    });

    return getDream(dreamId);
  } catch (error) {
    const failedAt = now();
    const message = String((error as Error)?.message ?? error);
    await db
      .update(schema.dispatchDreams)
      .set({
        status: "failed" satisfies DreamStatus,
        error: message,
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(schema.dispatchDreams.id, dreamId));
    await recordAudit({
      action: "dream.failed",
      targetType: "dream",
      targetId: dreamId,
      summary: `Dream report failed: ${message}`,
      metadata: { sourceId, query },
    });
    throw error;
  }
}

export async function listDreams(
  input: {
    limit?: number;
    status?: DreamStatus | "all";
  } = {},
) {
  const db = getDb();
  const ctx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() };
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const filters = [scopeFor(schema.dispatchDreams, ctx)];
  if (input.status && input.status !== "all") {
    filters.push(eq(schema.dispatchDreams.status, input.status));
  }
  const dreams = await db
    .select()
    .from(schema.dispatchDreams)
    .where(and(...filters))
    .orderBy(desc(schema.dispatchDreams.updatedAt))
    .limit(limit);

  const dreamIds = dreams.map((dream) => dream.id);
  const proposals =
    dreamIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.dispatchDreamProposals)
          .where(inArray(schema.dispatchDreamProposals.dreamId, dreamIds));

  const counts = new Map<string, Record<string, number>>();
  for (const proposal of proposals) {
    const existing = counts.get(proposal.dreamId) ?? {};
    existing[proposal.status] = (existing[proposal.status] ?? 0) + 1;
    existing.total = (existing.total ?? 0) + 1;
    counts.set(proposal.dreamId, existing);
  }

  return {
    count: dreams.length,
    dreams: dreams.map((dream) => ({
      ...serializeDream(dream),
      proposalCounts: counts.get(dream.id) ?? { total: 0 },
    })),
  };
}

export async function getDream(dreamId: string) {
  const db = getDb();
  const dream = await getDreamRow(dreamId);
  if (!dream) throw new Error("Dream not found");
  const proposals = await db
    .select()
    .from(schema.dispatchDreamProposals)
    .where(eq(schema.dispatchDreamProposals.dreamId, dream.id))
    .orderBy(desc(schema.dispatchDreamProposals.createdAt));

  return {
    dream: serializeDream(dream),
    proposals: proposals.map(serializeProposal),
  };
}

async function savePersonalMemory(proposal: DreamProposalRow) {
  if (proposal.targetType !== "personal-memory") {
    throw new Error("Proposal is not a personal-memory proposal");
  }
  const owner = proposal.ownerEmail;
  if (owner !== currentOwnerEmail()) {
    throw new Error("Personal memory proposals can only be applied by owner");
  }
  const targetPath = personalMemoryTargetPath(proposal);
  if (targetPath === MEMORY_INDEX_PATH || !targetPath.endsWith(".md")) {
    throw new Error("Personal memory proposals must target memory/<name>.md");
  }
  const name = targetPath.replace(/^memory\//, "").replace(/\.md$/, "");
  const date = today();
  const description = compactText(proposal.summary, 140);
  const evidence = safeJsonParse<DreamEvidence[]>(proposal.evidence, []);
  const fileContent = [
    "---",
    "type: feedback",
    `description: ${JSON.stringify(description.replace(/\n/g, " "))}`,
    `updated: ${date}`,
    "---",
    "",
    proposal.content.trim(),
    "",
    "## Provenance",
    "",
    `Dream: ${proposal.dreamId}`,
    `Proposal: ${proposal.id}`,
    "",
    evidenceSummary(evidence, 10),
    "",
  ].join("\n");

  await resourcePut(owner, targetPath, fileContent, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  const existingIndex = await resourceGetByPath(owner, MEMORY_INDEX_PATH);
  const index = existingIndex?.content ?? "# Memory Index\n";
  const entryLine = `- [${name}](${name}.md) — ${description}`;
  const entryPrefix = `- [${name}]`;
  let found = false;
  const lines = index.split("\n").map((line) => {
    if (line.startsWith(entryPrefix)) {
      found = true;
      return entryLine;
    }
    return line;
  });
  if (!found) lines.push(entryLine);
  const updatedIndex = lines.join("\n").trimEnd() + "\n";

  await resourcePut(owner, MEMORY_INDEX_PATH, updatedIndex, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  return {
    resourcePath: targetPath,
    indexPath: MEMORY_INDEX_PATH,
    indexLineCount: updatedIndex.split("\n").length,
  };
}

async function appendSharedLearning(proposal: DreamProposalRow) {
  if (proposal.targetType !== "shared-learnings") {
    throw new Error("Proposal is not a shared-learnings proposal");
  }
  const evidence = safeJsonParse<DreamEvidence[]>(proposal.evidence, []);
  const existing = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");
  const current =
    existing?.content ??
    "# Learnings\n\n## Preferences\n\n## Corrections\n\n## Patterns\n";
  const sources = [...new Set(evidence.map((entry) => entry.threadId))]
    .slice(0, 6)
    .join(", ");
  const entry = [
    `- ${today()}: ${compactText(proposal.summary, 220)}`,
    `  Source dream: ${proposal.dreamId}; source threads: ${sources || "none recorded"}.`,
  ].join("\n");
  const updated = current.includes("## Patterns")
    ? current.replace("## Patterns", `## Patterns\n\n${entry}`)
    : `${current.trimEnd()}\n\n## Patterns\n\n${entry}\n`;

  await resourcePut(SHARED_OWNER, "LEARNINGS.md", updated, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  return {
    resourcePath: "LEARNINGS.md",
    owner: SHARED_OWNER,
  };
}

function workspaceResourceKindForTarget(
  targetType: string,
): WorkspaceResourceKind | null {
  if (targetType === "workspace-instruction") return "instruction";
  if (targetType === "workspace-skill") return "skill";
  if (targetType === "workspace-knowledge") return "knowledge";
  if (targetType === "workspace-agent") return "agent";
  return null;
}

function workspaceResourceName(proposal: DreamProposalRow): string {
  return proposal.title
    .replace(/^Create workspace (instruction|skill|knowledge|agent) from /i, "")
    .replace(/^Create workspace (instruction|skill|knowledge|agent) /i, "")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function personalMemoryTargetPath(proposal: DreamProposalRow): string {
  return proposal.targetPath.startsWith("memory/")
    ? proposal.targetPath
    : `memory/${slugify(proposal.title)}.md`;
}

function validateWorkspaceResourcePath(
  kind: WorkspaceResourceKind,
  path: string,
) {
  if (!path.trim() || path.includes("..") || path.startsWith("/")) {
    throw new Error("Workspace resource proposal has an invalid target path");
  }
  if (kind === "instruction") {
    if (path === "AGENTS.md" || path.startsWith("instructions/")) return;
    throw new Error(
      "Workspace instruction proposals must target AGENTS.md or instructions/<name>.md",
    );
  }
  if (kind === "skill") {
    if (path.startsWith("skills/") && path.endsWith("/SKILL.md")) return;
    throw new Error(
      "Workspace skill proposals must target skills/<name>/SKILL.md",
    );
  }
  if (kind === "knowledge") {
    if (path.startsWith("context/")) return;
    throw new Error(
      "Workspace knowledge proposals must target context/<name>.md",
    );
  }
  if (kind === "agent") {
    if (path.startsWith("agents/") && path.endsWith(".md")) return;
    throw new Error("Workspace agent proposals must target agents/<name>.md");
  }
}

async function applyWorkspaceResourceProposal(proposal: DreamProposalRow) {
  const kind = workspaceResourceKindForTarget(proposal.targetType);
  if (!kind)
    throw new Error(`Unsupported workspace target: ${proposal.targetType}`);
  validateWorkspaceResourcePath(kind, proposal.targetPath);
  const scope: WorkspaceResourceScope = "all";
  const resources = await listWorkspaceResources({ kind });
  const existing = resources.find(
    (resource) => resource.path === proposal.targetPath,
  );
  const name = workspaceResourceName(proposal);
  const description = compactText(proposal.summary, 220);
  if (existing) {
    const updated = await updateWorkspaceResource(existing.id, {
      name,
      description,
      content: proposal.content,
      scope,
    });
    return {
      action: "updated",
      resourceId: updated?.id ?? existing.id,
      resourcePath: proposal.targetPath,
      kind,
      scope,
    };
  }

  const created = await createWorkspaceResource({
    kind,
    name,
    description,
    path: proposal.targetPath,
    content: proposal.content,
    scope,
  });
  return {
    action: "created",
    resourceId: created?.id ?? null,
    resourcePath: proposal.targetPath,
    kind,
    scope,
  };
}

function proposalRequiresApproval(proposal: DreamProposalRow): boolean {
  return proposal.targetType !== "personal-memory";
}

export async function previewDreamProposal(proposalId: string) {
  const proposal = await getProposalRow(proposalId);
  if (!proposal) throw new Error("Dream proposal not found");

  let currentContent: string | null = null;
  let targetExists = false;
  let operation: "create" | "update" | "append" = "create";
  let target = {
    type: proposal.targetType,
    path: proposal.targetPath,
    kind: null as WorkspaceResourceKind | null,
    resourceId: null as string | null,
  };

  if (proposal.targetType === "personal-memory") {
    const targetPath = personalMemoryTargetPath(proposal);
    const existing = await resourceGetByPath(proposal.ownerEmail, targetPath);
    currentContent = existing?.content ?? null;
    targetExists = Boolean(existing);
    operation = targetExists ? "update" : "create";
    target = { ...target, path: targetPath };
  } else if (proposal.targetType === "shared-learnings") {
    const existing = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");
    currentContent = existing?.content ?? null;
    targetExists = Boolean(existing);
    operation = "append";
    target = { ...target, path: "LEARNINGS.md" };
  } else if (proposal.targetType.startsWith("workspace-")) {
    const kind = workspaceResourceKindForTarget(proposal.targetType);
    if (!kind) {
      throw new Error(`Unsupported workspace target: ${proposal.targetType}`);
    }
    validateWorkspaceResourcePath(kind, proposal.targetPath);
    const resources = await listWorkspaceResources({ kind });
    const existing = resources.find(
      (resource) => resource.path === proposal.targetPath,
    );
    currentContent = existing?.content ?? null;
    targetExists = Boolean(existing);
    operation = existing ? "update" : "create";
    target = {
      ...target,
      kind,
      resourceId: existing?.id ?? null,
    };
  }

  const approvalPolicy = await getApprovalPolicy();
  const requiresApproval = proposalRequiresApproval(proposal);

  return {
    proposal: serializeProposal(proposal),
    target,
    operation,
    targetExists,
    currentContent,
    proposedContent: proposal.content,
    approval: {
      required: requiresApproval,
      policyEnabled: approvalPolicy.enabled,
      willRequestApproval: requiresApproval && approvalPolicy.enabled,
    },
  };
}

async function requestDreamProposalApproval(proposal: DreamProposalRow) {
  const db = getDb();
  const timestamp = now();
  await db
    .update(schema.dispatchDreamProposals)
    .set({
      status: "approval_requested" satisfies ProposalStatus,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchDreamProposals.id, proposal.id));

  const approval = await createApprovalRequest({
    changeType: "dream-proposal.apply",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Apply dream proposal: ${proposal.title}`,
    payload: { proposalId: proposal.id },
    beforeValue: serializeProposal(proposal),
    afterValue: {
      ...serializeProposal(proposal),
      status: "applied" satisfies ProposalStatus,
    },
  });

  await recordAudit({
    action: "dream.proposal.approval-requested",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Requested approval for dream proposal: ${proposal.title}`,
    metadata: {
      dreamId: proposal.dreamId,
      approvalId: approval?.id ?? null,
      targetType: proposal.targetType,
      targetPath: proposal.targetPath,
    },
  });

  return {
    proposal: serializeProposal((await getProposalRow(proposal.id))!),
    approval,
    result: {
      approvalRequired: true,
      approvalId: approval?.id ?? null,
    },
  };
}

async function applyDreamProposalDirect(
  proposal: DreamProposalRow,
  actor = currentOwnerEmail(),
) {
  const db = getDb();
  let result: unknown;
  if (proposal.targetType === "personal-memory") {
    result = await savePersonalMemory(proposal);
  } else if (proposal.targetType === "shared-learnings") {
    result = await appendSharedLearning(proposal);
  } else if (proposal.targetType.startsWith("workspace-")) {
    result = await applyWorkspaceResourceProposal(proposal);
  } else {
    throw new Error(
      `Unsupported dream proposal target: ${proposal.targetType}`,
    );
  }

  const timestamp = now();
  await db
    .update(schema.dispatchDreamProposals)
    .set({
      status: "applied" satisfies ProposalStatus,
      appliedBy: actor,
      appliedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchDreamProposals.id, proposal.id));

  await recordAudit({
    action: "dream.proposal.applied",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Applied dream proposal: ${proposal.title}`,
    actor,
    metadata: {
      dreamId: proposal.dreamId,
      targetType: proposal.targetType,
      targetPath: proposal.targetPath,
      result,
    },
  });

  return {
    proposal: serializeProposal((await getProposalRow(proposal.id))!),
    result,
  };
}

export async function applyApprovedDreamProposal(
  proposalId: string,
  actor = currentOwnerEmail(),
  ctx: DispatchCtx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() },
) {
  const proposal = await getProposalRow(proposalId, ctx);
  if (!proposal) throw new Error("Dream proposal not found");
  if (!["pending", "approval_requested"].includes(proposal.status)) {
    throw new Error("Only pending dream proposals can be applied");
  }
  return applyDreamProposalDirect(proposal, actor);
}

export async function applyDreamProposal(proposalId: string) {
  const proposal = await getProposalRow(proposalId);
  if (!proposal) throw new Error("Dream proposal not found");
  if (proposal.status === "approval_requested") {
    throw new Error("Dream proposal is already waiting for approval");
  }
  if (proposal.status !== "pending") {
    throw new Error("Only pending dream proposals can be applied");
  }

  if (proposalRequiresApproval(proposal)) {
    const policy = await getApprovalPolicy();
    if (policy.enabled) {
      return requestDreamProposalApproval(proposal);
    }
  }

  return applyDreamProposalDirect(proposal);
}

export async function rejectDreamProposal(
  proposalId: string,
  reason?: string | null,
) {
  const db = getDb();
  const proposal = await getProposalRow(proposalId);
  if (!proposal) throw new Error("Dream proposal not found");
  if (!["pending", "approval_requested"].includes(proposal.status)) {
    throw new Error("Only pending dream proposals can be rejected");
  }
  const timestamp = now();
  await db
    .update(schema.dispatchDreamProposals)
    .set({
      status: "rejected" satisfies ProposalStatus,
      rejectedBy: currentOwnerEmail(),
      rejectedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchDreamProposals.id, proposal.id));

  await recordAudit({
    action: "dream.proposal.rejected",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Rejected dream proposal: ${proposal.title}`,
    metadata: {
      dreamId: proposal.dreamId,
      reason: reason || null,
    },
  });

  return serializeProposal((await getProposalRow(proposal.id))!);
}

function cronLooksValid(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part) => /^[\d*/,\-]+$/.test(part));
}

function dreamJobBody(settings: Omit<DreamSettings, "scope" | "scopeId">) {
  const queryLine = settings.query
    ? `- Use query "${settings.query}" to focus the dream pass.`
    : "- Review recent threads without a search query.";
  const sourceLine =
    settings.sourceIds.length > 0
      ? `- sourceIds: ${JSON.stringify(settings.sourceIds)}`
      : `- sourceId: "${settings.sourceId}"`;
  return `# Dispatch Dream

Run a safe Dispatch dreaming pass.

1. Call \`list-dream-candidates\` with:
   ${sourceLine}
   - allSources: ${settings.allSources}
   ${queryLine}
   - ownerEmail: "*"
   - limit: ${settings.limit}
   - sourceTimeoutMs: ${settings.sourceTimeoutMs}
   - sourceConcurrency: ${settings.sourceConcurrency}
   - sourceStartStaggerMs: ${settings.sourceStartStaggerMs}
   - threadConcurrency: ${settings.threadConcurrency}
   - threadTimeoutMs: ${settings.threadTimeoutMs}
2. If fewer than ${settings.minCandidateCount} candidate thread(s) are found, stop without creating a report.
3. Call \`create-dream-report\` with the same source/query/limit/timeout settings.
4. Review the returned proposals and evidence.
5. Do not auto-apply shared/team changes, workspace instructions, workspace skills, AGENTS.md changes, or jobs.
6. Only apply personal-memory proposals when the evidence is explicit user-grounded correction or a remember request.
7. Leave all other proposals pending for a human to review.
`;
}

export async function ensureDreamJob(input: {
  schedule?: string;
  sourceId?: string;
  sourceIds?: string[];
  allSources?: boolean;
  query?: string;
  limit?: number;
  sourceTimeoutMs?: number;
  sourceConcurrency?: number;
  sourceStartStaggerMs?: number;
  threadConcurrency?: number;
  threadTimeoutMs?: number;
  minCandidateCount?: number;
}) {
  const saved = await getDreamSettings();
  const settings = normalizeDreamSettings({
    ...saved,
    ...input,
    query:
      input.query === undefined
        ? saved.query
        : input.query?.trim()
          ? input.query.trim()
          : null,
    sourceIds:
      input.sourceIds !== undefined
        ? normalizeSourceIds(input.sourceIds)
        : saved.sourceIds,
  });
  const schedule = input.schedule?.trim() || settings.schedule;
  if (!cronLooksValid(schedule)) {
    throw new Error(
      'Invalid cron expression. Use a standard five-field cron like "0 9 * * 1".',
    );
  }
  const owner = currentOwnerEmail();
  const orgId = currentOrgId();
  const jobSettings = { ...settings, schedule, enabled: true };
  const content = [
    "---",
    `schedule: "${schedule}"`,
    "enabled: true",
    `createdBy: ${owner}`,
    ...(orgId ? [`orgId: ${orgId}`] : []),
    "runAs: creator",
    "---",
    "",
    dreamJobBody(jobSettings),
  ].join("\n");

  const resource = await resourcePut(
    owner,
    DREAM_JOB_PATH,
    content,
    "text/markdown",
    {
      createdBy: "agent",
      metadata: jobSettings,
    },
  );

  await setDreamSettings(jobSettings);
  await recordAudit({
    action: "dream.job.ensured",
    targetType: "job",
    targetId: DREAM_JOB_PATH,
    summary: "Ensured weekly Dispatch dream recurring job",
    metadata: jobSettings,
  });

  return {
    path: resource.path,
    owner: resource.owner,
    schedule,
    enabled: true,
    runAs: "creator",
    sourceId: jobSettings.sourceId,
    sourceIds: jobSettings.sourceIds,
    allSources: jobSettings.allSources,
    query: jobSettings.query,
    limit: jobSettings.limit,
    sourceTimeoutMs: jobSettings.sourceTimeoutMs,
    sourceConcurrency: jobSettings.sourceConcurrency,
    sourceStartStaggerMs: jobSettings.sourceStartStaggerMs,
    threadConcurrency: jobSettings.threadConcurrency,
    threadTimeoutMs: jobSettings.threadTimeoutMs,
    minCandidateCount: jobSettings.minCandidateCount,
  };
}
