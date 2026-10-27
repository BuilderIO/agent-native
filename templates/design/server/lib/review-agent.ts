import { createHash } from "node:crypto";

import {
  defineActionErrors,
  NoWriteError,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  getReviewThreadRoot,
  queryReviewComments,
  type ReviewComment,
} from "@agent-native/core/review";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import {
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
  type RequestRunContext,
} from "@agent-native/core/server/request-context";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { applySearchReplaceEdits } from "../../actions/edit-design.js";
import type { DesignEdit } from "../../shared/apply-edits.js";
import { isStandaloneHttpUrl } from "../../shared/html-content.js";
import {
  assertLockedLayersPreserved,
  LockedLayerEditError,
} from "../../shared/locked-layers.js";
import { reviewAgentAuthorName } from "../../shared/review-agent-identity.js";
import {
  REVIEW_AGENT_ACTIVE_STATUSES,
  REVIEW_AGENT_DEFAULT_INSTRUCTIONS,
  REVIEW_AGENT_INTENTS,
  REVIEW_AGENT_LIMITS,
  REVIEW_AGENT_MODES,
  REVIEW_AGENT_STATUSES,
  isReviewAgentActive,
  type ReviewAgentErrorCode,
  type ReviewAgentIntent,
  type ReviewAgentMode,
  type ReviewAgentPendingSession,
  type ReviewAgentRequest,
  type ReviewAgentResult,
  type ReviewAgentStatus,
  type StartReviewAgentResult,
} from "../../shared/review-agent.js";
import {
  designScreenSourceTypeFromData,
  designSourceTypeFromData,
} from "../../shared/source-mode.js";
import { getDb, schema } from "../db/index.js";
import {
  reviewAgentMachine,
  type ReviewAgentEvent,
} from "./review-agent-machine.js";
import {
  classificationPrompt,
  executionPrompt,
} from "./review-agent-prompts.js";

export type ReviewAgentRow =
  typeof schema.designReviewAgentRequests.$inferSelect;
type DesignRow = typeof schema.designs.$inferSelect;

const requests = schema.designReviewAgentRequests;

/** The two scope types a request's background sessions run under. */
export const REVIEW_AGENT_SCOPE = {
  agent: "design-review-agent",
  classifier: "design-review-agent-classifier",
} as const;

/**
 * Agent thread ids carry a reserved prefix, so `resolveActionSurface` can
 * recognise a thread that belongs to a request without any lookup. The
 * classifier prefix extends the agent one on purpose: both are reserved.
 */
export const REVIEW_AGENT_THREAD_PREFIX = "design-review-agent-";
const CLASSIFIER_THREAD_PREFIX = "design-review-agent-classifier-";
const USAGE_LABEL = "design:review-agent";

const REVIEW_RESOURCE_TYPE = "design";
const THREAD_PAGE_THREADS = 50;
const THREAD_FALLBACK_COMMENTS = 500;
const RECENT_TERMINAL_WINDOW_MS = 24 * 60 * 60_000;
const LIST_LIMIT = 100;

export const reviewAgentErrors = defineActionErrors(
  "sign_in_required",
  "request_not_found",
  "thread_not_open",
  "thread_too_large",
  "trigger_comment_required",
  "trigger_comment_not_found",
  "trigger_not_requesters",
  "no_agent_mention",
  "instructions_empty",
  "instructions_too_long",
  "rate_limited",
  "operation_conflict",
  "apply_unavailable",
  "apply_incomplete",
  "apply_attempts_exhausted",
  "intent_not_permitted",
  "scope_required",
  "scope_mismatch",
  "request_not_active",
  "no_change",
  "verification_failed",
  "target_changed",
  "target_ambiguous",
  "thread_unavailable",
  "binding_missing",
  "not_classified",
);
export type ReviewAgentActionErrorCode =
  (typeof reviewAgentErrors.codes)[number];

/** Raise a typed, caller-readable failure. */
export function refuse(
  code: ReviewAgentActionErrorCode,
  message: string,
  statusCode = 400,
): never {
  return reviewAgentErrors.fail(message, code, { statusCode });
}

/** Like `refuse`, for a rejection raised before the call's first design write. */
export function refuseNoWrite(
  code: ReviewAgentActionErrorCode,
  message: string,
  statusCode = 409,
): never {
  return reviewAgentErrors.noWrite(message, code, { statusCode });
}

// ---------------------------------------------------------------------------
// Stored values: parsed on the way out, so a bad value throws instead of
// flowing on as a plausible one.
// ---------------------------------------------------------------------------

/**
 * What a failed or stopped row says. The UI localizes from the code; this is
 * the stored fallback. Typed as a record so every code in the contract has one.
 */
const ERROR_MESSAGES: Record<ReviewAgentErrorCode, string> = {
  engine_not_configured: "No AI model is connected.",
  dispatch_failed: "The agent could not be started.",
  run_failed: "The agent run failed before it finished.",
  no_result: "The agent finished without answering.",
  run_timeout: "The agent did not respond in time.",
  permission_changed: "Edit access to this design was removed.",
  thread_unavailable: "The review thread is no longer open.",
  target_changed: "The design changed while the agent worked.",
  target_ambiguous: "The requested text matches more than one place.",
  apply_unavailable: "An agent cannot edit this screen.",
  apply_incomplete:
    "The design was edited but the thread was not finished. Review the change.",
  apply_attempts_exhausted: "The agent could not apply the change.",
  cancelled_after_edit:
    "Stopped after the design was edited. Review the change.",
};

// The record has exactly the contract's codes, so its keys are the enum.
const REVIEW_AGENT_ERROR_CODES = Object.keys(ERROR_MESSAGES) as [
  ReviewAgentErrorCode,
  ...ReviewAgentErrorCode[],
];

export const reviewAgentIntentSchema = z.enum(REVIEW_AGENT_INTENTS);
export const reviewAgentModeSchema = z.enum(REVIEW_AGENT_MODES);
export const reviewAgentStatusSchema = z.enum(REVIEW_AGENT_STATUSES);
export const reviewAgentErrorCodeSchema = z.enum(REVIEW_AGENT_ERROR_CODES);

