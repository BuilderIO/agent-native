import { fail } from "@agent-native/core/action";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  AI_FILTER_BACKFILL_MAX_RULES,
  AI_FILTER_BACKFILL_MAX_THREADS,
  AI_FILTER_BACKFILL_WINDOW_DAYS,
  type AiFilterBackfillPreview,
  type AiFilterBackfillRuleProgress,
  type AiFilterBackfillStatus,
} from "../../shared/ai-filter-backfill.js";
import {
  AI_FILTER_LABEL,
  AI_FILTER_MIN_LEARNED_EXAMPLES,
  AI_FILTER_RULE_NAME,
  type AiFilterPreviewEmail,
  type AiFilterPreviewRule,
  type AiFilterDecision,
  type AiFilterState,
  createDefaultAiFilterState,
} from "../../shared/ai-filter.js";
import { aiPriorityEmailKey } from "../../shared/ai-priority.js";
import { automationActionSchema } from "../../shared/automation-schema.js";
import { mailLabelsInclude } from "../../shared/gmail-labels.js";
import type { AutomationAction, EmailMessage } from "../../shared/types.js";
import { db, schema } from "../db/index.js";
import { getAiFilterState, recordAiFilterDecisions } from "./ai-filter.js";
import { buildLabelCache, ensureGmailLabel } from "./automation-actions.js";
import {
  evaluateAiFilterBackfillRules,
  type RuleMatch,
} from "./automation-engine.js";
import { assertMailJevEnabled, listAutomationRules } from "./automations.js";
import {
  gmailBatchGetThreads,
  gmailGetThread,
  gmailListThreads,
  gmailModifyMessage,
  gmailModifyThread,
} from "./google-api.js";
import { getClientsWithErrors } from "./google-auth.js";
import { syncInboxLabelDelta } from "./inbox-store-sync.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";

const RUN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const UNDO_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const CLAIM_LIFETIME_MS = 5 * 60 * 1_000;
const CLAIM_HEARTBEAT_MS = CLAIM_LIFETIME_MS / 3;
const THREADS_PER_TICK = 10;
const MAX_RUNS_PER_TICK = 2;
const METADATA_HEADERS = ["From", "To", "Subject", "Date"];
const SYSTEM_LABEL_IDS: Record<string, string> = {
  INBOX: "inbox",
  STARRED: "starred",
  SENT: "sent",
  DRAFT: "drafts",
  TRASH: "trash",
  IMPORTANT: "important",
  CATEGORY_PERSONAL: "personal",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_FORUMS: "forums",
};

type BackfillCandidate = {
  key: string;
  accountEmail?: string;
  threadId: string;
  email: AiFilterPreviewEmail;
  messageIds: string[];
};

type StoredMatch = Pick<RuleMatch, "ruleId" | "confidence" | "reason">;
type BackfillAiFilterSettings = Pick<
  AiFilterState,
  "autoFilter" | "autoFilterThreshold" | "suggestionThreshold" | "feedback"
>;

type UndoMessageSnapshot = {
  id: string;
  labels: Record<string, boolean>;
  afterLabels?: Record<string, boolean>;
  archived?: boolean;
  afterArchived?: boolean;
};

type UndoThreadSnapshot = {
  key: string;
  accountEmail?: string;
  threadId: string;
  local: boolean;
  messages: UndoMessageSnapshot[];
};

type BackfillState = {
  version: 1;
  aiFilterSettings: BackfillAiFilterSettings;
  rules: AiFilterPreviewRule[];
  ruleUpdatedAt: Record<string, string>;
  candidates: BackfillCandidate[];
  candidateIndex: number;
  evaluations: Record<string, StoredMatch[]>;
  processedIds: string[];
  seenMatchIds: string[];
  pendingDecisions: AiFilterDecision[];
  failedKeys: string[];
  undoProcessedIds: string[];
  undoFailedKeys: string[];
  snapshots: Record<string, UndoThreadSnapshot>;
  matchedThreadKeys: string[];
  appliedThreadKeys: string[];
  processedThreads: number;
  restoredThreads: number;
  perRule: AiFilterBackfillRuleProgress[];
  error?: string;
};

type BackfillRow = typeof schema.aiFilterBackfills.$inferSelect;
type BackfillStatus = AiFilterBackfillStatus["status"];
type ClaimedBackfillStatus = Extract<BackfillStatus, "running" | "undoing">;
type ClaimedBackfill = {
  claimId: string;
  status: ClaimedBackfillStatus;
  stateJson: string;
};
const ACTIVE_BACKFILL_STATUSES = ["queued", "running", "undoing"] as const;

export function planConditionalUndo(
  before: Record<string, boolean>,
  after: Record<string, boolean> | undefined,
  current: Record<string, boolean>,
): { changes: Record<string, boolean>; conflicts: string[] } {
  const changes: Record<string, boolean> = {};
  const conflicts: string[] = [];
  for (const [field, value] of Object.entries(before)) {
    if (
      !after ||
      !Object.prototype.hasOwnProperty.call(after, field) ||
      !Object.prototype.hasOwnProperty.call(current, field) ||
      current[field] !== after[field]
    ) {
      conflicts.push(field);
    } else {
      changes[field] = value;
    }
  }
  return { changes, conflicts };
}

export function originalSnapshotValue<T>(saved: T | undefined, current: T): T {
  return saved ?? current;
}

export function missingSnapshotMessageIds(
  savedIds: string[],
  currentIds: ReadonlySet<string>,
): string[] {
  return savedIds.filter((id) => !currentIds.has(id));
}

export function canonicalAiFilterBackfillRuleSetKey(ruleIds: string[]): string {
  return JSON.stringify([...ruleIds].sort());
}

function ruleIdsForBackfillRow(row: BackfillRow): string[] {
  if (row.ruleSetKey) {
    const ruleIds: unknown = JSON.parse(row.ruleSetKey);
    if (Array.isArray(ruleIds) && ruleIds.every((id) => typeof id === "string"))
      return ruleIds;
    if (
      Array.isArray(ruleIds) &&
      ruleIds.every(
        (rule) =>
          Array.isArray(rule) &&
          typeof rule[0] === "string" &&
          typeof rule[1] === "string",
      )
    )
      return ruleIds.map(([id]) => id);
    throw new Error(
      "An active Mail AI-filter backfill has an invalid rule set.",
    );
  }
  return parseState(row.stateJson).rules.map((rule) => rule.id);
}

