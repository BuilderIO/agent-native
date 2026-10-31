import type { ActionAutomationContext } from "@agent-native/core/action";
import {
  executeAgentToolCall,
  type ActionEntry,
} from "@agent-native/core/server";
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { factoryWorkflowItemState, triageItems } from "../db/schema.js";
import { previewRowSchema } from "../lib/factory-poll-start.js";
import { orgFactoryItemFilter } from "../lib/factory-scope.js";
import {
  PERSON_REACTIONS_KEY,
  parseOptionalReaction,
} from "../lib/source-reaction.js";
import { SECRET_UNREADABLE_CODE } from "../lib/unreadable-secret.js";
import { connectionAdvice } from "../lib/workflow-action-errors.js";
import { triageItemStatusSchema } from "../triage/contracts.js";
import { parseTriageMetadata } from "../triage/metadata.js";
import type { TripwireSink } from "../tripwire/types.js";
import type {
  InboxReader,
  InboxRequest,
  InboxResult,
  InboxStart,
  RequeuedRequest,
  StoreClock,
  WorkflowScope,
} from "../workflow/adapter.js";
import type { WorkflowErrorCode } from "../workflow/contract.js";
import {
  boundItem,
  itemKindSchema,
  normalizedItemSchema,
  type ItemKind,
  type NormalizedItem,
} from "../workflow/items.js";
import { decodeStart, encodeStart, type StoredStart } from "./inbox-start.js";
import {
  ITEM_METADATA,
  queueStatusFor,
  type ItemRow,
  type ItemsDatabase,
} from "./items.js";

type InboxPollSettings = Extract<
  InboxRequest["settings"],
  { source: "inbox-poll" }
>;
type Poller = InboxPollSettings["poller"];

/** The existing observers an inbox-poll source runs, one per provider. */
export const INBOX_POLLER_ACTIONS: Readonly<Record<Poller, string>> = {
  slack: "poll-slack-channel",
  github: "poll-github-sources",
  sentry: "poll-sentry-errors",
};

/** The `factory_items.source` values each poller writes. */
const POLLER_SOURCES: Readonly<Record<Poller, readonly string[]>> = {
  slack: ["slack"],
  github: ["github", "github_issue"],
  sentry: ["sentry"],
};

const KIND_BY_SOURCE: Readonly<Record<string, ItemKind>> = {
  slack: "message",
  github: "pull_request",
  github_issue: "issue",
  sentry: "error",
};

const MAX_ERROR_TEXT_CHARS = 500;

type InboxFailureReason =
  | "poller_failed"
  | "partial_read"
  | "row_unreadable"
  | "filter_invalid"
  | "position_unreadable"
  | "position_missing"
  | "aborted";

type InboxFailure = Extract<InboxResult, { ok: false }> & {
  reason: InboxFailureReason;
};
type InboxTaken = Extract<InboxResult, { ok: true }>;

interface InboxHost extends InboxReader {
  take(request: InboxRequest): Promise<InboxTaken | InboxFailure>;
  takeRequeued(request: RequeuedRequest): Promise<InboxTaken | InboxFailure>;
}

/** What a guarded action call came back with; the output is the model-visible string. */
export interface GuardedActionResult {
  status: "completed" | "failed" | "approval_required";
  output: string;
  errorCode?: string;
}

export interface GuardedActionCall {
  name: string;
  input: Record<string, unknown>;
  callId: string;
  signal: AbortSignal;
}

export type GuardedActionCaller = (
  call: GuardedActionCall,
) => Promise<GuardedActionResult>;

interface GuardedActionCallerOptions {
  /** The app's action registry; the call runs the entry the gate checks. */
  actions: Record<string, ActionEntry>;
  ownerEmail: string;
  orgId: string;
  /** The job's lineage: what `requireFactoryAutomation` reads to admit the call. */
  automation: ActionAutomationContext;
  runId: string;
  appId?: string;
}

/**
 * Runs one action as the workflow job would: caller `automation`, the job's
 * lineage, and the run id. The action still passes its own checks, including
 * the gate that admits only what the saved graph names, so nothing here can
 * widen what a workflow may call.
 */