const changeSchema = z.object({
  before: z.string(),
  after: z.string(),
  truncated: z.boolean().optional(),
});

export const reviewAgentResultSchema = z.object({
  replyCommentId: z.string().optional(),
  proposal: z
    .object({
      summary: z.string(),
      editCount: z.number(),
      edits: z
        .array(z.object({ search: z.string(), replace: z.string() }))
        .optional(),
      truncated: z.boolean().optional(),
    })
    .optional(),
  editApplied: z.boolean().optional(),
  fileId: z.string().optional(),
  editsApplied: z.number().optional(),
  changes: z.array(changeSchema).optional(),
  receiptCommentId: z.string().optional(),
  resolved: z.boolean().optional(),
  applyAttempts: z.number().optional(),
  versionId: z.string().nullable().optional(),
});

export const reviewAgentPendingSessionSchema = z.object({
  phase: z.enum(["classification", "execution"]),
  operationId: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  scope: z.object({
    type: z.enum([REVIEW_AGENT_SCOPE.agent, REVIEW_AGENT_SCOPE.classifier]),
    id: z.string(),
  }),
  actionScope: z.object({
    kind: z.enum([REVIEW_AGENT_SCOPE.agent, REVIEW_AGENT_SCOPE.classifier]),
    requestId: z.string(),
  }),
  message: z.string(),
  instructions: z.string(),
  model: z.string().optional(),
  engine: z.string().optional(),
  usageLabel: z.string(),
});

export const reviewAgentRequestSchema = z.object({
  requestId: z.string(),
  designId: z.string(),
  threadId: z.string(),
  rootCommentId: z.string(),
  screenId: z.string().nullable(),
  mode: reviewAgentModeSchema,
  intent: reviewAgentIntentSchema.nullable(),
  status: reviewAgentStatusSchema,
  requesterIsMe: z.boolean(),
  model: z.string().nullable(),
  engine: z.string().nullable(),
  result: reviewAgentResultSchema.nullable(),
  errorCode: reviewAgentErrorCodeSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  instructions: z.string().nullable(),
  triggerCommentId: z.string().nullable(),
  submitted: z
    .object({
      provider: z.string().nullable(),
      model: z.string().nullable(),
      engine: z.string().nullable(),
    })
    .nullable(),
  agentThreadId: z.string().nullable(),
  agentTurnId: z.string().nullable(),
  pendingSession: reviewAgentPendingSessionSchema.nullable(),
});

export const startReviewAgentResultSchema = z.object({
  outcome: z.enum(["started", "replayed", "busy"]),
  dispatch: z.boolean(),
  request: reviewAgentRequestSchema,
  pendingSession: reviewAgentPendingSessionSchema.nullable(),
});

/** The server-resolved scope a scoped run carries; the browser never supplies it. */
export const resolvedScopeSchema = z
  .object({
    kind: z.enum([REVIEW_AGENT_SCOPE.agent, REVIEW_AGENT_SCOPE.classifier]),
    requestId: z.string().uuid(),
    phase: z.enum(["classification", "execution"]),
    intent: reviewAgentIntentSchema.nullable(),
  })
  .strict();

export const reviewAgentEditsSchema = z
  .array(
    z.object({
      search: z
        .string()
        .min(1)
        .max(REVIEW_AGENT_LIMITS.editCharsMax)
        .describe(
          "Exact text to find in the current screen file. It must match exactly and only once, so include enough surrounding context.",
        ),
      replace: z
        .string()
        .max(REVIEW_AGENT_LIMITS.editCharsMax)
        .describe("Replacement text. An empty string deletes the match."),
    }),
  )
  .min(1)
  .max(REVIEW_AGENT_LIMITS.editsMax)
  .describe("Search/replace edits for this one screen, applied in order.");

/** The stored result. One that does not parse throws; it is never read as empty. */
export function parseReviewAgentResult(
  row: Pick<ReviewAgentRow, "resultJson">,
): ReviewAgentResult | null {
  if (row.resultJson === null) return null;
  // Zod types an absent optional key as `T | undefined`, which the exact
  // contract type does not allow; the parsed value never carries such a key.
  return reviewAgentResultSchema.parse(
    JSON.parse(row.resultJson),
  ) as ReviewAgentResult;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The first row of a result, typed as possibly missing: no row is a normal answer for a lookup. */
function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

function rowStatus(row: Pick<ReviewAgentRow, "status">): ReviewAgentStatus {
  return reviewAgentMachine.parseState(row.status);
}

/** The stored code and message for a request that ended for `code`. */
export function failPatch(code: ReviewAgentErrorCode) {
  return { errorCode: code, error: ERROR_MESSAGES[code] };
}

/** A stable UUID for a seed, so a repeated call maps to the same review comment id. */
function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Access, identity, rows
// ---------------------------------------------------------------------------

export function requireRequesterEmail(): string {
  const email = getRequestUserEmail();
  if (!email) {
    return refuse(
      "sign_in_required",
      "Sign in to ask an agent about a comment.",
      401,
    );
  }
  return email;
}

export async function assertDesignEditor(
  designId: string,
): Promise<{ design: DesignRow }> {
  const access = await assertAccess("design", designId, "editor");
  return { design: access.resource as DesignRow };
}

export async function findReviewAgentRequest(
  id: string,
): Promise<ReviewAgentRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(requests)
    .where(eq(requests.id, id))
    .limit(1);
  return row;
}

export async function loadReviewAgentRequest(
  id: string,
): Promise<ReviewAgentRow> {
  const row = await findReviewAgentRequest(id);
  if (!row) return refuse("request_not_found", "Agent request not found.", 404);
  return row;
}

export async function findReviewAgentRequestsByThread(
  agentThreadId: string,
): Promise<ReviewAgentRow[]> {
  return getDb()
    .select()
    .from(requests)
    .where(
      or(
        eq(requests.agentThreadId, agentThreadId),
        eq(requests.classificationThreadId, agentThreadId),
      ),
    )
    .limit(2);
}