function versionedRuleSetKey(
  rules: Array<{ id: string; updatedAt: string }>,
): string {
  return JSON.stringify(
    rules
      .map(({ id, updatedAt }) => [id, updatedAt] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function ruleIdsOverlap(row: BackfillRow, ruleIds: Set<string>): boolean {
  return ruleIdsForBackfillRow(row).some((ruleId) => ruleIds.has(ruleId));
}

function backfillOwnerLock(tx: any, ownerEmail: string) {
  return tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail:ai-filter-backfill:${ownerEmail.trim().toLowerCase()}`}, 0::bigint))`,
  );
}

function rejectActiveBackfill(): never {
  fail("A Mail AI-filter backfill for these rules is already active.", {
    errorCode: "ai_filter_backfill_active",
    statusCode: 409,
  });
}

function emptyState(
  rules: AiFilterPreviewRule[],
  ruleUpdatedAt: Record<string, string>,
  aiFilterSettings: BackfillAiFilterSettings,
): BackfillState {
  return {
    version: 1,
    aiFilterSettings,
    rules,
    ruleUpdatedAt,
    candidates: [],
    candidateIndex: 0,
    evaluations: {},
    processedIds: [],
    seenMatchIds: [],
    pendingDecisions: [],
    failedKeys: [],
    undoProcessedIds: [],
    undoFailedKeys: [],
    snapshots: {},
    matchedThreadKeys: [],
    appliedThreadKeys: [],
    processedThreads: 0,
    restoredThreads: 0,
    perRule: rules.map((rule) => ({
      ruleId: rule.id,
      name: rule.name,
      matchedCount: 0,
      appliedCount: 0,
      suggestedCount: 0,
      previews: [],
    })),
  };
}

function parseState(raw: string): BackfillState {
  const state = JSON.parse(raw) as BackfillState;
  if (
    state.version !== 1 ||
    !state.aiFilterSettings ||
    typeof state.aiFilterSettings.autoFilter !== "boolean" ||
    !Number.isFinite(state.aiFilterSettings.autoFilterThreshold) ||
    !Number.isFinite(state.aiFilterSettings.suggestionThreshold) ||
    !Array.isArray(state.aiFilterSettings.feedback) ||
    !Array.isArray(state.rules) ||
    !Array.isArray(state.candidates) ||
    !Array.isArray(state.processedIds) ||
    !Array.isArray(state.seenMatchIds) ||
    !Array.isArray(state.pendingDecisions) ||
    !Array.isArray(state.perRule) ||
    !Array.isArray(state.undoProcessedIds) ||
    !Array.isArray(state.undoFailedKeys) ||
    !state.snapshots ||
    typeof state.snapshots !== "object"
  ) {
    throw new Error("Mail AI backfill progress is unreadable.");
  }
  return state;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(access_token|refresh_token|id_token|token)=([^\s&]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}

function resultStatus(
  row: BackfillRow,
  state: BackfillState,
): AiFilterBackfillStatus {
  return {
    runId: row.id,
    status: row.status as BackfillStatus,
    totalThreads: state.candidates.length,
    processedThreads: state.processedThreads,
    matchedThreads: state.matchedThreadKeys.length,
    appliedThreads: state.appliedThreadKeys.length,
    failedThreads: state.failedKeys.length,
    ...(row.status === "undone" || row.status === "failed"
      ? { restoredThreads: state.restoredThreads }
      : {}),
    ...(row.status === "undone" || row.status === "failed"
      ? { undoFailures: state.undoFailedKeys.length }
      : {}),
    perRule: state.perRule,
    ...(row.status !== "undone" &&
    row.undoToken &&
    (row.undoExpiresAt ?? 0) > Date.now()
      ? { undoToken: row.undoToken }
      : {}),
    ...(state.error ? { error: state.error } : {}),
  };
}

function assertUniqueRuleIds(ruleIds?: string[]): void {
  if (ruleIds && new Set(ruleIds).size !== ruleIds.length) {
    fail("Rule ids must be unique.", {
      errorCode: "duplicate_rule_ids",
      statusCode: 400,
    });
  }
}

export async function startMailAiFilterBackfill(
  ownerEmail: string,
  ruleIds?: string[],
): Promise<{ runId: string; status: "queued" }> {
  assertUniqueRuleIds(ruleIds);
  await assertMailJevEnabled(ownerEmail);
  const aiFilterState = await getAiFilterState(ownerEmail);
  if (!aiFilterState.enabled) {
    fail("Mail AI filtering is disabled. Enable it before applying rules.", {
      errorCode: "ai_filter_disabled",
      statusCode: 409,
    });
  }

  const rules = (await listAutomationRules(ownerEmail)).filter(
    (rule) =>
      rule.domain === "mail" && rule.kind === "ai-filter" && rule.enabled,
  );
  if (ruleIds === undefined && rules.length > AI_FILTER_BACKFILL_MAX_RULES) {
    fail(
      `Mail AI backfills can apply at most ${AI_FILTER_BACKFILL_MAX_RULES} enabled rules at once.`,
      {
        errorCode: "too_many_ai_filter_rules",
        statusCode: 400,
      },
    );
  }
  const requestedIds = ruleIds ?? rules.map((rule) => rule.id);
  const requestedSet = new Set(requestedIds);
  const selected = rules.filter((rule) => requestedSet.has(rule.id));
  if (selected.length !== requestedIds.length || selected.length === 0) {
    fail("Select one or more enabled Mail AI-filter rules.", {
      errorCode: "ai_filter_rules_not_found",
      statusCode: 404,
    });
  }
  const eligible = selected.filter(
    (rule) =>
      rule.name !== AI_FILTER_RULE_NAME ||
      aiFilterState.feedback.length >= AI_FILTER_MIN_LEARNED_EXAMPLES,
  );
  if (eligible.length === 0) {
    fail(
      "The learned unwanted-mail rule needs three confirmed examples first.",
      {
        errorCode: "insufficient_feedback_examples",
        statusCode: 409,
      },
    );
  }

  const validatedRules = eligible.map((rule) => {
    const parsed = automationActionSchema.array().safeParse(rule.actions);
    if (!parsed.success) {
      fail(
        `AI rule "${rule.name}" has invalid actions. Edit it in Mail settings.`,
        {
          errorCode: "invalid_ai_filter_actions",
          statusCode: 400,
        },
      );
    }
    if (
      parsed.data.some(
        (action) => action.type !== "label" && action.type !== "archive",
      )
    ) {
      fail(
        `AI rule "${rule.name}" can only add labels or archive conversations.`,
        {
          errorCode: "invalid_ai_filter_actions",
          statusCode: 400,
        },
      );
    }
    return { rule, actions: parsed.data };
  });

  const ruleSetKey = versionedRuleSetKey(
    validatedRules.map(({ rule }) => rule),
  );
  const id = nanoid(16);
  const undoToken = nanoid(32);
  const now = Date.now();
  const state = emptyState(
    validatedRules.map(({ rule, actions }) => ({
      id: rule.id,
      name: rule.name,
      condition: rule.condition,
      actions,
    })),
    Object.fromEntries(
      validatedRules.map(({ rule }) => [rule.id, rule.updatedAt]),
    ),
    {
      autoFilter: aiFilterState.autoFilter,
      autoFilterThreshold: aiFilterState.autoFilterThreshold,
      suggestionThreshold: aiFilterState.suggestionThreshold,
      feedback: aiFilterState.feedback.slice(-20),
    },
  );
  const [inserted] = await db.transaction(async (tx: any) => {
    await backfillOwnerLock(tx, ownerEmail);
    const activeRows = await tx
      .select()
      .from(schema.aiFilterBackfills)
      .where(
        and(
          eq(schema.aiFilterBackfills.ownerEmail, ownerEmail),
          gt(schema.aiFilterBackfills.expiresAt, now),
          inArray(schema.aiFilterBackfills.status, ACTIVE_BACKFILL_STATUSES),
        ),
      );
    const requestedVersions = Object.fromEntries(
      validatedRules.map(({ rule }) => [rule.id, rule.updatedAt]),
    );
    const requested = new Set(Object.keys(requestedVersions));
    const activeOverlaps = (activeRows as BackfillRow[]).filter((row) =>
      ruleIdsOverlap(row, requested),
    );
    const hasSameVersionOverlap = activeOverlaps.some((row) => {
      const overlap = ruleIdsForBackfillRow(row).filter((id) =>
        requested.has(id),
      );
      const previousVersions = parseState(row.stateJson).ruleUpdatedAt ?? {};
      return overlap.some(
        (id) =>
          previousVersions[id] === undefined ||
          previousVersions[id] === requestedVersions[id],
      );
    });
    if (hasSameVersionOverlap) {
      rejectActiveBackfill();
    }
    return tx
      .insert(schema.aiFilterBackfills)
      .values({
        id,
        ownerEmail,
        ruleSetKey,
        status: "queued",
        stateJson: JSON.stringify(state),
        undoToken,
        undoExpiresAt: now + UNDO_LIFETIME_MS,
        expiresAt: now + RUN_LIFETIME_MS,
        claimId: null,
        claimedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.aiFilterBackfills.id });
  });
  if (!inserted) {
    fail("Could not start the Mail AI backfill. Try again.", {
      errorCode: "ai_filter_backfill_start_conflict",
      statusCode: 409,
    });
  }
  return { runId: id, status: "queued" };
}

export async function readMailAiFilterBackfill(
  ownerEmail: string,
  runId: string,
): Promise<AiFilterBackfillStatus> {
  const [row] = await db
    .select()
    .from(schema.aiFilterBackfills)
    .where(
      and(
        eq(schema.aiFilterBackfills.id, runId),
        eq(schema.aiFilterBackfills.ownerEmail, ownerEmail),
      ),
    );
  if (!row) {
    fail("Mail AI backfill run not found.", {
      errorCode: "backfill_not_found",
      statusCode: 404,
    });
  }
  return resultStatus(row, parseState(row.stateJson));
}

export async function listRecentMailAiFilterBackfills(
  ownerEmail: string,
): Promise<AiFilterBackfillStatus[]> {
  const rows = await db
    .select()
    .from(schema.aiFilterBackfills)
    .where(
      and(
        eq(schema.aiFilterBackfills.ownerEmail, ownerEmail),
        gt(schema.aiFilterBackfills.expiresAt, Date.now()),
      ),
    )
    .orderBy(desc(schema.aiFilterBackfills.updatedAt))
    .limit(20);
  return rows.map((row: BackfillRow) =>
    resultStatus(row, parseState(row.stateJson)),
  );
}

export async function requestMailAiFilterBackfillUndo(
  ownerEmail: string,
  runId: string,
  undoToken: string,
): Promise<{ runId: string; status: "undoing" }> {
  const now = Date.now();
  await db.transaction(async (tx: any) => {
    await backfillOwnerLock(tx, ownerEmail);
    const [row] = await tx
      .select()
      .from(schema.aiFilterBackfills)
      .where(
        and(
          eq(schema.aiFilterBackfills.id, runId),
          eq(schema.aiFilterBackfills.ownerEmail, ownerEmail),
          gt(schema.aiFilterBackfills.undoExpiresAt, now),
        ),
      )
      .for("update");
    if (!row || row.undoToken !== undoToken) {
      fail("This Mail AI backfill undo token is invalid or expired.", {
        errorCode: "backfill_undo_expired",
        statusCode: 410,
      });
    }
    if (row.status === "undone") {
      fail("This Mail AI backfill has already been undone.", {
        errorCode: "backfill_already_undone",
        statusCode: 409,
      });
    }
    if (row.status === "undoing") return;

    const state = parseState(row.stateJson);
    state.undoFailedKeys = [];
    delete state.error;
    await tx
      .update(schema.aiFilterBackfills)
      .set({
        status: "undoing",
        stateJson: JSON.stringify(state),
        updatedAt: now,
      })
      .where(eq(schema.aiFilterBackfills.id, runId));
  });
  return { runId, status: "undoing" };
}

function headerValue(message: any, name: string): string {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) return "";
  return (
    headers.find(
      (header: any) =>
        typeof header?.name === "string" &&
        header.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function latestMessage(messages: any[]): any | undefined {
  return [...messages].sort(
    (a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0),
  )[0];
}

export function latestGmailInboxMessage(messages: any[]): any | undefined {
  return latestMessage(
    messages.filter(
      (message) =>
        Array.isArray(message?.labelIds) && message.labelIds.includes("INBOX"),
    ),
  );
}

function localFrom(message: EmailMessage): string {
  return [message.from.name, message.from.email]
    .filter(Boolean)
    .join(" ")
    .slice(0, 320);
}

export function latestLocalInboxMessage(
  messages: EmailMessage[],
): EmailMessage | undefined {
  return [...messages]
    .filter(
      (message) =>
        !message.isArchived &&
        !message.isTrashed &&
        !message.isDraft &&
        !message.isSent,
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
}

function gmailLabelIds(messages: any[]): string[] {
  return [
    ...new Set(
      messages.flatMap((message: any) =>
        Array.isArray(message?.labelIds)
          ? message.labelIds.filter(
              (labelId: unknown): labelId is string =>
                typeof labelId === "string",
            )
          : [],
      ),
    ),
  ];
}

function candidateFromLocalThread(messages: EmailMessage[]): BackfillCandidate {
  const latest = latestLocalInboxMessage(messages);
  if (!latest) throw new Error("The local conversation has no Inbox message.");
  const threadId = latest.threadId || latest.id;
  const labelIds = [
    ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
  ];
  return {
    key: `local:${threadId}`,
    threadId,
    email: {
      id: threadId,
      threadId,
      from: localFrom(latest),
      to: latest.to
        .map((address) => address.email)
        .join(", ")
        .slice(0, 320),
      subject: latest.subject.slice(0, 500),
      snippet: latest.snippet.slice(0, 320),
      labelIds: labelIds.slice(0, 64),
      date: latest.date,
      isArchived: messages.every((message) => message.isArchived),
      isTrashed: messages.some((message) => message.isTrashed),
    },
    messageIds: messages.map((message) => message.id),
  };
}

export function hasLocalInboxMessage(
  messages: Pick<
    EmailMessage,
    "isArchived" | "isTrashed" | "isDraft" | "isSent"
  >[],
): boolean {
  return messages.some(
    (message) =>
      !message.isArchived &&
      !message.isTrashed &&
      !message.isDraft &&
      !message.isSent,
  );
}

async function captureLocalCandidates(
  ownerEmail: string,
): Promise<BackfillCandidate[]> {
  const emails = await readLocalEmails(ownerEmail);
  const cutoff =
    Date.now() - AI_FILTER_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const threads = new Map<string, EmailMessage[]>();
  for (const email of emails) {
    if (email.isArchived || email.isTrashed || email.isDraft) continue;
    const threadId = email.threadId || email.id;
    const values = threads.get(threadId) ?? [];
    values.push(email);
    threads.set(threadId, values);
  }
  return [...threads.values()]
    .filter(hasLocalInboxMessage)
    .map(candidateFromLocalThread)
    .filter(
      (candidate) =>
        !candidate.email.isArchived &&
        !candidate.email.isTrashed &&
        new Date(candidate.email.date).getTime() >= cutoff,
    )
    .sort(
      (a, b) =>
        new Date(b.email.date).getTime() - new Date(a.email.date).getTime(),
    )
    .slice(0, AI_FILTER_BACKFILL_MAX_THREADS);
}

async function captureGmailCandidates(
  clients: Array<{ email: string; accessToken: string }>,
): Promise<BackfillCandidate[]> {
  const listedByAccount = await Promise.all(
    clients.map(async (client) => {
      const response = await gmailListThreads(client.accessToken, {
        q: `in:inbox newer_than:${AI_FILTER_BACKFILL_WINDOW_DAYS}d`,
        maxResults: AI_FILTER_BACKFILL_MAX_THREADS,
      });
      const threads = Array.isArray(response.threads) ? response.threads : [];
      return threads.map((thread: any) => ({
        accountEmail: client.email,
        accessToken: client.accessToken,
        threadId: String(thread.id ?? ""),
      }));
    }),
  );
  const cutoff =
    Date.now() - AI_FILTER_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const all = listedByAccount.flat().filter((item) => item.threadId);
  const fetched: BackfillCandidate[] = [];
  for (const client of clients) {
    const ids = all
      .filter((item) => item.accountEmail === client.email)
      .map((item) => item.threadId);
    for (let offset = 0; offset < ids.length; offset += 10) {
      const batch = await gmailBatchGetThreads(
        client.accessToken,
        ids.slice(offset, offset + 10),
        "metadata",
        METADATA_HEADERS,
      );
      for (const result of batch) {
        if (result.error || !result.data) {
          throw new Error(
            result.error || "Gmail did not return thread metadata.",
          );
        }
        const messages = Array.isArray(result.data.messages)
          ? result.data.messages
          : [];
        if (
          messages.length === 0 ||
          !messages.some((message: any) =>
            (message.labelIds ?? []).includes("INBOX"),
          )
        ) {
          continue;
        }
        const latest = latestGmailInboxMessage(messages);
        if (!latest) continue;
        const date = latest?.internalDate
          ? new Date(Number(latest.internalDate)).toISOString()
          : headerValue(latest, "Date");
        if (
          !Number.isFinite(new Date(date).getTime()) ||
          new Date(date).getTime() < cutoff
        ) {
          continue;
        }
        const labelIds = gmailLabelIds(messages);
        const threadId = String(result.data.id ?? result.id);
        if (labelIds.includes("TRASH")) continue;
        fetched.push({
          key: `${client.email.toLowerCase()}:${threadId}`,
          accountEmail: client.email,
          threadId,
          email: {
            id: threadId,
            threadId,
            accountEmail: client.email,
            from: headerValue(latest, "From").slice(0, 320),
            to: headerValue(latest, "To").slice(0, 320),
            subject: headerValue(latest, "Subject").slice(0, 500),
            snippet: String(latest.snippet ?? "").slice(0, 320),
            labelIds: labelIds.slice(0, 64),
            date,
            isArchived: false,
            isTrashed: messages.some((message: any) =>
              (message.labelIds ?? []).includes("TRASH"),
            ),
          },
          messageIds: messages
            .map((message: any) => String(message.id))
            .filter(Boolean),
        });
      }
    }
  }
  return fetched
    .sort(
      (a, b) =>
        new Date(b.email.date).getTime() - new Date(a.email.date).getTime(),
    )
    .slice(0, AI_FILTER_BACKFILL_MAX_THREADS);
}

async function captureCandidates(
  ownerEmail: string,
): Promise<BackfillCandidate[]> {
  const { clients, errors } = await getClientsWithErrors(ownerEmail);
  if (errors.length > 0) {
    throw new Error(
      errors.map((error) => `${error.email}: ${error.error}`).join("; "),
    );
  }
  return clients.length > 0
    ? captureGmailCandidates(clients)
    : captureLocalCandidates(ownerEmail);
}

function resultKey(candidate: BackfillCandidate, ruleId: string): string {
  return `${candidate.key}:${ruleId}`;
}

function addPreview(
  ruleProgress: AiFilterBackfillRuleProgress,
  preview: AiFilterBackfillPreview,
): void {
  if (ruleProgress.previews.some((current) => current.id === preview.id))
    return;
  if (ruleProgress.previews.length < 5) ruleProgress.previews.push(preview);
}

function actionLabels(actions: AutomationAction[]): string[] {
  return actions
    .filter(
      (action): action is Extract<AutomationAction, { type: "label" }> =>
        action.type === "label",
    )
    .map((action) => action.labelName);
}

function normalizeLocalLabel(label: string): string {
  return label.trim().toLowerCase().replace(/_/g, " ");
}

type CurrentBackfillRule = {
  id: string;
  enabled: boolean;
  domain: string;
  kind?: string;
  updatedAt: string;
};

export function isCurrentAiFilterBackfillRule(
  ruleId: string,
  updatedAt: string | undefined,
  rules: CurrentBackfillRule[],
): boolean {
  const current = rules.find((rule) => rule.id === ruleId);
  return !!(
    current &&
    current.enabled &&
    current.domain === "mail" &&
    current.kind === "ai-filter" &&
    current.updatedAt === updatedAt
  );
}

async function assertCurrentAiFilterBackfillRule(
  ownerEmail: string,
  ruleId: string,
  updatedAt: string | undefined,
): Promise<void> {
  const rules = await listAutomationRules(ownerEmail, ruleId);
  if (!isCurrentAiFilterBackfillRule(ruleId, updatedAt, rules)) {
    throw new Error(
      "An AI-filter rule changed during this backfill. Start a new run to apply the current rule.",
    );
  }
}

async function localLabelId(ownerEmail: string, name: string): Promise<string> {
  const stored = await (
    await import("@agent-native/core/settings")
  ).getUserSetting(ownerEmail, "labels");
  const labels = Array.isArray((stored as any)?.labels)
    ? (stored as any).labels
    : [];
  const existing = labels.find(
    (label: any) =>
      typeof label?.id === "string" &&
      typeof label?.name === "string" &&
      normalizeLocalLabel(label.name) === normalizeLocalLabel(name),
  );
  if (existing) return existing.id;
  const id = normalizeLocalLabel(name);
  const { mutateUserSetting } = await import("@agent-native/core/settings");
  await mutateUserSetting(ownerEmail, "labels", (current) => {
    const currentLabels = Array.isArray(current?.labels) ? current.labels : [];
    if (
      currentLabels.some(
        (label: any) =>
          typeof label?.name === "string" &&
          normalizeLocalLabel(label.name) === normalizeLocalLabel(name),
      )
    ) {
      return { labels: currentLabels };
    }
    return {
      labels: [...currentLabels, { id, name, type: "user" }],
    };
  });
  return id;
}

function localPreview(
  candidate: BackfillCandidate,
  emails: EmailMessage[],
): AiFilterBackfillPreview {
  const thread = emails.filter(
    (email) => (email.threadId || email.id) === candidate.threadId,
  );
  const latest = [...thread].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0];
  return {
    id: candidate.threadId,
    from: latest ? localFrom(latest) : candidate.email.from,
    subject: (latest?.subject ?? candidate.email.subject).slice(0, 500),
    labels: [...new Set(thread.flatMap((email) => email.labelIds ?? []))].slice(
      0,
      64,
    ),
    archived: thread.length > 0 && thread.every((email) => email.isArchived),
  };
}

function localSnapshotForActions(
  candidate: BackfillCandidate,
  emails: EmailMessage[],
  touchedLabelIds: string[],
  touchesArchive: boolean,
  existing?: UndoThreadSnapshot,
): UndoThreadSnapshot {
  const thread = emails.filter(
    (email) => (email.threadId || email.id) === candidate.threadId,
  );
  const byId = new Map(
    existing?.messages.map((message) => [message.id, message]) ?? [],
  );
  for (const email of thread) {
    const current = byId.get(email.id) ?? { id: email.id, labels: {} };
    const labels = { ...current.labels };
    for (const labelId of touchedLabelIds) {
      if (!(labelId in labels))
        labels[labelId] = (email.labelIds ?? []).includes(labelId);
    }
    const archived = touchesArchive
      ? originalSnapshotValue(current.archived, email.isArchived)
      : current.archived;
    byId.set(email.id, {
      ...current,
      labels,
      ...(archived !== undefined ? { archived } : {}),
    });
  }
  return {
    key: candidate.key,
    threadId: candidate.threadId,
    local: true,
    messages: [...byId.values()],
  };
}

function captureLocalPostApplyState(
  snapshot: UndoThreadSnapshot,
  emails: EmailMessage[],
): UndoThreadSnapshot {
  const emailsById = new Map(emails.map((email) => [email.id, email]));
  return {
    ...snapshot,
    messages: snapshot.messages.map((saved) => {
      const email = emailsById.get(saved.id);
      if (!email)
        throw new Error("The local conversation changed during the backfill.");
      const afterLabels = { ...saved.afterLabels };
      for (const label of Object.keys(saved.labels)) {
        if (!Object.prototype.hasOwnProperty.call(afterLabels, label)) {
          afterLabels[label] = (email.labelIds ?? []).includes(label);
        }
      }
      return {
        ...saved,
        afterLabels,
        ...(saved.archived !== undefined && saved.afterArchived === undefined
          ? { afterArchived: email.isArchived }
          : {}),
      };
    }),
  };
}

async function applyLocalActions(
  ownerEmail: string,
  candidate: BackfillCandidate,
  actions: AutomationAction[],
  existing: UndoThreadSnapshot | undefined,
  beforeMutation: (snapshot: UndoThreadSnapshot) => Promise<boolean>,
): Promise<{ snapshot: UndoThreadSnapshot; preview: AiFilterBackfillPreview }> {
  const names = actionLabels(actions);
  const labelIdByName = new Map<string, string>();
  for (const name of names)
    labelIdByName.set(name, await localLabelId(ownerEmail, name));
  let snapshot: UndoThreadSnapshot | undefined;
  let preview: AiFilterBackfillPreview | undefined;
  await withLocalEmailMutationLock(ownerEmail, async () => {
    const emails = await readLocalEmails(ownerEmail);
    const thread = emails.filter(
      (email) => (email.threadId || email.id) === candidate.threadId,
    );
    if (thread.length === 0)
      throw new Error("The local conversation no longer exists.");
    const touchesArchive = actions.some((action) => action.type === "archive");
    const touchedLabelIds = [
      ...labelIdByName.values(),
      ...(touchesArchive
        ? [
            ...new Set(
              thread
                .flatMap((email) => email.labelIds ?? [])
                .filter((label) => normalizeLocalLabel(label) === "inbox"),
            ),
          ]
        : []),
    ];
    snapshot = localSnapshotForActions(
      candidate,
      emails,
      touchedLabelIds,
      touchesArchive,
      existing,
    );
    if (!(await beforeMutation(snapshot))) {
      throw new Error(
        "The backfill run was interrupted before the mailbox changed.",
      );
    }
    const labelIdsToAdd = new Set(touchedLabelIds);
    const archive = touchesArchive;
    const updated = emails.map((email) => {
      if ((email.threadId || email.id) !== candidate.threadId) return email;
      const labelIds = new Set(email.labelIds ?? []);
      for (const id of labelIdsToAdd) labelIds.add(id);
      if (archive) {
        for (const existingLabel of [...labelIds]) {
          if (normalizeLocalLabel(existingLabel) === "inbox")
            labelIds.delete(existingLabel);
        }
      }
      return {
        ...email,
        isArchived: archive ? true : email.isArchived,
        labelIds: [...labelIds],
      };
    });
    await writeLocalEmails(ownerEmail, updated);
    snapshot = captureLocalPostApplyState(snapshot, updated);
    preview = localPreview(candidate, updated);
  });
  return { snapshot: snapshot!, preview: preview! };
}

function normalizeGmailLabels(
  labelIds: string[],
  labelCache: Map<string, string>,
): string[] {
  const namesById = new Map(
    [...labelCache.entries()].map(([name, id]) => [
      id,
      name.replace(/_/g, " "),
    ]),
  );
  return [...new Set(labelIds)].map(
    (id) => SYSTEM_LABEL_IDS[id] ?? namesById.get(id)?.toLowerCase() ?? id,
  );
}

function gmailThreadPreview(
  candidate: BackfillCandidate,
  thread: any,
  labelCache: Map<string, string>,
): AiFilterBackfillPreview {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latest = latestMessage(messages);
  const labelIds = gmailLabelIds(messages);
  return {
    id: candidate.threadId,
    from: headerValue(latest, "From").slice(0, 320) || candidate.email.from,
    subject: (headerValue(latest, "Subject") || candidate.email.subject).slice(
      0,
      500,
    ),
    labels: normalizeGmailLabels(labelIds, labelCache).slice(0, 64),
    archived:
      messages.length > 0 &&
      messages.every(
        (message: any) => !(message.labelIds ?? []).includes("INBOX"),
      ),
  };
}

async function snapshotGmailThread(
  candidate: BackfillCandidate,
  accessToken: string,
  touchedLabelIds: string[],
  touchesArchive: boolean,
  existing?: UndoThreadSnapshot,
): Promise<{ snapshot: UndoThreadSnapshot; thread: any }> {
  const thread = await gmailGetThread(
    accessToken,
    candidate.threadId,
    "metadata",
    METADATA_HEADERS,
  );
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  if (messages.length === 0)
    throw new Error("Gmail returned an empty conversation.");
  const priorById = new Map(
    existing?.messages.map((message) => [message.id, message]) ?? [],
  );
  const snapshots = messages.map((message: any) => {
    const id = String(message.id ?? "");
    if (!id) throw new Error("Gmail returned a message without an id.");
    const prior = priorById.get(id) ?? { id, labels: {} };
    const current = new Set<string>(message.labelIds ?? []);
    const labels = { ...prior.labels };
    for (const labelId of touchedLabelIds) {
      if (!(labelId in labels)) labels[labelId] = current.has(labelId);
    }
    return {
      ...prior,
      id,
      labels,
      ...(touchesArchive
        ? {
            archived: originalSnapshotValue(
              prior.archived,
              !current.has("INBOX"),
            ),
          }
        : {}),
    };
  });
  return {
    snapshot: {
      key: candidate.key,
      accountEmail: candidate.accountEmail,
      threadId: candidate.threadId,
      local: false,
      messages: snapshots,
    },
    thread,
  };
}

function captureGmailPostApplyState(
  snapshot: UndoThreadSnapshot,
  thread: any,
): UndoThreadSnapshot {
  const messagesById = new Map<string, any>(
    (Array.isArray(thread.messages) ? thread.messages : []).map(
      (message: any) => [String(message.id ?? ""), message],
    ),
  );
  return {
    ...snapshot,
    messages: snapshot.messages.map((saved) => {
      const message = messagesById.get(saved.id);
      if (!message)
        throw new Error("A Gmail message changed during the backfill.");
      const labels = new Set<string>(message.labelIds ?? []);
      const afterLabels = { ...saved.afterLabels };
      for (const label of Object.keys(saved.labels)) {
        if (!Object.prototype.hasOwnProperty.call(afterLabels, label)) {
          afterLabels[label] = labels.has(label);
        }
      }
      return { ...saved, afterLabels };
    }),
  };
}

function captureExpectedGmailMutationState(
  snapshot: UndoThreadSnapshot,
  thread: any,
  addLabelIds: string[],
  removeLabelIds: string[],
): UndoThreadSnapshot {
  const messagesById = new Map<string, any>(
    (Array.isArray(thread.messages) ? thread.messages : []).map(
      (message: any) => [String(message.id ?? ""), message],
    ),
  );
  return {
    ...snapshot,
    messages: snapshot.messages.map((saved) => {
      const message = messagesById.get(saved.id);
      if (!message)
        throw new Error("A Gmail message changed during the backfill.");
      const afterLabels = new Set<string>(message.labelIds ?? []);
      for (const label of addLabelIds) afterLabels.add(label);
      for (const label of removeLabelIds) afterLabels.delete(label);
      return {
        ...saved,
        afterLabels: Object.fromEntries(
          Object.keys(saved.labels).map((label) => [
            label,
            afterLabels.has(label),
          ]),
        ),
        ...(saved.archived === undefined
          ? {}
          : { afterArchived: !afterLabels.has("INBOX") }),
      };
    }),
  };
}

async function applyGmailActions(
  ownerEmail: string,
  candidate: BackfillCandidate,
  actions: AutomationAction[],
  accessToken: string,
  labelCache: Map<string, string>,
  existing: UndoThreadSnapshot | undefined,
  beforeMutation: (snapshot: UndoThreadSnapshot) => Promise<boolean>,
): Promise<{ snapshot: UndoThreadSnapshot; preview: AiFilterBackfillPreview }> {
  const addLabelIds: string[] = [];
  for (const name of actionLabels(actions)) {
    addLabelIds.push(await ensureGmailLabel(accessToken, name, labelCache));
  }
  const archive = actions.some((action) => action.type === "archive");
  const touched = [...addLabelIds, ...(archive ? ["INBOX"] : [])];
  const before = await snapshotGmailThread(
    candidate,
    accessToken,
    touched,
    archive,
    existing,
  );
  const currentLabels = new Set(gmailLabelIds(before.thread.messages ?? []));
  const adds = addLabelIds;
  const removes = archive && currentLabels.has("INBOX") ? ["INBOX"] : [];
  const expectedAfter = captureExpectedGmailMutationState(
    before.snapshot,
    before.thread,
    adds,
    removes,
  );
  if (!(await beforeMutation(expectedAfter))) {
    throw new Error("The backfill run was interrupted before Gmail changed.");
  }
  if (adds.length > 0 || removes.length > 0) {
    const changed = (await gmailModifyThread(
      accessToken,
      candidate.threadId,
      adds,
      removes,
    )) as { historyId?: string } | undefined;
    await syncInboxLabelDelta(
      ownerEmail,
      candidate.accountEmail!,
      [candidate.threadId],
      {
        add: adds,
        remove: removes,
        providerHistoryId: changed?.historyId,
      },
    );
  }
  const after = await gmailGetThread(
    accessToken,
    candidate.threadId,
    "metadata",
    METADATA_HEADERS,
  );
  return {
    snapshot: captureGmailPostApplyState(expectedAfter, after),
    preview: gmailThreadPreview(candidate, after, labelCache),
  };
}

async function saveRunState(
  id: string,
  claimId: string,
  state: BackfillState,
  status: "running" | "completed" | "failed" | "undoing" | "undone",
  expectedStatus: "running" | "undoing" = status === "undoing" ||
  status === "undone"
    ? "undoing"
    : "running",
): Promise<boolean> {
  const now = Date.now();
  const [updated] = await db
    .update(schema.aiFilterBackfills)
    .set({
      status,
      stateJson: JSON.stringify(state),
      updatedAt: now,
      ...(status === "completed" || status === "failed" || status === "undone"
        ? { claimId: null, claimedAt: null }
        : {}),
    })
    .where(
      and(
        eq(schema.aiFilterBackfills.id, id),
        eq(schema.aiFilterBackfills.claimId, claimId),
        eq(schema.aiFilterBackfills.status, expectedStatus),
      ),
    )
    .returning({ id: schema.aiFilterBackfills.id });
  return !!updated;
}

export async function checkpointAppliedBackfillMutation(
  id: string,
  claimId: string,
  state: object,
): Promise<boolean> {
  const [updated] = await db
    .update(schema.aiFilterBackfills)
    .set({ stateJson: JSON.stringify(state), updatedAt: Date.now() })
    .where(
      and(
        eq(schema.aiFilterBackfills.id, id),
        eq(schema.aiFilterBackfills.claimId, claimId),
        inArray(schema.aiFilterBackfills.status, ["running", "undoing"]),
      ),
    )
    .returning({ status: schema.aiFilterBackfills.status });
  return updated?.status === "running";
}

function matchedForCandidate(
  candidate: BackfillCandidate,
  state: BackfillState,
): StoredMatch[] | undefined {
  return state.evaluations[candidate.key];
}

function shouldApply(
  match: StoredMatch,
  rule: AiFilterPreviewRule,
  aiFilterState: AiFilterState,
): "apply" | "suggest" | "ignore" {
  const archiving = rule.actions.some((action) => action.type === "archive");
  if (archiving) {
    if (match.confidence >= aiFilterState.suggestionThreshold) {
      return aiFilterState.autoFilter &&
        match.confidence >= aiFilterState.autoFilterThreshold
        ? "apply"
        : "suggest";
    }
    return "ignore";
  }
  return match.confidence >= aiFilterState.suggestionThreshold
    ? "apply"
    : "ignore";
}

async function readCurrentDisposition(
  ownerEmail: string,
  match: StoredMatch,
  rule: AiFilterPreviewRule,
): Promise<"apply" | "suggest" | "ignore"> {
  const settings = {
    ...createDefaultAiFilterState(),
    ...(await getAiFilterState(ownerEmail)),
  };
  if (!settings.enabled) {
    throw new Error("Mail AI filtering was disabled during this run.");
  }
  return shouldApply(match, rule, settings);
}

export function pendingUndoSnapshots<T extends { key: string }>(
  snapshots: T[],
  undoProcessedIds: string[],
  undoFailedKeys: string[],
): T[] {
  const attempted = new Set([...undoProcessedIds, ...undoFailedKeys]);
  return snapshots.filter((snapshot) => !attempted.has(snapshot.key));
}

async function flushBackfillDecisions(
  ownerEmail: string,
  row: BackfillRow,
  claimId: string,
  state: BackfillState,
): Promise<boolean> {
  if (state.pendingDecisions.length === 0) return true;
  await recordAiFilterDecisions(ownerEmail, state.pendingDecisions);
  state.pendingDecisions = [];
  return saveRunState(row.id, claimId, state, "running");
}

async function ensureEvaluations(
  ownerEmail: string,
  row: BackfillRow,
  claimId: string,
  state: BackfillState,
): Promise<boolean> {
  const batch = state.candidates
    .slice(state.candidateIndex, state.candidateIndex + THREADS_PER_TICK)
    .filter((candidate) => matchedForCandidate(candidate, state) === undefined);
  if (batch.length === 0) return true;
  const matchMap = await evaluateAiFilterBackfillRules(
    batch.map((candidate) => candidate.email),
    state.rules,
    ownerEmail,
    {
      ...createDefaultAiFilterState(),
      ...state.aiFilterSettings,
    },
  );
  if (matchMap.size !== batch.length) {
    throw new Error("Mail AI-filter evaluation did not classify every thread.");
  }
  const evaluations = batch.map((candidate) => {
    const matches = matchMap.get(
      aiPriorityEmailKey(candidate.accountEmail, candidate.email.id),
    );
    if (matches === undefined) {
      throw new Error(
        "Mail AI-filter evaluation did not classify every thread.",
      );
    }
    return [
      candidate.key,
      matches.map(({ ruleId, confidence, reason }) => ({
        ruleId,
        confidence,
        ...(reason ? { reason } : {}),
      })),
    ] as const;
  });
  for (const [key, matches] of evaluations) {
    state.evaluations[key] = matches;
  }
  return saveRunState(row.id, claimId, state, "running");
}

async function processRunningBatch(
  row: BackfillRow,
  claimId: string,
  state: BackfillState,
): Promise<void> {
  const ownerEmail = row.ownerEmail;
  await assertMailJevEnabled(ownerEmail);
  if (!(await getAiFilterState(ownerEmail)).enabled)
    throw new Error("Mail AI filtering was disabled during this run.");
  const currentRules = await listAutomationRules(ownerEmail);
  for (const [ruleId, updatedAt] of Object.entries(state.ruleUpdatedAt)) {
    if (!isCurrentAiFilterBackfillRule(ruleId, updatedAt, currentRules)) {
      throw new Error(
        "An AI-filter rule changed during this backfill. Start a new run to apply the current rule.",
      );
    }
  }

  if (state.candidates.length === 0 && state.candidateIndex === 0) {
    const candidates = await captureCandidates(ownerEmail);
    state.candidates = candidates;
    if (!(await saveRunState(row.id, claimId, state, "running"))) return;
    if (candidates.length === 0) {
      if (!(await flushBackfillDecisions(ownerEmail, row, claimId, state)))
        return;
      await saveRunState(row.id, claimId, state, "completed");
      return;
    }
  }

  if (!(await ensureEvaluations(ownerEmail, row, claimId, state))) return;
  const batch = state.candidates.slice(
    state.candidateIndex,
    state.candidateIndex + THREADS_PER_TICK,
  );
  if (batch.length === 0) {
    if (!(await flushBackfillDecisions(ownerEmail, row, claimId, state)))
      return;
    await saveRunState(row.id, claimId, state, "completed");
    return;
  }

  const { clients, errors } = await getClientsWithErrors(ownerEmail);
  if (errors.length > 0) {
    throw new Error(
      errors.map((error) => `${error.email}: ${error.error}`).join("; "),
    );
  }
  const clientsByEmail = new Map(
    clients.map((client) => [client.email.toLowerCase(), client]),
  );
  const labelCaches = new Map<string, Map<string, string>>();
  for (const candidate of batch) {
    const matches = matchedForCandidate(candidate, state) ?? [];
    const candidateMatched = matches.length > 0;
    if (candidateMatched && !state.matchedThreadKeys.includes(candidate.key)) {
      state.matchedThreadKeys.push(candidate.key);
    }
    let candidateFailed = false;
    for (const match of matches) {
      const rule = state.rules.find((item) => item.id === match.ruleId);
      const progress = state.perRule.find(
        (item) => item.ruleId === match.ruleId,
      );
      if (!rule || !progress)
        throw new Error("The captured AI-filter rules are incomplete.");
      const key = resultKey(candidate, rule.id);
      if (state.processedIds.includes(key)) continue;
      const disposition = await readCurrentDisposition(ownerEmail, match, rule);
      if (!state.seenMatchIds.includes(key)) {
        state.seenMatchIds.push(key);
        progress.matchedCount += 1;
      }
      if (disposition === "ignore") {
        state.processedIds.push(key);
        if (!(await saveRunState(row.id, claimId, state, "running"))) return;
        continue;
      }
      const existingSnapshot = state.snapshots[candidate.key];
      const actions: AutomationAction[] =
        disposition === "suggest"
          ? [{ type: "label", labelName: AI_FILTER_LABEL }]
          : rule.actions;
      let applied: {
        snapshot: UndoThreadSnapshot;
        preview: AiFilterBackfillPreview;
      };
      const persistSnapshot = async (snapshot: UndoThreadSnapshot) => {
        const latestDisposition = await readCurrentDisposition(
          ownerEmail,
          match,
          rule,
        );
        if (latestDisposition !== disposition) {
          throw new Error(
            "Mail AI-filter settings changed during this backfill. Start a new run to apply the current settings.",
          );
        }
        await assertCurrentAiFilterBackfillRule(
          ownerEmail,
          rule.id,
          state.ruleUpdatedAt[rule.id],
        );
        const hadSnapshot = Object.prototype.hasOwnProperty.call(
          state.snapshots,
          candidate.key,
        );
        const previousSnapshot = state.snapshots[candidate.key];
        state.snapshots[candidate.key] = snapshot;
        const saved = await saveRunState(row.id, claimId, state, "running");
        if (!saved) {
          if (hadSnapshot) state.snapshots[candidate.key] = previousSnapshot!;
          else delete state.snapshots[candidate.key];
        }
        return saved;
      };
      try {
        const client = candidate.accountEmail
          ? clientsByEmail.get(candidate.accountEmail.toLowerCase())
          : undefined;
        if (candidate.accountEmail && !client) {
          throw new Error(
            `Gmail account ${candidate.accountEmail} is unavailable.`,
          );
        }
        if (client) {
          const cache =
            labelCaches.get(client.email.toLowerCase()) ??
            (await buildLabelCache(client.accessToken));
          labelCaches.set(client.email.toLowerCase(), cache);
          applied = await applyGmailActions(
            ownerEmail,
            candidate,
            actions,
            client.accessToken,
            cache,
            existingSnapshot,
            persistSnapshot,
          );
        } else {
          applied = await applyLocalActions(
            ownerEmail,
            candidate,
            actions,
            existingSnapshot,
            persistSnapshot,
          );
        }
      } catch (error) {
        candidateFailed = true;
        const message = safeError(error);
        if (!state.failedKeys.includes(candidate.key))
          state.failedKeys.push(candidate.key);
        state.error = message;
        throw error;
      }
      state.snapshots[candidate.key] = applied.snapshot;
      state.processedIds.push(key);
      if (disposition === "suggest") progress.suggestedCount += 1;
      else progress.appliedCount += 1;
      addPreview(progress, applied.preview);
      if (!state.appliedThreadKeys.includes(candidate.key)) {
        state.appliedThreadKeys.push(candidate.key);
      }
      if (mailLabelsInclude(actionLabels(actions), AI_FILTER_LABEL)) {
        state.pendingDecisions.push({
          id: nanoid(12),
          messageId: candidate.threadId,
          threadId: candidate.threadId,
          ...(candidate.accountEmail
            ? { accountEmail: candidate.accountEmail }
            : {}),
          sender: candidate.email.from.slice(0, 320),
          subject: candidate.email.subject.slice(0, 500),
          confidence: match.confidence,
          ...(match.reason ? { reason: match.reason } : {}),
          disposition: disposition === "suggest" ? "suggested" : "filtered",
          source: "automatic",
          createdAt: Date.now(),
        });
      }
      if (!(await checkpointAppliedBackfillMutation(row.id, claimId, state))) {
        return;
      }
    }
    if (!candidateFailed) {
      state.processedThreads += 1;
      state.candidateIndex += 1;
      if (!(await saveRunState(row.id, claimId, state, "running"))) return;
    }
  }

  if (!(await flushBackfillDecisions(ownerEmail, row, claimId, state))) return;
  if (state.candidateIndex >= state.candidates.length) {
    await saveRunState(row.id, claimId, state, "completed");
  } else {
    await saveRunState(row.id, claimId, state, "running");
  }
}

async function restoreLocalSnapshot(
  ownerEmail: string,
  snapshot: UndoThreadSnapshot,
): Promise<void> {
  const conflicts: string[] = [];
  await withLocalEmailMutationLock(ownerEmail, async () => {
    const emails = await readLocalEmails(ownerEmail);
    const snapshots = new Map(
      snapshot.messages.map((message) => [message.id, message]),
    );
    const messagesInThread = emails.filter(
      (email) => (email.threadId || email.id) === snapshot.threadId,
    );
    const currentMessageIds = new Set(
      messagesInThread.map((email) => email.id),
    );
    if (
      missingSnapshotMessageIds(
        snapshot.messages.map((message) => message.id),
        currentMessageIds,
      ).length > 0
    ) {
      throw new Error(
        "The local conversation changed after the backfill; no fields were undone.",
      );
    }
    let changed = false;
    const updated = emails.map((email) => {
      const saved = snapshots.get(email.id);
      if (!saved) return email;
      const labels = new Set(email.labelIds ?? []);
      const currentLabels = Object.fromEntries(
        Object.keys(saved.labels).map((label) => [label, labels.has(label)]),
      );
      const labelUndo = planConditionalUndo(
        saved.labels,
        saved.afterLabels,
        currentLabels,
      );
      const afterLabels = { ...saved.afterLabels };
      for (const [label, hadLabel] of Object.entries(labelUndo.changes)) {
        if (hadLabel) labels.add(label);
        else labels.delete(label);
        afterLabels[label] = hadLabel;
        changed ||= labels.has(label) !== currentLabels[label];
      }
      conflicts.push(...labelUndo.conflicts);

      let isArchived = email.isArchived;
      let afterArchived = saved.afterArchived;
      if (saved.archived !== undefined) {
        const archiveUndo = planConditionalUndo(
          { archived: saved.archived },
          saved.afterArchived === undefined
            ? undefined
            : { archived: saved.afterArchived },
          { archived: email.isArchived },
        );
        if (
          Object.prototype.hasOwnProperty.call(archiveUndo.changes, "archived")
        ) {
          isArchived = archiveUndo.changes.archived;
          afterArchived = isArchived;
          changed ||= isArchived !== email.isArchived;
        }
        conflicts.push(...archiveUndo.conflicts);
      }
      saved.afterLabels = afterLabels;
      if (afterArchived !== undefined) saved.afterArchived = afterArchived;
      return {
        ...email,
        isArchived,
        labelIds: [...labels],
      };
    });
    if (changed) await writeLocalEmails(ownerEmail, updated);
  });
  if (conflicts.length > 0) {
    throw new Error(
      `Mailbox fields changed after the backfill and were left unchanged (${conflicts.length} conflicts).`,
    );
  }
}

async function restoreGmailSnapshot(
  ownerEmail: string,
  snapshot: UndoThreadSnapshot,
): Promise<void> {
  const accountEmail = snapshot.accountEmail;
  if (!accountEmail) throw new Error("The captured Gmail account is missing.");
  const clients = await getClientsWithErrors(ownerEmail, [accountEmail]);
  const client = clients.clients.find(
    (item) => item.email.toLowerCase() === accountEmail.toLowerCase(),
  );
  if (!client) {
    throw new Error(
      clients.errors.map((error) => error.error).join("; ") ||
        "Gmail account is unavailable.",
    );
  }
  const current = await gmailGetThread(
    client.accessToken,
    snapshot.threadId,
    "metadata",
    METADATA_HEADERS,
  );
  const messages = Array.isArray(current.messages) ? current.messages : [];
  const currentById = new Map(
    messages.map((message: any) => [String(message.id), message]),
  );
  if (snapshot.messages.some((saved) => !currentById.has(saved.id))) {
    throw new Error(
      "A Gmail message changed after the backfill; no fields were undone.",
    );
  }
  const beforeLabels = new Set(gmailLabelIds(messages));
  const conflicts: string[] = [];
  for (const saved of snapshot.messages) {
    const message = currentById.get(saved.id) as any;
    const currentLabels = new Set<string>(message.labelIds ?? []);
    const current = Object.fromEntries(
      Object.keys(saved.labels).map((label) => [
        label,
        currentLabels.has(label),
      ]),
    );
    const labelUndo = planConditionalUndo(
      saved.labels,
      saved.afterLabels,
      current,
    );
    const add = Object.entries(labelUndo.changes)
      .filter(([label, shouldHave]) => shouldHave && !currentLabels.has(label))
      .map(([label]) => label);
    const remove = Object.entries(labelUndo.changes)
      .filter(([label, shouldHave]) => !shouldHave && currentLabels.has(label))
      .map(([label]) => label);
    if (add.length || remove.length) {
      await gmailModifyMessage(client.accessToken, saved.id, add, remove);
    }
    saved.afterLabels = {
      ...saved.afterLabels,
      ...labelUndo.changes,
    };
    conflicts.push(...labelUndo.conflicts);
  }
  const after = await gmailGetThread(
    client.accessToken,
    snapshot.threadId,
    "metadata",
    METADATA_HEADERS,
  );
  const afterLabels = new Set(gmailLabelIds(after.messages ?? []));
  await syncInboxLabelDelta(ownerEmail, accountEmail, [snapshot.threadId], {
    add: [...afterLabels].filter((label) => !beforeLabels.has(label)),
    remove: [...beforeLabels].filter((label) => !afterLabels.has(label)),
  });
  if (conflicts.length > 0) {
    throw new Error(
      `Mailbox fields changed after the backfill and were left unchanged (${conflicts.length} conflicts).`,
    );
  }
}

async function processUndoBatch(
  row: BackfillRow,
  claimId: string,
  state: BackfillState,
): Promise<void> {
  const snapshots = Object.values(state.snapshots);
  const pending = pendingUndoSnapshots(
    snapshots,
    state.undoProcessedIds,
    state.undoFailedKeys,
  ).slice(0, THREADS_PER_TICK);
  for (const snapshot of pending) {
    try {
      if (snapshot.local) await restoreLocalSnapshot(row.ownerEmail, snapshot);
      else await restoreGmailSnapshot(row.ownerEmail, snapshot);
      state.undoProcessedIds.push(snapshot.key);
      state.undoFailedKeys = state.undoFailedKeys.filter(
        (key) => key !== snapshot.key,
      );
    } catch (error) {
      if (!state.undoFailedKeys.includes(snapshot.key))
        state.undoFailedKeys.push(snapshot.key);
      const message = safeError(error);
      state.error = state.error
        ? `${state.error}; ${message}`.slice(0, 500)
        : message;
    }
  }
  state.restoredThreads = state.undoProcessedIds.length;
  const attemptedCount =
    state.undoProcessedIds.length + state.undoFailedKeys.length;
  if (attemptedCount >= snapshots.length && state.undoFailedKeys.length > 0) {
    await saveRunState(row.id, claimId, state, "failed", "undoing");
  } else if (attemptedCount >= snapshots.length) {
    await saveRunState(row.id, claimId, state, "undone");
  } else {
    await saveRunState(row.id, claimId, state, "undoing");
  }
}

async function claimRun(row: BackfillRow): Promise<ClaimedBackfill | null> {
  const claimId = nanoid(16);
  const now = Date.now();
  return db.transaction(async (tx: any) => {
    await backfillOwnerLock(tx, row.ownerEmail);
    const activeRows = (await tx
      .select()
      .from(schema.aiFilterBackfills)
      .where(
        and(
          eq(schema.aiFilterBackfills.ownerEmail, row.ownerEmail),
          gt(schema.aiFilterBackfills.expiresAt, now),
          inArray(schema.aiFilterBackfills.status, ACTIVE_BACKFILL_STATUSES),
        ),
      )) as BackfillRow[];
    const requested = new Set(ruleIdsForBackfillRow(row));
    const earlierQueued = (other: BackfillRow) =>
      other.status === "queued" &&
      (other.createdAt < row.createdAt ||
        (other.createdAt === row.createdAt && other.id < row.id));
    if (
      activeRows.some(
        (other) =>
          other.id !== row.id &&
          ruleIdsOverlap(other, requested) &&
          (other.status !== "queued" || earlierQueued(other)),
      )
    )
      return null;

    const [claimed] = await tx
      .update(schema.aiFilterBackfills)
      .set({
        claimId,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.aiFilterBackfills.id, row.id),
          or(
            eq(schema.aiFilterBackfills.status, "queued"),
            and(
              inArray(schema.aiFilterBackfills.status, ["running", "undoing"]),
              or(
                isNull(schema.aiFilterBackfills.claimedAt),
                lt(schema.aiFilterBackfills.claimedAt, now - CLAIM_LIFETIME_MS),
              ),
            ),
          ),
        ),
      )
      .returning({
        status: schema.aiFilterBackfills.status,
        stateJson: schema.aiFilterBackfills.stateJson,
      });
    if (!claimed) return null;

    let status = claimed.status as BackfillStatus;
    let stateJson = claimed.stateJson;
    if (status === "queued") {
      const [started] = await tx
        .update(schema.aiFilterBackfills)
        .set({ status: "running", updatedAt: now })
        .where(
          and(
            eq(schema.aiFilterBackfills.id, row.id),
            eq(schema.aiFilterBackfills.claimId, claimId),
            eq(schema.aiFilterBackfills.status, "queued"),
          ),
        )
        .returning({
          status: schema.aiFilterBackfills.status,
          stateJson: schema.aiFilterBackfills.stateJson,
        });
      if (!started) return null;
      status = started.status as BackfillStatus;
      stateJson = started.stateJson;
    }
    if (status !== "running" && status !== "undoing") {
      throw new Error("Claimed Mail AI backfill has an invalid status.");
    }

    const undoRows = await tx
      .select()
      .from(schema.aiFilterBackfills)
      .where(
        and(
          eq(schema.aiFilterBackfills.ownerEmail, row.ownerEmail),
          inArray(schema.aiFilterBackfills.status, ["completed", "failed"]),
          gt(schema.aiFilterBackfills.undoExpiresAt, now),
        ),
      );
    for (const previous of undoRows as BackfillRow[]) {
      if (previous.undoToken && ruleIdsOverlap(previous, requested)) {
        await tx
          .update(schema.aiFilterBackfills)
          .set({ undoToken: null, undoExpiresAt: null, updatedAt: now })
          .where(eq(schema.aiFilterBackfills.id, previous.id));
      }
    }
    return { claimId, status, stateJson };
  });
}

function startClaimHeartbeat(id: string, claimId: string): () => void {
  const heartbeat = setInterval(() => {
    void db
      .update(schema.aiFilterBackfills)
      .set({ claimedAt: Date.now() })
      .where(
        and(
          eq(schema.aiFilterBackfills.id, id),
          eq(schema.aiFilterBackfills.claimId, claimId),
          inArray(schema.aiFilterBackfills.status, ["running", "undoing"]),
        ),
      )
      .then(undefined, (error: unknown) => {
        console.error("[mail-ai-backfill] failed to renew run claim", error);
      });
  }, CLAIM_HEARTBEAT_MS);
  return () => clearInterval(heartbeat);
}

export async function processMailAiFilterBackfills(
  ownerEmail?: string,
): Promise<void> {
  const now = Date.now();
  const conditions = [
    gt(schema.aiFilterBackfills.expiresAt, now),
    or(
      eq(schema.aiFilterBackfills.status, "queued"),
      eq(schema.aiFilterBackfills.status, "running"),
      eq(schema.aiFilterBackfills.status, "undoing"),
    ),
  ];
  if (ownerEmail)
    conditions.push(eq(schema.aiFilterBackfills.ownerEmail, ownerEmail));
  const rows = await db
    .select()
    .from(schema.aiFilterBackfills)
    .where(and(...conditions))
    .orderBy(asc(schema.aiFilterBackfills.createdAt))
    .limit(MAX_RUNS_PER_TICK * 4);
  let processed = 0;
  for (const row of rows) {
    if (processed >= MAX_RUNS_PER_TICK) break;
    const claim = await claimRun(row);
    if (!claim) continue;
    processed += 1;
    const claimId = claim.claimId;
    const claimedRow = {
      ...row,
      status: claim.status,
      stateJson: claim.stateJson,
    };
    const stopClaimHeartbeat = startClaimHeartbeat(row.id, claimId);
    let state: BackfillState | undefined;
    try {
      state = parseState(claimedRow.stateJson);
      if (claimedRow.status === "undoing") {
        await processUndoBatch(claimedRow, claimId, state);
      } else {
        await processRunningBatch(claimedRow, claimId, state);
      }
    } catch (error) {
      try {
        state ??= parseState(claimedRow.stateJson);
        state.error = safeError(error);
        if (state.pendingDecisions.length > 0) {
          try {
            await recordAiFilterDecisions(
              row.ownerEmail,
              state.pendingDecisions,
            );
            state.pendingDecisions = [];
          } catch (decisionError) {
            console.error(
              "[mail-ai-backfill] failed to persist filter decisions",
              decisionError,
            );
          }
        }
        const activeStatus =
          claimedRow.status === "undoing" ? "undoing" : "running";
        const [failed] = await db
          .update(schema.aiFilterBackfills)
          .set({
            status: "failed",
            stateJson: JSON.stringify(state),
            claimId: null,
            claimedAt: null,
            updatedAt: Date.now(),
          })
          .where(
            and(
              eq(schema.aiFilterBackfills.id, row.id),
              eq(schema.aiFilterBackfills.claimId, claimId),
              eq(schema.aiFilterBackfills.status, activeStatus),
            ),
          )
          .returning({ id: schema.aiFilterBackfills.id });
        if (!failed && activeStatus === "running") {
          await db
            .update(schema.aiFilterBackfills)
            .set({
              stateJson: JSON.stringify(state),
              claimId: null,
              claimedAt: null,
              updatedAt: Date.now(),
            })
            .where(
              and(
                eq(schema.aiFilterBackfills.id, row.id),
                eq(schema.aiFilterBackfills.claimId, claimId),
                eq(schema.aiFilterBackfills.status, "undoing"),
              ),
            );
        }
      } catch (persistError) {
        console.error(
          "[mail-ai-backfill] failed to persist run error",
          persistError,
        );
      }
    } finally {
      stopClaimHeartbeat();
      await db
        .update(schema.aiFilterBackfills)
        .set({ claimId: null, claimedAt: null, updatedAt: Date.now() })
        .where(
          and(
            eq(schema.aiFilterBackfills.id, row.id),
            eq(schema.aiFilterBackfills.claimId, claimId),
          ),
        );
    }
  }
}

export async function purgeExpiredMailAiFilterBackfills(): Promise<void> {
  await db
    .delete(schema.aiFilterBackfills)
    .where(lt(schema.aiFilterBackfills.expiresAt, Date.now()));
}