export function createGuardedActionCaller(
  options: GuardedActionCallerOptions,
): GuardedActionCaller {
  return async (call) => {
    const result = await executeAgentToolCall({
      actions: options.actions,
      name: call.name,
      input: call.input,
      callId: call.callId,
      signal: call.signal,
      ownerEmail: options.ownerEmail,
      orgId: options.orgId,
      appId: options.appId ?? "factory",
      caller: "automation",
      automation: options.automation,
      runId: options.runId,
    });
    return {
      status: result.status,
      output: result.output,
      ...(result.status === "failed" && result.terminalError?.errorCode
        ? { errorCode: result.terminalError.errorCode }
        : {}),
    };
  };
}

interface InboxHostOptions {
  scope: WorkflowScope;
  workflowId: string;
  /** Called on every operation, so a reset connection is never held. */
  getDatabase: () => ItemsDatabase;
  /** Runs the pollers through the gated action path. */
  callAction: GuardedActionCaller;
  clock?: StoreClock;
  /** Where a poller answer that is not what the host reads is reported; observe only. */
  tripwire?: TripwireSink;
}

function fail(
  reason: InboxFailureReason,
  code: WorkflowErrorCode,
  message: string,
  retryable: boolean,
): InboxFailure {
  return {
    ok: false,
    reason,
    code,
    // The code already names it when the two are the same word.
    message: reason === code ? message : `${reason}: ${message}`,
    retryable,
  };
}