type RowPatch = Partial<
  Pick<
    ReviewAgentRow,
    | "intent"
    | "runId"
    | "model"
    | "engine"
    | "resultJson"
    | "errorCode"
    | "error"
  >
>;

/**
 * Compare-and-set one machine event. `undefined` means the row was not in a
 * source state for the event, because another call won or the event is not
 * legal from where the row is. Callers re-read and decide; none treats it as
 * success.
 */
export async function transitionReviewAgentRequest(
  row: ReviewAgentRow,
  event: ReviewAgentEvent,
  patch: RowPatch = {},
): Promise<ReviewAgentRow | undefined> {
  const from = rowStatus(row);
  if (!reviewAgentMachine.can(from, event)) return undefined;
  const [updated] = await getDb()
    .update(requests)
    .set({
      ...patch,
      status: reviewAgentMachine.transition(from, event),
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(requests.id, row.id),
        inArray(requests.status, [...reviewAgentMachine.fromStates(event)]),
      ),
    )
    .returning();
  return updated;
}

/** Store `result` on a row that is still active; `undefined` when it is not. */
export async function writeActiveResult(
  row: ReviewAgentRow,
  result: ReviewAgentResult,
): Promise<ReviewAgentRow | undefined> {
  const [updated] = await getDb()
    .update(requests)
    .set({ resultJson: serializeResult(result), updatedAt: nowIso() })
    .where(
      and(
        eq(requests.id, row.id),
        inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES]),
      ),
    )
    .returning();
  return updated;
}

/** Whether a result stays inside the size a row may store. */
export function resultFitsRow(result: ReviewAgentResult): boolean {
  return (
    Buffer.byteLength(JSON.stringify(result), "utf8") <=
    REVIEW_AGENT_LIMITS.resultJsonMaxBytes
  );
}

export function serializeResult(result: ReviewAgentResult): string {
  if (!resultFitsRow(result)) {
    throw new Error("A review agent result exceeded its stored size limit");
  }
  return JSON.stringify(result);
}

/**
 * Record that the design was edited. This is written whatever the row's status
 * is, because Cancel can land while the edit is in flight and the row must not
 * keep saying "stopped" over a design that changed.
 */
export async function recordEditApplied(
  row: ReviewAgentRow,
  result: ReviewAgentResult,
): Promise<ReviewAgentRow> {
  const db = getDb();
  const updated = firstRow(
    await db
      .update(requests)
      .set({ resultJson: serializeResult(result), updatedAt: nowIso() })
      .where(eq(requests.id, row.id))
      .returning(),
  );
  if (!updated) throw new Error("The agent request disappeared mid-apply");
  if (updated.status !== "cancelled") return updated;
  const repaired = firstRow(
    await db
      .update(requests)
      .set({
        status: "needs-input",
        ...failPatch("cancelled_after_edit"),
        updatedAt: nowIso(),
      })
      .where(and(eq(requests.id, row.id), eq(requests.status, "cancelled")))
      .returning(),
  );
  return repaired ?? updated;
}

async function finishRow(
  row: ReviewAgentRow,
  code: ReviewAgentErrorCode,
  event: "fail" | "needInput",
  extra: RowPatch = {},
): Promise<ReviewAgentRow | undefined> {
  return transitionReviewAgentRequest(row, event, {
    ...extra,
    ...failPatch(code),
  });
}

/**
 * Close a row that can no longer finish. A design that was already edited is a
 * result somebody must look at, so it never reads as plain failure.
 */
async function endRowAfterRun(
  row: ReviewAgentRow,
  failure: ReviewAgentErrorCode,
  extra: RowPatch = {},
): Promise<ReviewAgentRow | undefined> {
  const edited = parseReviewAgentResult(row)?.editApplied === true;
  return edited
    ? finishRow(row, "apply_incomplete", "needInput", extra)
    : finishRow(row, failure, "fail", extra);
}

/** A request nobody finished must not hold its thread forever. */
export async function expireStaleActiveRequests(scope: {
  designId: string;
  threadId?: string;
}): Promise<number> {
  const cutoff = new Date(
    Date.now() - REVIEW_AGENT_LIMITS.staleActiveMs,
  ).toISOString();
  const stale = await getDb()
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.designId, scope.designId),
        scope.threadId ? eq(requests.threadId, scope.threadId) : undefined,
        inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES]),
        lt(requests.updatedAt, cutoff),
      ),
    )
    .limit(LIST_LIMIT);
  let expired = 0;
  for (const row of stale) {
    if (await endRowAfterRun(row, "run_timeout")) expired += 1;
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Review thread
// ---------------------------------------------------------------------------

function reviewScope() {
  return {
    userEmail: getRequestUserEmail() ?? null,
    orgId: getRequestOrgId() ?? null,
  };
}

/** `null` when there is no thread, or it was deleted. A closed thread is returned as it is. */
export async function readReviewThreadRoot(
  designId: string,
  threadId: string,
): Promise<ReviewComment | null> {
  const root = await getReviewThreadRoot(
    threadId,
    { resourceType: REVIEW_RESOURCE_TYPE, resourceId: designId },
    reviewScope(),
    { bypassScope: true },
  );
  if (!root || root.deletedAt || root.status === "deleted") return null;
  return root;
}

/** The thread's comments, oldest first. A thread that cannot be read fails; it is never an empty list. */
export async function loadReviewThread(
  designId: string,
  threadId: string,
): Promise<{ root: ReviewComment; comments: ReviewComment[] }> {
  const root = await readReviewThreadRoot(designId, threadId);
  if (!root) {
    return refuse(
      "thread_unavailable",
      "This review thread no longer exists.",
      404,
    );
  }
  const query = {
    resourceType: REVIEW_RESOURCE_TYPE,
    resourceId: designId,
    scope: reviewScope(),
    bypassScope: true,
    includeResolved: true,
    targetId: root.targetId,
  };
  const inThread = (comment: ReviewComment) => comment.threadId === threadId;
  let comments = (
    await queryReviewComments({
      ...query,
      newestFirst: true,
      limit: THREAD_PAGE_THREADS,
    })
  ).filter(inThread);
  if (!comments.some((comment) => comment.id === root.id)) {
    comments = (
      await queryReviewComments({ ...query, limit: THREAD_FALLBACK_COMMENTS })
    ).filter(inThread);
  }
  if (!comments.some((comment) => comment.id === root.id)) {
    return refuse(
      "thread_unavailable",
      "This review thread could not be read.",
      404,
    );
  }
  return { root, comments };
}

// ---------------------------------------------------------------------------
// Screen facts and what the agent may do to the screen
// ---------------------------------------------------------------------------

export type ReviewAgentCapabilities =
  | { canApply: true }
  | {
      canApply: false;
      reason: "board_thread" | "no_screen_file" | "not_inline";
    };

export interface ReviewAgentScreenFacts {
  screen: { screenId: string; filename: string } | null;
  capabilities: ReviewAgentCapabilities;
}

function parseDesignData(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // coercion-ok: unreadable design data reports the screen as not editable (reason not_inline), never as editable
    return null;
  }
}

/**
 * Whether an agent may edit the thread's screen. A localhost or Builder screen
 * is stored as an html row whose content is a URL, so the file type alone does
 * not answer it.
 */
export async function reviewAgentScreenFacts(
  design: Pick<DesignRow, "id" | "data">,
  screenId: string | null,
): Promise<ReviewAgentScreenFacts> {
  if (!screenId) {
    return {
      screen: null,
      capabilities: { canApply: false, reason: "board_thread" },
    };
  }
  const file = firstRow(
    await getDb()
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        head: sql<string>`substr(${schema.designFiles.content}, 1, 2048)`,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, screenId),
          eq(schema.designFiles.designId, design.id),
        ),
      )
      .limit(1),
  );
  if (!file || file.fileType !== "html") {
    return {
      screen: null,
      capabilities: { canApply: false, reason: "no_screen_file" },
    };
  }
  const screen = { screenId: file.id, filename: file.filename };
  const data = parseDesignData(design.data);
  const screenSource = data
    ? designScreenSourceTypeFromData(data, file.id)
    : null;
  const inline =
    data !== null &&
    designSourceTypeFromData(design.data) === "inline" &&
    (screenSource === null || screenSource === "inline") &&
    !isStandaloneHttpUrl(file.head);
  return {
    screen,
    capabilities: inline
      ? { canApply: true }
      : { canApply: false, reason: "not_inline" },
  };
}

/** The screen's live content, the same text `edit-design` would edit. */
export async function readScreenFile(designId: string, fileId: string) {
  const file = firstRow(
    await getDb()
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, fileId),
          eq(schema.designFiles.designId, designId),
        ),
      )
      .limit(1),
  );
  if (!file) {
    return refuse("apply_unavailable", "The screen no longer exists.", 404);
  }
  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content: file.content,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Check an edit list against the current text, writing nothing. `edit-design`
 * reports a miss and an ambiguous match with the same type, so the two are told
 * apart by the wording of `applyOneEdit`; the spec pins that wording.
 */
export function dryRunEdits(
  base: string,
  edits: readonly DesignEdit[],
): string {
  let next: string;
  try {
    next = applySearchReplaceEdits(base, [...edits]).content;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The edits could not be applied.";
    return /matched .* places/.test(message)
      ? refuseNoWrite("target_ambiguous", message)
      : refuseNoWrite("target_changed", message);
  }
  try {
    assertLockedLayersPreserved(base, next);
  } catch (error) {
    if (error instanceof LockedLayerEditError) {
      throw new NoWriteError(error.message, {
        errorCode: error.errorCode,
        statusCode: error.statusCode,
      });
    }
    throw error;
  }
  if (next === base) {
    return refuseNoWrite("no_change", "These edits change nothing.", 400);
  }
  return next;
}

const PREVIEW_CHARS = 300;
const PREVIEW_COUNT = 5;

/** Bounded before/after text, so a card can show what changed without storing the file. */
export function previewEdits(
  edits: readonly DesignEdit[],
): NonNullable<ReviewAgentResult["changes"]> {
  return edits.slice(0, PREVIEW_COUNT).map(({ search, replace }) => ({
    before: search.slice(0, PREVIEW_CHARS),
    after: replace.slice(0, PREVIEW_CHARS),
    ...(search.length > PREVIEW_CHARS || replace.length > PREVIEW_CHARS
      ? { truncated: true }
      : {}),
  }));
}

// ---------------------------------------------------------------------------
// Agent-authored comments
// ---------------------------------------------------------------------------

const MENTION_MARKUP = /@\[([^\]]+)\]\(mailto:[^)]*\)/g;

/**
 * Review text carrying `@[name](mailto:…)` becomes a mention that routes the
 * thread to a person and emails them. An agent reading untrusted comments must
 * not be able to mention anyone, so the markup is flattened to plain text.
 */
export function withoutMentionMarkup(body: string): string {
  return body.replace(MENTION_MARKUP, "@$1");
}

/**
 * Post a reply on the request's thread as the agent: `createdBy` is derived
 * from the `tool` caller and the author name is the model that ran. The
 * comment id comes from the request id, so a repeated call posts once.
 */
export async function postReviewAgentComment(args: {
  row: ReviewAgentRow;
  ctx: ActionRunContext | undefined;
  run: RequestRunContext | undefined;
  kind: "reply" | "proposal" | "receipt";
  body: string;
  metadata?: Record<string, unknown>;
  routeToHuman?: boolean;
}): Promise<{ commentId: string }> {
  const { row, run } = args;
  const reply = await replyReviewComment.run(
    {
      resourceType: REVIEW_RESOURCE_TYPE,
      resourceId: row.designId,
      commentId: row.rootCommentId,
      body: withoutMentionMarkup(args.body),
      authorName: reviewAgentAuthorName(
        run?.model ?? row.model ?? row.submittedModel,
      ),
      ...(args.routeToHuman ? { resolutionTarget: "human" as const } : {}),
      metadata: {
        agentRequest: { id: row.id, kind: args.kind, ...args.metadata },
      },
      clientOperationId: deterministicUuid(`${row.id}:${args.kind}`),
    },
    toolContext(row, args.ctx),
  );
  return { commentId: reply.id };
}