function clip(text: string): string {
  return text.length <= MAX_ERROR_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_ERROR_TEXT_CHARS)}...`;
}

function pollerFailure(
  action: string,
  poller: Poller,
  result: GuardedActionResult,
): InboxFailure {
  const text = clip(result.output);
  if (result.status === "approval_required") {
    return fail(
      "poller_failed",
      "operation_not_allowed",
      `${action} asked for approval, which a workflow cannot give.`,
      false,
    );
  }
  if (
    result.errorCode === "workflow_action_not_allowed" ||
    /workflow_action_not_allowed|not allowed to call/i.test(text)
  ) {
    return fail(
      "poller_failed",
      "operation_not_allowed",
      `${action} was refused for this workflow: ${text}`,
      false,
    );
  }
  // The key is saved, so connecting is no fix, and it never heals, so a retry is none either.
  if (
    result.errorCode === SECRET_UNREADABLE_CODE ||
    result.output.includes(`(errorCode: ${SECRET_UNREADABLE_CODE})`)
  ) {
    return fail(
      "poller_failed",
      "provider_error",
      `${action} cannot read a saved key, and trying again will not change that: ${text}`,
      false,
    );
  }
  if (
    /(?:missing|no|not (?:configured|connected)).{0,40}(?:token|credential|api key)|connect (?:your )?(?:slack|github|sentry)/i.test(
      text,
    )
  ) {
    return fail(
      "poller_failed",
      "credential_missing",
      `${action} could not authenticate: ${text} ${connectionAdvice(poller)}`,
      false,
    );
  }
  return fail(
    "poller_failed",
    "provider_error",
    `${action} failed: ${text}`,
    true,
  );
}

type Checked<T> = { ok: true; value: T } | InboxFailure;

function pollerArgs(
  factoryId: string,
  settings: InboxPollSettings,
): Checked<Record<string, unknown>> {
  const scopes = settings.filter?.scopes ?? [];
  if (scopes.length > 1) {
    return fail(
      "filter_invalid",
      "graph_invalid",
      `A ${settings.poller} source polls one place per workflow; this one lists ${scopes.length}.`,
      false,
    );
  }
  // The job file holds the real channel; naming it here makes the poller
  // refuse a job whose file drifted from the graph instead of polling another.
  return {
    ok: true,
    value:
      settings.poller === "slack" && scopes.length === 1
        ? { factoryId, channelId: scopes[0] }
        : { factoryId },
  };
}

/** What a poller says beyond how many items it observed, when a workflow source asked for a position or a preview. */
interface PollRead {
  observed: number;
  /** Where the read left off (or, for a first read, the newest position). */
  position?: string;
  primed: boolean;
  /** The rows a preview would have stored, and how many there were before the answer was cut. */
  previewRows?: unknown;
  previewTotal?: number;
}

function readPollResult(
  settings: InboxPollSettings,
  action: string,
  output: string,
  observe: (details: Record<string, unknown>) => void,
): Checked<PollRead> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    observe({ reason: "poll_result_not_json", chars: output.length });
    return fail(
      "poller_failed",
      "provider_error",
      `${action} returned a result that is not JSON: ${clip(output)}`,
      true,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    observe({ reason: "poll_result_not_object", body: parsed });
    return fail(
      "poller_failed",
      "provider_error",
      `${action} returned a result that is not an object.`,
      true,
    );
  }
  const result = parsed as Record<string, unknown>;
  if (result.ok !== true) {
    observe({ reason: "poll_not_ok", body: result });
    return fail(
      "poller_failed",
      "provider_error",
      `${action} did not report success: ${clip(output)}`,
      true,
    );
  }
  const count = (key: string): number | undefined =>
    typeof result[key] === "number" && Number.isFinite(result[key])
      ? result[key]
      : undefined;
  const observed =
    settings.poller === "github"
      ? (() => {
          const issues = count("issues");
          const pulls = count("pullRequests");
          return issues === undefined || pulls === undefined
            ? undefined
            : issues + pulls;
        })()
      : count("observed");
  if (observed === undefined) {
    observe({ reason: "poll_observed_missing", body: result });
    return fail(
      "poller_failed",
      "provider_error",
      `${action} did not say how many items it observed, so the read cannot be checked.`,
      true,
    );
  }
  return {
    ok: true,
    value: {
      observed,
      ...(typeof result.position === "string"
        ? { position: result.position }
        : {}),
      primed: result.primed === true,
      ...(result.previewRows === undefined
        ? {}
        : { previewRows: result.previewRows }),
      ...(typeof result.previewTotal === "number"
        ? { previewTotal: result.previewTotal }
        : {}),
    },
  };
}

type HostStart =
  | { kind: "none" }
  | { kind: "prime" }
  | { kind: "from"; stored: StoredStart };

/** What the engine's start means for the place this source reads now. */
function readStart(
  start: InboxStart | undefined,
  scopeKey: string,
): Checked<HostStart> {
  if (start === undefined) return { ok: true, value: { kind: "none" } };
  if (start.kind === "prime") return { ok: true, value: { kind: "prime" } };
  const decoded = decodeStart(start.position);
  if (!decoded.ok) {
    return fail(
      "position_unreadable",
      "engine_error",
      `This source's saved position cannot be read (${decoded.message}), so it cannot go on from it, and starting over would skip what arrived since. Nothing was read.`,
      false,
    );
  }
  // A position saved for another place says nothing about this one: the source
  // was pointed somewhere else, so it starts from now there.
  return {
    ok: true,
    value:
      decoded.start.scope === scopeKey
        ? { kind: "from", stored: decoded.start }
        : { kind: "prime" },
  };
}

/** The sample rows a preview returned, as the items a live read would have offered. */
function previewItems(
  action: string,
  rows: unknown,
): Checked<NormalizedItem[]> {
  const parsed = previewRowSchema.array().safeParse(rows);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return fail(
      "poller_failed",
      "provider_error",
      `${action} returned preview rows that are not what a poll stores: ${problems}.`,
      true,
    );
  }
  try {
    return { ok: true, value: parsed.data.map(rowToNormalizedItem) };
  } catch (error) {
    if (!(error instanceof RowUnreadable)) throw error;
    return fail(
      "row_unreadable",
      "item_invalid",
      `Preview row "${error.itemId}" cannot be read: ${error.message}`,
      false,
    );
  }
}

const jsonKey = (key: string): SQL<string | null> =>
  sql<string | null>`(${triageItems.metadataJson}::jsonb ->> ${key}::text)`;

/**
 * An item a workflow is still holding is not available to a Source: it is
 * parked at a Wait, or another run's lease on it is live. Leaving it out of
 * the read keeps parked items from filling every tick's bounded take.
 */