/**
 * Resolve the request's thread. Resolving a thread that is already resolved
 * succeeds, so a retry after a partial apply only repeats this safely.
 */
export async function resolveReviewAgentThread(
  row: ReviewAgentRow,
  ctx: ActionRunContext | undefined,
): Promise<void> {
  await resolveReviewThread.run(
    {
      resourceType: REVIEW_RESOURCE_TYPE,
      resourceId: row.designId,
      threadId: row.threadId,
      status: "resolved",
    },
    toolContext(row, ctx),
  );
}

/**
 * Core's review actions read the caller from the context. Inside a run that is
 * `tool`, which is what stamps a comment as the agent's; a local-shell
 * simulation arrives as `cli` and would stamp it as the requester's, so the
 * caller is pinned here and a simulated run writes what a real one writes. The
 * requester, who was just verified, is the identity access is checked against.
 */
function toolContext(
  row: ReviewAgentRow,
  ctx: ActionRunContext | undefined,
): ActionRunContext {
  return {
    ...ctx,
    caller: "tool",
    userEmail: row.requesterEmail,
    orgId: getRequestOrgId() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** The session a browser must dispatch for this row, or `null` when none is owed. */
export function pendingSessionFor(
  row: ReviewAgentRow,
): ReviewAgentPendingSession | null {
  const status = rowStatus(row);
  const modelOptions = {
    ...(row.submittedModel ? { model: row.submittedModel } : {}),
    ...(row.submittedEngine ? { engine: row.submittedEngine } : {}),
  };
  if (status === "classifying") {
    if (!row.classificationThreadId || !row.classificationTurnId) {
      throw new Error("A classifying request has no classifier session");
    }
    const prompt = classificationPrompt({ instructions: row.instructions });
    return {
      phase: "classification",
      operationId: `${row.id}:classification`,
      threadId: row.classificationThreadId,
      turnId: row.classificationTurnId,
      scope: { type: REVIEW_AGENT_SCOPE.classifier, id: row.id },
      actionScope: { kind: REVIEW_AGENT_SCOPE.classifier, requestId: row.id },
      ...prompt,
      ...modelOptions,
      usageLabel: USAGE_LABEL,
    };
  }
  if (status === "queued" && row.runId === null) {
    if (!row.agentThreadId || !row.agentTurnId || row.intent === null) {
      throw new Error("A queued request has no execution session");
    }
    const prompt = executionPrompt({
      intent: reviewAgentIntentSchema.parse(row.intent),
      instructions: row.instructions,
    });
    return {
      phase: "execution",
      operationId: row.id,
      threadId: row.agentThreadId,
      turnId: row.agentTurnId,
      scope: { type: REVIEW_AGENT_SCOPE.agent, id: row.id },
      actionScope: { kind: REVIEW_AGENT_SCOPE.agent, requestId: row.id },
      ...prompt,
      ...modelOptions,
      usageLabel: USAGE_LABEL,
    };
  }
  return null;
}

/** What `viewerEmail` may see of a request. Only the requester gets the private fields. */
export function serializeReviewAgentRequest(
  row: ReviewAgentRow,
  viewerEmail: string | null,
): ReviewAgentRequest {
  const mine = viewerEmail !== null && row.requesterEmail === viewerEmail;
  return {
    requestId: row.id,
    designId: row.designId,
    threadId: row.threadId,
    rootCommentId: row.rootCommentId,
    screenId: row.screenId,
    mode: reviewAgentModeSchema.parse(row.submittedMode),
    intent:
      row.intent === null ? null : reviewAgentIntentSchema.parse(row.intent),
    status: rowStatus(row),
    requesterIsMe: mine,
    model: row.model ?? row.submittedModel,
    engine: row.engine ?? row.submittedEngine,
    result: parseReviewAgentResult(row),
    errorCode:
      row.errorCode === null
        ? null
        : reviewAgentErrorCodeSchema.parse(row.errorCode),
    error: row.error === null ? null : row.error.slice(0, 500),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    instructions: mine ? row.instructions : null,
    triggerCommentId: mine ? row.triggerCommentId : null,
    submitted: mine
      ? {
          provider: row.submittedProvider,
          model: row.submittedModel,
          engine: row.submittedEngine,
        }
      : null,
    agentThreadId: mine ? row.agentThreadId : null,
    agentTurnId: mine ? row.agentTurnId : null,
    pendingSession: mine ? pendingSessionFor(row) : null,
  };
}

// ---------------------------------------------------------------------------
// Start, list, cancel, reconcile
// ---------------------------------------------------------------------------

export interface StartReviewAgentArgs {
  requestId: string;
  designId: string;
  threadId: string;
  mode: ReviewAgentMode;
  triggerCommentId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  engine?: string | undefined;
}

const REPROMPT_MARKERS = new Set([
  "[Reprompt selection]",
  "[Selection question]",
]);

/**
 * The requester's own words, read from the stored comment. Design treats a
 * thread whose text carries a reprompt marker as preview-only and would refuse
 * this run's edits, so those lines are dropped rather than left to confuse it.
 */
export function normalizeInstructions(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !REPROMPT_MARKERS.has(line.trim()))
    .join("\n")
    .trim();
  if (!normalized) {
    return refuse(
      "instructions_empty",
      "The comment has no instruction for the agent.",
    );
  }
  if (normalized.length > REVIEW_AGENT_LIMITS.instructionsMax) {
    return refuse(
      "instructions_too_long",
      `Keep the instruction under ${REVIEW_AGENT_LIMITS.instructionsMax} characters.`,
    );
  }
  return normalized;
}

function submissionOf(args: StartReviewAgentArgs) {
  return {
    provider: args.provider ?? null,
    model: args.model ?? null,
    engine: args.engine ?? null,
    triggerCommentId: args.triggerCommentId ?? null,
  };
}

function sameSubmission(row: ReviewAgentRow, args: StartReviewAgentArgs) {
  const submitted = submissionOf(args);
  return (
    row.designId === args.designId &&
    row.threadId === args.threadId &&
    row.submittedMode === args.mode &&
    row.triggerCommentId === submitted.triggerCommentId &&
    row.submittedProvider === submitted.provider &&
    row.submittedModel === submitted.model &&
    row.submittedEngine === submitted.engine
  );
}

function startResult(
  outcome: StartReviewAgentResult["outcome"],
  row: ReviewAgentRow,
  email: string,
): StartReviewAgentResult {
  const request = serializeReviewAgentRequest(row, email);
  return {
    outcome,
    dispatch: request.pendingSession !== null,
    request,
    pendingSession: request.pendingSession,
  };
}

async function countRows(condition: ReturnType<typeof and>): Promise<number> {
  const row = firstRow(
    await getDb()
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(requests)
      .where(condition)
      .limit(1),
  );
  // An aggregate without GROUP BY always yields one row.
  if (!row) throw new Error("A count query returned no row");
  return row.count;
}

export async function startReviewAgentRequest(
  args: StartReviewAgentArgs,
): Promise<StartReviewAgentResult> {
  const email = requireRequesterEmail();
  const { design } = await assertDesignEditor(args.designId);
  await expireStaleActiveRequests({
    designId: args.designId,
    threadId: args.threadId,
  });

  // A retry of the same submission replays, even if the run has since finished
  // and closed the thread, so this comes before the checks on the thread.
  const existing = await findReviewAgentRequest(args.requestId);
  if (existing) {
    if (existing.requesterEmail !== email) {
      return refuse("request_not_found", "Agent request not found.", 404);
    }
    if (!sameSubmission(existing, args)) {
      return refuse(
        "operation_conflict",
        "This request id is already used for a different submission.",
        409,
      );
    }
    return startResult("replayed", existing, email);
  }

  const { root, comments } = await loadReviewThread(
    args.designId,
    args.threadId,
  );
  if (root.status !== "open") {
    return refuse("thread_not_open", "Reopen the thread to ask an agent.", 409);
  }

  let instructions: string;
  let intent: ReviewAgentIntent | null = null;
  if (args.mode === "auto") {
    if (!args.triggerCommentId) {
      return refuse(
        "trigger_comment_required",
        "Pass the comment that mentions the agent.",
      );
    }
    const trigger = comments.find(
      (comment) => comment.id === args.triggerCommentId,
    );
    if (!trigger) {
      return refuse(
        "trigger_comment_not_found",
        "That comment is not in this thread.",
        404,
      );
    }
    if (
      trigger.createdBy !== "human" ||
      trigger.authorEmail?.toLowerCase() !== email.toLowerCase()
    ) {
      return refuse(
        "trigger_not_requesters",
        "Only your own comment can start an agent.",
        403,
      );
    }
    if (!trigger.mentions.some((mention) => mention.id?.startsWith("agent:"))) {
      return refuse(
        "no_agent_mention",
        "That comment does not mention an agent.",
      );
    }
    instructions = normalizeInstructions(trigger.body);
  } else {
    intent = args.mode;
    instructions = REVIEW_AGENT_DEFAULT_INSTRUCTIONS[intent];
    if (intent === "apply-resolve") {
      const { capabilities } = await reviewAgentScreenFacts(
        design,
        root.targetId,
      );
      if (!capabilities.canApply) {
        return refuse(
          "apply_unavailable",
          "An agent cannot edit this screen.",
          400,
        );
      }
    }
  }

  const threadChars = comments.reduce((size, c) => size + c.body.length, 0);
  if (
    comments.length > REVIEW_AGENT_LIMITS.threadCommentsMax ||
    threadChars > REVIEW_AGENT_LIMITS.threadCharsMax
  ) {
    return refuse(
      "thread_too_large",
      "This conversation is too long for an agent. Start a new thread.",
    );
  }

  const mine = and(
    eq(requests.designId, args.designId),
    eq(requests.requesterEmail, email),
  );
  const active = await countRows(
    and(mine, inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES])),
  );
  const lastHour = await countRows(
    and(
      mine,
      gte(requests.createdAt, new Date(Date.now() - 60 * 60_000).toISOString()),
    ),
  );
  if (
    active >= REVIEW_AGENT_LIMITS.maxActivePerRequester ||
    lastHour >= REVIEW_AGENT_LIMITS.maxStartsPerHour
  ) {
    return refuse(
      "rate_limited",
      "Too many agent requests on this design. Try again later.",
      429,
    );
  }

  const classify = args.mode === "auto";
  const agentThreadId = `${REVIEW_AGENT_THREAD_PREFIX}${crypto.randomUUID()}`;
  const classificationThreadId = classify
    ? `${CLASSIFIER_THREAD_PREFIX}${crypto.randomUUID()}`
    : null;
  const submitted = submissionOf(args);
  const now = nowIso();
  const inserted = firstRow(
    await getDb()
      .insert(requests)
      .values({
        id: args.requestId,
        designId: args.designId,
        threadId: args.threadId,
        rootCommentId: root.id,
        triggerCommentId: submitted.triggerCommentId,
        screenId: root.targetId,
        requesterEmail: email,
        submittedMode: args.mode,
        intent,
        instructions,
        submittedProvider: submitted.provider,
        submittedModel: submitted.model,
        submittedEngine: submitted.engine,
        status: classify ? "classifying" : "queued",
        classificationThreadId,
        classificationTurnId: classificationThreadId
          ? backgroundAgentTurnIdForReceipt(
              classificationThreadId,
              `${args.requestId}:classification`,
            )
          : null,
        agentThreadId,
        agentTurnId: backgroundAgentTurnIdForReceipt(
          agentThreadId,
          args.requestId,
        ),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning(),
  );
  if (inserted) return startResult("started", inserted, email);

  // The insert lost a race: the same id already landed, or another request
  // holds the thread. Show whichever it is; neither is an error.
  const winner = await findReviewAgentRequest(args.requestId);
  if (winner) {
    if (winner.requesterEmail !== email) {
      return refuse("request_not_found", "Agent request not found.", 404);
    }
    if (!sameSubmission(winner, args)) {
      return refuse(
        "operation_conflict",
        "This request id is already used for a different submission.",
        409,
      );
    }
    return startResult("replayed", winner, email);
  }
  const holder = firstRow(
    await getDb()
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.designId, args.designId),
          eq(requests.threadId, args.threadId),
          inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES]),
        ),
      )
      .limit(1),
  );
  if (!holder) {
    return refuse(
      "operation_conflict",
      "The request could not be recorded. Try again.",
      409,
    );
  }
  return startResult("busy", holder, email);
}

export async function listReviewAgentRequests(args: {
  designId: string;
  threadId?: string | undefined;
}): Promise<{ requests: ReviewAgentRequest[] }> {
  const email = requireRequesterEmail();
  await assertAccess("design", args.designId, "viewer");
  await expireStaleActiveRequests({ designId: args.designId });
  const recent = new Date(Date.now() - RECENT_TERMINAL_WINDOW_MS).toISOString();
  const rows = await getDb()
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.designId, args.designId),
        args.threadId ? eq(requests.threadId, args.threadId) : undefined,
        or(
          inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES]),
          gte(requests.updatedAt, recent),
        ),
      ),
    )
    .orderBy(desc(requests.updatedAt))
    .limit(LIST_LIMIT);
  return {
    requests: rows.map((row) => serializeReviewAgentRequest(row, email)),
  };
}

export async function cancelReviewAgentRequest(args: {
  requestId: string;
}): Promise<{
  request: ReviewAgentRequest;
  receipt: { threadId: string; turnId: string } | null;
  changed: boolean;
}> {
  const email = requireRequesterEmail();
  const row = await loadReviewAgentRequest(args.requestId);
  if (row.requesterEmail !== email) {
    return refuse("request_not_found", "Agent request not found.", 404);
  }
  await assertDesignEditor(row.designId);
  if (!isReviewAgentActive(rowStatus(row))) {
    return {
      request: serializeReviewAgentRequest(row, email),
      receipt: null,
      changed: false,
    };
  }
  // The design was already edited, so "cancelled" would say it was not.
  const edited = parseReviewAgentResult(row)?.editApplied === true;
  const updated = await (edited
    ? finishRow(row, "cancelled_after_edit", "needInput")
    : transitionReviewAgentRequest(row, "cancel"));
  if (!updated) {
    // Another call finished the row first. Report what it is now.
    const current = await loadReviewAgentRequest(row.id);
    if (isReviewAgentActive(rowStatus(current))) {
      return refuse(
        "operation_conflict",
        "The request changed while it was being cancelled. Try again.",
        409,
      );
    }
    return {
      request: serializeReviewAgentRequest(current, email),
      receipt: null,
      changed: false,
    };
  }
  const classifying = rowStatus(row) === "classifying";
  const threadId = classifying ? row.classificationThreadId : row.agentThreadId;
  const turnId = classifying ? row.classificationTurnId : row.agentTurnId;
  return {
    request: serializeReviewAgentRequest(updated, email),
    receipt: threadId && turnId ? { threadId, turnId } : null,
    changed: true,
  };
}