function notHeldByWorkflow(
  db: ItemsDatabase,
  scope: WorkflowScope,
  workflowId: string,
  nowIso: string,
): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(factoryWorkflowItemState)
      .where(
        and(
          eq(factoryWorkflowItemState.workflowId, workflowId),
          eq(factoryWorkflowItemState.itemId, triageItems.id),
          eq(factoryWorkflowItemState.orgId, scope.orgId),
          eq(factoryWorkflowItemState.factoryId, scope.factoryId),
          or(
            isNotNull(factoryWorkflowItemState.parkedAtNode),
            gt(factoryWorkflowItemState.leaseUntil, nowIso),
          ),
        ),
      ),
  );
}

/**
 * The rows a provider-query source's operation brought in that this workflow
 * took before: ids minted for the operation, with a state row of this
 * workflow's, back in their queue status. The provider has moved past them,
 * so only this read can offer them again.
 */
function requeuedCondition(
  db: ItemsDatabase,
  scope: WorkflowScope,
  workflowId: string,
  operationId: string,
): SQL {
  const prefix = `${operationId}:`;
  return and(
    orgFactoryItemFilter(scope.orgId, scope.factoryId),
    sql`left(${triageItems.id}, ${prefix.length}) = ${prefix}`,
    or(
      and(
        eq(triageItems.source, "github"),
        eq(triageItems.status, queueStatusFor("github")),
      ),
      and(
        ne(triageItems.source, "github"),
        eq(triageItems.status, queueStatusFor("slack")),
      ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(factoryWorkflowItemState)
        .where(
          and(
            eq(factoryWorkflowItemState.workflowId, workflowId),
            eq(factoryWorkflowItemState.itemId, triageItems.id),
            eq(factoryWorkflowItemState.orgId, scope.orgId),
            eq(factoryWorkflowItemState.factoryId, scope.factoryId),
          ),
        ),
    ),
  )!;
}

function queueCondition(poller: Poller): SQL {
  if (poller === "github") {
    return or(
      and(
        eq(triageItems.source, "github"),
        eq(triageItems.status, queueStatusFor("github")),
      ),
      and(
        eq(triageItems.source, "github_issue"),
        eq(triageItems.status, queueStatusFor("github_issue")),
      ),
    )!;
  }
  return eq(triageItems.status, queueStatusFor(POLLER_SOURCES[poller][0]));
}

function filterConditions(settings: InboxPollSettings): Checked<SQL[]> {
  const filter = settings.filter;
  if (!filter) return { ok: true, value: [] };
  const conditions: SQL[] = [];
  const scopes = filter.scopes ?? [];
  if (scopes.length > 0) {
    if (settings.poller === "slack") {
      conditions.push(inArray(triageItems.channelId, scopes));
    } else if (settings.poller === "github") {
      conditions.push(
        inArray(
          sql<string>`lower(${triageItems.repository})`,
          scopes.map((scope) => scope.toLowerCase()),
        ),
      );
    } else {
      conditions.push(
        inArray(
          sql<string>`lower(coalesce(${jsonKey("sentryOrgSlug")}, '') || '/' || coalesce(${jsonKey("projectSlug")}, ''))`,
          scopes.map((scope) => scope.toLowerCase()),
        ),
      );
    }
  }
  const authors = filter.authors ?? [];
  const excluded = filter.excludeAuthors ?? [];
  if (authors.length > 0 && excluded.length > 0) {
    return fail(
      "filter_invalid",
      "graph_invalid",
      "A source includes authors or excludes them, not both.",
      false,
    );
  }
  if (authors.length > 0 || excluded.length > 0) {
    if (settings.poller === "sentry") {
      return fail(
        "filter_invalid",
        "graph_invalid",
        "A Sentry source does not filter by author.",
        false,
      );
    }
    // Matches `authorMatchesFilter`: case-insensitive, and an item with no
    // author is kept by an exclude list and dropped by an include list.
    const author = sql<string>`upper(coalesce(${jsonKey("authorId")}, ${jsonKey("author")}, ''))`;
    conditions.push(
      authors.length > 0
        ? inArray(
            author,
            authors.map((id) => id.trim().toUpperCase()),
          )
        : notInArray(
            author,
            excluded.map((id) => id.trim().toUpperCase()),
          ),
    );
  }
  if (filter.claimReaction !== undefined) {
    let reaction: string | null;
    try {
      reaction = parseOptionalReaction(filter.claimReaction);
    } catch (error) {
      return fail(
        "filter_invalid",
        "graph_invalid",
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
    // A report a person already reacted to with this is theirs, not the
    // workflow's: it stays in the inbox but is never offered. The poller lists
    // only people's reactions, so the workflow's own and other bots' never
    // claim one; a row it never read reactions for has nothing to match.
    if (reaction) {
      conditions.push(
        sql`NOT coalesce(jsonb_exists((${triageItems.metadataJson}::jsonb -> ${PERSON_REACTIONS_KEY}::text), ${reaction}::text), false)`,
      );
    }
  }
  return { ok: true, value: conditions };
}

export class RowUnreadable extends Error {
  constructor(
    readonly itemId: string,
    message: string,
  ) {
    super(message);
  }
}

function parseStoredObject(
  row: ItemRow,
  column: "metadata" | "payload",
): Record<string, unknown> {
  const json = column === "metadata" ? row.metadataJson : row.payloadJson;
  try {
    if (column === "metadata") return parseTriageMetadata(json);
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new RowUnreadable(
      row.id,
      `its stored ${column} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new RowUnreadable(row.id, `its stored ${column} is not an object.`);
}

const isoInstant = z.iso.datetime({ offset: true });

function occurredAtOf(row: ItemRow, metadata: Record<string, unknown>): string {
  const stored = metadata[ITEM_METADATA.occurredAt];
  if (typeof stored === "string" && isoInstant.safeParse(stored).success) {
    return stored;
  }
  const messageTs = metadata.messageTs;
  if (typeof messageTs === "string" && /^\d+(?:\.\d+)?$/.test(messageTs)) {
    return new Date(Number(messageTs) * 1000).toISOString();
  }
  const created = Date.parse(row.createdAt);
  if (Number.isFinite(created)) return new Date(created).toISOString();
  throw new RowUnreadable(row.id, "it has no readable time.");
}

function kindOf(row: ItemRow, metadata: Record<string, unknown>): ItemKind {
  const known = KIND_BY_SOURCE[row.source];
  if (known) return known;
  const stored = itemKindSchema.safeParse(metadata[ITEM_METADATA.kind]);
  if (stored.success) return stored.data;
  throw new RowUnreadable(
    row.id,
    `it comes from "${row.source}" and carries no item kind.`,
  );
}

/**
 * Rebuilds the item the engine passes around from its inbox row. Nothing is
 * guessed: a row that cannot be read fails the read, never drops out of it.
 */
export function rowToNormalizedItem(row: ItemRow): NormalizedItem {
  const metadata = parseStoredObject(row, "metadata");
  const payload = parseStoredObject(row, "payload");
  const kind = kindOf(row, metadata);
  const storedExtras = metadata[ITEM_METADATA.extras];
  const thread = {
    ...(row.channelId ? { channelId: row.channelId } : {}),
    ...(row.threadTs ? { threadTs: row.threadTs } : {}),
    ...(row.repository ? { repo: row.repository } : {}),
    ...(row.pullRequestNumber === null
      ? {}
      : { number: row.pullRequestNumber }),
  };
  const author =
    typeof metadata[ITEM_METADATA.author] === "string" &&
    metadata[ITEM_METADATA.author]
      ? (metadata[ITEM_METADATA.author] as string)
      : undefined;
  // A workflow's own rows keep the provider's fields in the payload; a poller
  // keeps them in the metadata it wrote.
  const providerFields = { ...metadata };
  delete providerFields[ITEM_METADATA.workflowEnd];
  const candidate = {
    id: row.id,
    externalId: row.externalId,
    kind,
    provider: row.source === "github_issue" ? "github" : row.source,
    title: row.title,
    ...(row.summary === null ? {} : { text: row.summary }),
    ...(metadata[ITEM_METADATA.textTruncated] === true
      ? { textTruncated: true }
      : {}),
    ...(row.textRef === null ? {} : { textRef: row.textRef }),
    ...(row.sourceUrl === null ? {} : { url: row.sourceUrl }),
    ...(author === undefined ? {} : { author }),
    occurredAt: occurredAtOf(row, metadata),
    ...(Object.keys(thread).length === 0 ? {} : { thread }),
    extras: {
      ...(typeof storedExtras === "object" &&
      storedExtras !== null &&
      !Array.isArray(storedExtras)
        ? (storedExtras as Record<string, unknown>)
        : {}),
      status: row.status,
      coverage: row.coverage,
      ...(row.headSha ? { headSha: row.headSha } : {}),
    },
    payload: Object.keys(payload).length > 0 ? payload : providerFields,
    ...(metadata[ITEM_METADATA.payloadTruncated] === true
      ? { payloadTruncated: true }
      : {}),
  };
  const parsed = normalizedItemSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RowUnreadable(
      row.id,
      `it is not a valid item: ${issue?.path.join(".") || "(root)"}: ${issue?.message}.`,
    );
  }
  return boundItem(parsed.data);
}

async function readQueue(
  db: ItemsDatabase,
  where: SQL,
  limit: number,
): Promise<InboxTaken | InboxFailure> {
  const rows = await db
    .select()
    .from(triageItems)
    .where(where)
    .orderBy(desc(triageItems.updatedAt), desc(triageItems.id))
    .limit(limit);
  const total = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(triageItems)
      .where(where)
  )[0];
  let items: NormalizedItem[];
  try {
    items = rows.map(rowToNormalizedItem);
  } catch (error) {
    if (!(error instanceof RowUnreadable)) throw error;
    return fail(
      "row_unreadable",
      "item_invalid",
      `Inbox item "${error.itemId}" cannot be read: ${error.message}`,
      false,
    );
  }
  return {
    ok: true,
    items,
    totalAvailable: Math.max(Number(total?.count ?? 0), items.length),
  };
}

/**
 * The two sources that read Factory's own inbox. An inbox poll runs the
 * existing poller for its provider through the gated path, then reads the
 * queue back from the store; a status source only reads. A failed poller, or
 * one that reports more items than the store holds, is a typed failure, never
 * an empty list.
 */
export function createInboxHost(options: InboxHostOptions): InboxHost {
  const { scope, workflowId, getDatabase, callAction } = options;
  const clock = options.clock ?? (() => new Date());

  return {
    async takeRequeued(request) {
      const db = getDatabase();
      return readQueue(
        db,
        and(
          requeuedCondition(db, scope, workflowId, request.operationId),
          notHeldByWorkflow(db, scope, workflowId, clock().toISOString()),
        )!,
        request.limit,
      );
    },

    async take(request) {
      const { settings, signal } = request;
      const db = getDatabase();
      const nowIso = clock().toISOString();

      if (settings.source === "status") {
        const status = triageItemStatusSchema.safeParse(settings.status);
        if (!status.success) {
          return fail(
            "filter_invalid",
            "graph_invalid",
            `"${settings.status}" is not an inbox status.`,
            false,
          );
        }
        return readQueue(
          db,
          and(
            orgFactoryItemFilter(scope.orgId, scope.factoryId),
            eq(triageItems.status, status.data),
            notHeldByWorkflow(db, scope, workflowId, nowIso),
          )!,
          settings.takeLimit,
        );
      }

      const { poller } = settings;
      const action = INBOX_POLLER_ACTIONS[poller];
      const args = pollerArgs(scope.factoryId, settings);
      if (!args.ok) return args;
      const filters = filterConditions(settings);
      if (!filters.ok) return filters;
      if (signal.aborted) {
        return fail(
          "aborted",
          "provider_error",
          "the run stopped before the inbox was polled.",
          true,
        );
      }

      const live = request.mode === "live";
      const scopeKey = settings.filter?.scopes?.[0] ?? "";
      const started = readStart(request.start, scopeKey);
      if (!started.ok) return started;
      const start = started.value;

      // Only a live read stores anything: a dry or test read asks the poller
      // for a preview, so it leaves no row, no cursor and no audit behind.
      const polled = await callAction({
        name: action,
        input: {
          ...args.value,
          ...(start.kind === "prime" ? { prime: true } : {}),
          ...(start.kind === "from" ? { after: start.stored.position } : {}),
          ...(live ? {} : { preview: true }),
        },
        callId: `${workflowId}:${action}`,
        signal,
      });
      if (polled.status !== "completed") {
        return pollerFailure(action, poller, polled);
      }
      const observe = (details: Record<string, unknown>) =>
        options.tripwire?.({
          area: "provider",
          code: "provider_shape_unexpected",
          severity: "warn",
          details: { provider: poller, action, ...details },
        });
      const summary = readPollResult(settings, action, polled.output, observe);
      if (!summary.ok) return summary;
      const read = summary.value;

      const sources = POLLER_SOURCES[poller];
      const sourceQueue = (): SQL =>
        and(
          orgFactoryItemFilter(scope.orgId, scope.factoryId),
          inArray(triageItems.source, [...sources]),
          queueCondition(poller),
          notHeldByWorkflow(db, scope, workflowId, nowIso),
          // A row stored before the source started was already there.
          ...(start.kind === "from"
            ? [gt(triageItems.createdAt, start.stored.since)]
            : []),
          ...filters.value,
        ) ?? sql`true`;

      if (!live) {
        const sample = previewItems(action, read.previewRows);
        if (!sample.ok) return sample;
        // A source with no position yet starts from now, so what is in the
        // inbox is not what a live read would offer: only the sample is shown.
        const queued: InboxTaken | InboxFailure =
          start.kind === "prime"
            ? { ok: true, items: [], totalAvailable: 0 }
            : await readQueue(db, sourceQueue(), settings.takeLimit);
        if (!queued.ok) return queued;
        // The newest first, so a short take shows what the source would read next.
        const newest = [...sample.value].sort(
          (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
        );
        const seen = new Set(newest.map((item) => item.id));
        const items = [
          ...newest,
          ...queued.items.filter((item) => !seen.has(item.id)),
        ].slice(0, settings.takeLimit);
        return {
          ok: true,
          items,
          totalAvailable: Math.max(
            items.length,
            (read.previewTotal ?? sample.value.length) +
              (queued.totalAvailable ?? queued.items.length),
          ),
          sample: true,
        };
      }

      if (start.kind === "prime") {
        if (!read.primed || read.position === undefined) {
          observe({ reason: "prime_position_missing", primed: read.primed });
          return fail(
            "position_missing",
            "provider_error",
            `${action} did not say where the source stands, so it cannot start from now.`,
            true,
          );
        }
        return {
          ok: true,
          items: [],
          primed: true,
          position: encodeStart({
            scope: scopeKey,
            position: read.position,
            since: nowIso,
          }),
        };
      }
      if (start.kind === "from" && read.position === undefined) {
        observe({ reason: "poll_position_missing" });
        return fail(
          "position_missing",
          "provider_error",
          `${action} did not say where the read left off, so the source cannot go on from there.`,
          true,
        );
      }

      const stored = (
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(triageItems)
          .where(
            and(
              orgFactoryItemFilter(scope.orgId, scope.factoryId),
              inArray(triageItems.source, [...sources]),
            ),
          )
      )[0];
      const storedCount = Number(stored?.count ?? 0);
      if (read.observed > storedCount) {
        observe({
          reason: "observed_exceeds_stored",
          observed: read.observed,
          stored: storedCount,
        });
        return fail(
          "partial_read",
          "partial_read",
          `${action} reported ${read.observed} observed items but this factory's inbox holds ${storedCount} from ${sources.join(" and ")}.`,
          true,
        );
      }

      const taken = await readQueue(db, sourceQueue(), settings.takeLimit);
      if (!taken.ok || start.kind !== "from" || read.position === undefined) {
        return taken;
      }
      return {
        ...taken,
        position: encodeStart({ ...start.stored, position: read.position }),
      };
    },
  };
}