export type ReviewAgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "truncated"
  | "errored"
  | "aborted"
  | "unavailable";

/**
 * Turn what a run did into what the request is, once the run has ended. This
 * only ever produces `failed`, `cancelled` or `needs-input`: a success status
 * is written by the scoped action that did the work, never inferred here.
 */
export async function reconcileReviewAgentRun(input: {
  requestId: string;
  phase: "classification" | "execution";
  status: ReviewAgentRunStatus;
  runId?: string | undefined;
  /** Present from the server hook; verified against the row's bound session. */
  run?: { threadId: string; turnId: string } | undefined;
  /** A dispatch failure the browser saw before any run existed. */
  clientErrorCode?: "engine_not_configured" | "dispatch_failed" | undefined;
  /** Present from the browser action: the row must belong to the caller. */
  requesterEmail?: string | undefined;
}): Promise<ReviewAgentRow> {
  const row = await loadReviewAgentRequest(input.requestId);
  if (input.requesterEmail && row.requesterEmail !== input.requesterEmail) {
    return refuse("request_not_found", "Agent request not found.", 404);
  }
  const classification = input.phase === "classification";
  if (input.run) {
    const threadId = classification
      ? row.classificationThreadId
      : row.agentThreadId;
    const turnId = classification ? row.classificationTurnId : row.agentTurnId;
    if (input.run.threadId !== threadId || input.run.turnId !== turnId) {
      return refuse(
        "scope_mismatch",
        "This run is not bound to the request.",
        409,
      );
    }
  }
  const status = rowStatus(row);
  // A run that belongs to the other phase says nothing about this row.
  const phaseMatches = classification
    ? status === "classifying"
    : status === "queued" || status === "running";
  if (!phaseMatches) return row;

  const stamp: RowPatch =
    input.runId && row.runId === null ? { runId: input.runId } : {};
  let updated: ReviewAgentRow | undefined;
  switch (input.status) {
    case "queued":
    case "running":
    case "unavailable":
      return row;
    case "completed":
    case "truncated":
      updated = await endRowAfterRun(row, "no_result", stamp);
      break;
    case "errored":
      updated = await endRowAfterRun(
        row,
        input.clientErrorCode ?? "run_failed",
        stamp,
      );
      break;
    case "aborted":
      updated =
        parseReviewAgentResult(row)?.editApplied === true
          ? await finishRow(row, "cancelled_after_edit", "needInput", stamp)
          : await transitionReviewAgentRequest(row, "cancel", stamp);
      break;
  }
  // A lost race means another call already closed the row; report it as it is.
  return updated ?? loadReviewAgentRequest(row.id);
}

// ---------------------------------------------------------------------------
// Scoped runs
// ---------------------------------------------------------------------------

export interface ScopedRequestOptions {
  ctx: ActionRunContext | undefined;
  /** The phase the calling action serves; `either` is for the read-only context. */
  phase: "classification" | "execution" | "either";
  /** Intents the calling action serves. Omit when any intent may call it. */
  intents?: readonly ReviewAgentIntent[] | undefined;
  /** Local development shell only; a run's own scope always wins. */
  argsRequestId?: string | undefined;
  /** Terminal statuses in which a repeated call is a replay, not a refusal. */
  replayStatuses?: readonly ReviewAgentStatus[] | undefined;
  /** Read-only callers may look at a request that already finished. */
  allowTerminal?: boolean | undefined;
}

export interface ScopedRequest {
  row: ReviewAgentRow;
  design: DesignRow;
  run: RequestRunContext | undefined;
  /** The request already ended in one of `replayStatuses`. */
  replay: boolean;
}

/**
 * The one gate every scoped action passes through. It trusts the scope the
 * server resolved for this run, never an argument, and re-checks the live
 * state: who the requester is, that they can still edit, that the thread is
 * still open, and that the request is still active, which is what makes Cancel
 * immediate.
 */
export async function requireScopedRequest(
  options: ScopedRequestOptions,
): Promise<ScopedRequest> {
  const email = requireRequesterEmail();
  const run = getRequestRunContext();
  const resolved = run?.actionScope
    ? resolvedScopeSchema.safeParse(run.actionScope)
    : undefined;
  if (resolved && !resolved.success) {
    return refuse(
      "scope_mismatch",
      "This run's scope is not a review agent scope.",
      403,
    );
  }
  let requestId: string;
  let scopedPhase: "classification" | "execution" | null = null;
  if (resolved) {
    requestId = resolved.data.requestId;
    scopedPhase = resolved.data.phase;
    const kindForPhase =
      scopedPhase === "classification"
        ? REVIEW_AGENT_SCOPE.classifier
        : REVIEW_AGENT_SCOPE.agent;
    if (
      (options.argsRequestId && options.argsRequestId !== requestId) ||
      (options.phase !== "either" && options.phase !== scopedPhase) ||
      resolved.data.kind !== kindForPhase
    ) {
      return refuse(
        "scope_mismatch",
        "This action does not belong to this run's request.",
        403,
      );
    }
  } else if (options.ctx?.caller === "cli" && options.argsRequestId) {
    requestId = options.argsRequestId;
  } else {
    return refuse(
      "scope_required",
      "Only available inside a comment-started agent run.",
      403,
    );
  }

  const row = await findReviewAgentRequest(requestId);
  if (!row) {
    return refuse("binding_missing", "This run has no agent request.", 409);
  }
  if (row.requesterEmail !== email) {
    return refuse(
      "scope_mismatch",
      "This request belongs to someone else.",
      403,
    );
  }
  const status = rowStatus(row);
  const active = isReviewAgentActive(status);
  // The development shell has no run to read the phase from, so it is the
  // action's own, or for the context read, the one the row is waiting in.
  const phase: "classification" | "execution" =
    scopedPhase ??
    (options.phase === "either"
      ? status === "classifying"
        ? "classification"
        : "execution"
      : options.phase);
  if (resolved) {
    const bound =
      phase === "classification"
        ? row.classificationThreadId
        : row.agentThreadId;
    const runThread = run?.threadId ?? options.ctx?.threadId;
    if (!bound || runThread !== bound) {
      return refuse(
        "scope_mismatch",
        "This run's thread is not bound to the request.",
        403,
      );
    }
  }

  let design: DesignRow;
  try {
    ({ design } = await assertDesignEditor(row.designId));
  } catch (error) {
    if (error instanceof ForbiddenError && active) {
      await finishRow(row, "permission_changed", "fail");
    }
    throw error;
  }

  if (!active) {
    if (options.replayStatuses?.includes(status)) {
      return { row, design, run, replay: true };
    }
    if (options.allowTerminal) return { row, design, run, replay: false };
    return refuse(
      "request_not_active",
      "This agent request already ended.",
      409,
    );
  }
  if (phase === "execution") {
    if (status === "classifying" || row.intent === null) {
      return refuse(
        "not_classified",
        "This request has not been classified yet.",
        409,
      );
    }
    if (
      options.intents &&
      !options.intents.includes(reviewAgentIntentSchema.parse(row.intent))
    ) {
      return refuse(
        "intent_not_permitted",
        "This request's intent does not allow that action.",
        403,
      );
    }
  }

  const root = await readReviewThreadRoot(row.designId, row.threadId);
  if (!root) {
    await finishRow(row, "thread_unavailable", "fail");
    return refuse(
      "thread_unavailable",
      "This review thread no longer exists.",
      404,
    );
  }
  if (root.status !== "open") {
    await finishRow(row, "thread_unavailable", "needInput");
    return refuse("thread_unavailable", "This review thread was closed.", 409);
  }

  // Only the execution run is recorded on the row: `run_id` is also how a
  // browser tells that the execution session is already underway, and the
  // classifier's run must not look like it.
  const stamp: RowPatch =
    phase === "execution"
      ? {
          ...(run?.runId ? { runId: run.runId } : {}),
          ...(run?.model?.trim()
            ? { model: run.model.trim().slice(0, 120) }
            : {}),
          ...(run?.engine?.name ? { engine: run.engine.name } : {}),
        }
      : {};
  if (status === "queued" && phase === "execution") {
    const begun = await transitionReviewAgentRequest(row, "begin", stamp);
    if (begun) return { row: begun, design, run, replay: false };
    const current = await loadReviewAgentRequest(row.id);
    if (!isReviewAgentActive(rowStatus(current))) {
      return refuse(
        "request_not_active",
        "This agent request already ended.",
        409,
      );
    }
    return { row: current, design, run, replay: false };
  }
  if (Object.keys(stamp).length > 0) {
    const stamped = firstRow(
      await getDb()
        .update(requests)
        .set({ ...stamp, updatedAt: nowIso() })
        .where(
          and(
            eq(requests.id, row.id),
            inArray(requests.status, [...REVIEW_AGENT_ACTIVE_STATUSES]),
          ),
        )
        .returning(),
    );
    if (stamped) return { row: stamped, design, run, replay: false };
  }
  return { row, design, run, replay: false };
}
