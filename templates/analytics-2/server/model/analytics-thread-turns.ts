import { fail, isActionContractError } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import {
  abortTurnByRefDurably,
  getCurrentTurnRunEventsForThread,
  getQueuedSubmissionReceipt,
  getRequestContext,
  getRequestRunContext,
  getRunStatus,
  getRunTurnRef,
  mutateThreadQueuedMessages,
  QueuedSubmissionAdmissionError,
} from "@agent-native/core/server";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
} from "drizzle-orm";
import { readBody } from "h3";
import { z } from "zod";

import { askLifecycleErrors as copy } from "../../app/i18n/messages/ask-lifecycle-errors.js";
import {
  stopThreadReceipt,
  threadTurnReceipt,
  type AnalyticsPrompt,
  type recordUploadInput,
  type stopThreadInput,
  type submitThreadTurnInput,
} from "../../shared/analytics-thread.js";
import { getDb, schema } from "../db/index.js";
import {
  analyticsThreadBootstraps as bootstraps,
  analyticsThreadReceipts as operations,
  analyticsThreadTurns as turns,
} from "../db/schema.js";
import { assertGrantedDataConnection } from "../lib/project-action-access.js";
import {
  admissionUnreadable,
  intentMismatch,
  intentFingerprint,
  readAnalyticsThreadBinding,
  readStartReceipt,
  requireAskProvider,
  requireOwnedAnalyticsThread,
  type BoundAnalyticsThread,
} from "./analytics-thread-bootstrap.js";
import { nowIso } from "./clock.js";
import { notebookRunWork, notebookRuns } from "./notebook-execution/schema.js";
import { threadNamespace } from "./notebook-execution/thread-snapshot.js";
import { getReadableProjectRow } from "./project-access.js";
import { getOwnedProjectFileMetadata } from "./project-files.js";
import type { Queryable } from "./scope.js";
import type { NotebookThreadScope } from "./thread-projects.js";

let scheduleDrain: ((threadId: string) => void) | undefined;
export function connectAnalyticsThreadQueue(
  requestDrain: (threadId: string) => void,
) {
  scheduleDrain = requestDrain;
}

const queuedContext = z.object({
  analyticsContext: z.object({
    files: z
      .array(z.object({ id: z.uuid(), filename: z.string().max(255) }))
      .max(10),
    sourceIds: z.array(z.string().min(1).max(128)).max(40),
  }),
});

export async function prepareAnalyticsThreadContext({
  event,
  ownerEmail,
  threadId,
  agentKitMessageId,
}: {
  event: Parameters<typeof readBody>[0];
  ownerEmail: string | null;
  threadId?: string;
  agentKitMessageId?: string;
}) {
  const orgId = getRequestContext()?.orgId;
  if (!ownerEmail || !orgId || !threadId) return;
  const bound = await readAnalyticsThreadBinding(
    { ownerEmail, orgId, appId: "analytics-2" },
    threadId,
  );
  if (!bound || bound.bootstrap.ownerId !== ownerEmail) return;
  const injected = (
    event as unknown as { context?: { __agentChatBackgroundBody?: unknown } }
  ).context?.__agentChatBackgroundBody;
  const body: unknown = injected ?? (await readBody(event));
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const messageId = agentKitMessageId ?? bodyRecord?.queuedMessageId;
  const queued =
    typeof messageId === "string"
      ? await getQueuedSubmissionReceipt(threadId, messageId)
      : null;
  const scoped =
    queued?.actor.email === ownerEmail && queued.actor.orgId === orgId;
  const tabId = scoped
    ? queued.message?.metadata?.analyticsBrowserTabId
    : undefined;
  if (typeof tabId === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(tabId)) {
    const run = getRequestRunContext();
    if (run) run.browserTabId = tabId;
    if (bodyRecord) bodyRecord.browserTabId = tabId;
  }
  const parsed = queuedContext.safeParse(
    scoped ? queued.message?.metadata : undefined,
  );
  const note = `This conversation is bound to project ${bound.project.id} and thread ${threadId}.`;
  if (!parsed.success) return { contextNote: note };
  const { files, sourceIds } = parsed.data.analyticsContext;
  return {
    contextNote: [
      note,
      ...(sourceIds.length
        ? [`User-selected data source IDs: ${JSON.stringify(sourceIds)}.`]
        : []),
      ...(files.length
        ? [
            `Private project files selected by the user: ${JSON.stringify(files)}. Read them by ID with get-project-file and the bound project ID.`,
          ]
        : []),
    ].join("\n"),
  };
}

function sourceDenied(): never {
  return fail(copy.sourceDenied, {
    statusCode: 403,
    errorCode: "source_denied",
  });
}

function attachmentsPending(): never {
  return fail(copy.sendFailed, {
    statusCode: 409,
    errorCode: "attachments_pending",
  });
}

export async function lockThreadBootstrap(db: Queryable, bindingId: string) {
  const [row] = await db
    .select()
    .from(bootstraps)
    .where(eq(bootstraps.bindingId, bindingId))
    .limit(1)
    .for("update");
  return row ?? admissionUnreadable();
}

async function verifyThreadPrompt(
  scope: NotebookThreadScope,
  bound: BoundAnalyticsThread,
  prompt: AnalyticsPrompt,
) {
  const files = [];
  for (const attachmentId of prompt.attachmentIds) {
    const upload = bound.bootstrap.uploads.find(
      ({ uploadId }) => uploadId === attachmentId,
    );
    if (upload && (upload.state !== "ready" || !upload.fileId))
      attachmentsPending();
    const fileId = upload?.fileId ?? attachmentId;
    const file = await getOwnedProjectFileMetadata(
      scope.ownerEmail,
      scope.orgId,
      bound.project.id,
      fileId,
    );
    if (!file) attachmentsPending();
    files.push(file);
  }
  const sourceIds = await verifyPromptSources(scope, prompt);
  return { files, sourceIds };
}

export async function verifyInitialThreadPrompt(
  scope: NotebookThreadScope,
  prompt: AnalyticsPrompt,
) {
  if (prompt.attachmentIds.length) attachmentsPending();
  await verifyPromptSources(scope, prompt);
}

async function verifyPromptSources(
  scope: NotebookThreadScope,
  prompt: AnalyticsPrompt,
) {
  const sourceIds = new Set(prompt.sourceIds);
  for (const mention of prompt.mentions) {
    if (mention.kind === "model") sourceDenied();
    if (mention.kind === "table") {
      const { getDataTableDetails } = await import("./data-table-details.js");
      try {
        await getDataTableDetails(
          { connectionId: mention.sourceId, tableId: mention.tableId },
          "frontend",
        );
      } catch (error) {
        if (isActionContractError(error) && error.statusCode < 500)
          sourceDenied();
        throw error;
      }
      sourceIds.add(mention.sourceId);
      continue;
    }
    const project = await getReadableProjectRow(scope, mention.projectId);
    if (!project || project.trashedAt !== null) sourceDenied();
    if (mention.kind === "cell") {
      const [cell] = await getDb()
        .select({ id: schema.cells.id })
        .from(schema.cells)
        .where(
          and(
            eq(schema.cells.projectId, project.id),
            eq(schema.cells.versionId, project.workingVersionId),
            eq(schema.cells.id, mention.cellId),
          ),
        )
        .limit(1);
      if (!cell || project.ownerEmail !== scope.ownerEmail) sourceDenied();
    }
  }
  for (const id of sourceIds) {
    try {
      await assertGrantedDataConnection(id);
    } catch (error) {
      if (isActionContractError(error) && error.statusCode < 500)
        sourceDenied();
      throw error;
    }
  }
  return [...sourceIds];
}

export async function recordAnalyticsThreadUpload(
  scope: NotebookThreadScope,
  input: z.infer<typeof recordUploadInput>,
) {
  const bound = await requireOwnedAnalyticsThread(scope, input.threadId);
  const upload = bound.bootstrap.uploads.find(
    ({ uploadId }) => uploadId === input.uploadId,
  );
  if (!upload) threadUploadNotFound();
  const file =
    input.attachment === null
      ? null
      : await getOwnedProjectFileMetadata(
          scope.ownerEmail,
          scope.orgId,
          bound.project.id,
          input.attachment,
        );
  if (
    input.attachment !== null &&
    (!file ||
      file.filename !== upload.name ||
      file.bytes !== upload.byteLength ||
      file.mimeType !== upload.mime)
  )
    sourceDenied();
  return getDb().transaction(async (tx) => {
    const bootstrap = await lockThreadBootstrap(tx, bound.binding.id);
    const prior = bootstrap.uploads.find(
      (slot) => slot.uploadId === input.uploadId,
    );
    if (prior?.state === "ready" && file && prior.fileId !== file.id)
      intentMismatch();
    const uploads = bootstrap.uploads.map((slot) =>
      slot.uploadId !== input.uploadId || slot.state === "ready"
        ? slot
        : file
          ? { ...slot, state: "ready" as const, fileId: file.id }
          : { ...slot, state: "failed" as const },
    );
    const phase =
      bootstrap.phase === "submitted"
        ? "submitted"
        : uploads.every((slot) => slot.state === "ready")
          ? "ready"
          : "awaiting_upload";
    await tx
      .update(bootstraps)
      .set({ uploads, phase, updatedAt: nowIso() })
      .where(eq(bootstraps.bindingId, bound.binding.id));
    return readStartReceipt({ ...bootstrap, uploads, phase }, tx);
  });
}

function threadUploadNotFound(): never {
  return fail(copy.attachmentNotFound, {
    statusCode: 404,
    errorCode: "thread_not_found",
  });
}

const turnKey = (bindingId: string, messageId: string) =>
  and(eq(turns.bindingId, bindingId), eq(turns.messageId, messageId));

export async function submitAnalyticsThreadTurn(
  scope: NotebookThreadScope,
  input: z.infer<typeof submitThreadTurnInput>,
) {
  const bound = await requireOwnedAnalyticsThread(scope, input.threadId);
  const key = turnKey(bound.binding.id, input.messageId);
  const digest = intentFingerprint(input.prompt);
  const db = getDb();
  const [prior] = await db.select().from(turns).where(key).limit(1);
  if (prior?.fingerprint !== undefined && prior.fingerprint !== digest)
    intentMismatch();
  if (prior?.receipt) {
    scheduleDrain?.(input.threadId);
    return threadTurnReceipt.parse(prior.receipt);
  }
  await requireAskProvider(input.prompt.text);
  const verified = await verifyThreadPrompt(scope, bound, input.prompt);
  const context = getRequestContext();
  const receipt = await db.transaction(async (tx) => {
    const bootstrap = await lockThreadBootstrap(tx, bound.binding.id);
    let [turn] = await tx.select().from(turns).where(key).limit(1);
    if (turn && turn.fingerprint !== digest) intentMismatch();
    if (!turn) {
      if (
        bootstrap.phase !== "submitted" &&
        bootstrap.initialMessageId !== null &&
        bootstrap.initialMessageId !== input.messageId
      )
        intentMismatch();
      const [last] = await tx
        .select({ sequence: turns.sequence, sourceIds: turns.sourceIds })
        .from(turns)
        .where(eq(turns.bindingId, bound.binding.id))
        .orderBy(desc(turns.sequence))
        .limit(1);
      [turn] = await tx
        .insert(turns)
        .values({
          bindingId: bound.binding.id,
          messageId: input.messageId,
          sequence: (last?.sequence ?? 0n) + 1n,
          fingerprint: digest,
          prompt: input.prompt,
          sourceIds: [
            ...new Set([...(last?.sourceIds ?? []), ...verified.sourceIds]),
          ],
          privateContext:
            verified.files.length > 0 ||
            input.prompt.mentions.some(
              (mention) =>
                "projectId" in mention &&
                mention.projectId !== bound.project.id,
            ),
          createdAt: nowIso(),
        })
        .returning();
    }
    if (!turn) return admissionUnreadable();
    if (turn.receipt) return threadTurnReceipt.parse(turn.receipt);
    if (turn.stoppedAt)
      return receiptForTurn(input.threadId, turn, "stopped", null);
    const core = await getQueuedSubmissionReceipt(
      input.threadId,
      input.messageId,
    );
    if (!core) {
      const metadata = {
        mode: "act",
        requestMode: "act",
        analyticsApproval: input.prompt.approval,
        analyticsProjectId: bound.project.id,
        analyticsThreadId: input.threadId,
        ...(context?.run?.browserTabId
          ? { analyticsBrowserTabId: context.run.browserTabId }
          : {}),
        analyticsContext: {
          files: verified.files.map(({ id, filename }) => ({ id, filename })),
          mentions: input.prompt.mentions,
          sourceIds: verified.sourceIds,
        },
      };
      try {
        const queued = await mutateThreadQueuedMessages(
          input.threadId,
          {
            type: "append",
            message: {
              id: input.messageId,
              threadId: input.threadId,
              text: input.prompt.text,
              metadata,
              attachments: verified.files.map(({ id, filename, mimeType }) => ({
                type: "file",
                fileId: id,
                name: filename,
                mediaType: mimeType,
              })),
              options: {
                mode: "act",
                metadata,
                ...(input.prompt.modelId
                  ? { model: input.prompt.modelId }
                  : {}),
              },
            },
          },
          {
            transaction: getDbExec(),
            actor: {
              email: scope.ownerEmail,
              orgId: scope.orgId,
              ...(context?.authUserId
                ? { authUserId: context.authUserId }
                : {}),
              ...(context?.identityAuthenticatedAtMs === undefined
                ? {}
                : {
                    identityAuthenticatedAtMs:
                      context.identityAuthenticatedAtMs,
                  }),
            },
          },
        );
        if (!queued || queued.submissionExpired || queued.receiptUnavailable)
          admissionUnreadable();
      } catch (error) {
        if (!(error instanceof QueuedSubmissionAdmissionError)) throw error;
        if (error.code !== "queued_message_already_submitted") intentMismatch();
      }
    }
    const admitted =
      core ??
      (await getQueuedSubmissionReceipt(input.threadId, input.messageId));
    if (
      !admitted ||
      admitted.actor.email !== scope.ownerEmail ||
      admitted.actor.orgId !== scope.orgId
    )
      return admissionUnreadable();
    const saved = receiptForTurn(
      input.threadId,
      turn,
      admitted.state === "submitted" ? "admitted" : "queued",
      admitted.submittedRunId ?? null,
    );
    await tx.update(turns).set({ receipt: saved, prompt: null }).where(key);
    if (
      bootstrap.initialMessageId === null ||
      bootstrap.initialMessageId === input.messageId
    ) {
      await tx
        .update(bootstraps)
        .set({
          initialMessageId: input.messageId,
          phase: "submitted",
          initialPrompt: null,
          updatedAt: nowIso(),
        })
        .where(eq(bootstraps.bindingId, bound.binding.id));
    }
    return saved;
  });
  scheduleDrain?.(input.threadId);
  return receipt;
}

export function receiptForTurn(
  threadId: string,
  turn: typeof turns.$inferSelect,
  phase: z.infer<typeof threadTurnReceipt>["phase"],
  runId: string | null,
) {
  return threadTurnReceipt.parse({
    threadId,
    messageId: turn.messageId,
    sequence: turn.sequence.toString(),
    phase,
    runId,
    acceptedAt: turn.createdAt,
  });
}

export async function readTurnPhase(
  threadId: string,
  turn: typeof turns.$inferSelect,
) {
  if (turn.projection) return threadTurnReceipt.parse(turn.projection.receipt);
  const core = await getQueuedSubmissionReceipt(threadId, turn.messageId);
  const runId = core?.submittedRunId ?? null;
  const status = runId ? await getRunStatus(runId) : null;
  if (status === "completed")
    return receiptForTurn(threadId, turn, "complete", runId);
  if (turn.stoppedAt || status === "aborted" || core?.state === "removed")
    return receiptForTurn(threadId, turn, "stopped", runId);
  if (
    status === "errored" ||
    status === "truncated" ||
    core?.state === "expired" ||
    core?.state === "blocked"
  )
    return receiptForTurn(threadId, turn, "failed", runId);
  return receiptForTurn(threadId, turn, runId ? "admitted" : "queued", runId);
}

export async function stopAnalyticsThread(
  scope: NotebookThreadScope,
  input: z.infer<typeof stopThreadInput>,
) {
  const { binding } = await requireOwnedAnalyticsThread(scope, input.threadId);
  const digest = intentFingerprint(input);
  const db = getDb();
  const key = and(
    eq(operations.bindingId, binding.id),
    eq(operations.opId, input.opId),
  );
  const stopped = await db.transaction(async (tx) => {
    await lockThreadBootstrap(tx, binding.id);
    const [prior] = await tx.select().from(operations).where(key).limit(1);
    if (prior) {
      if (prior.fingerprint !== digest) intentMismatch();
      return stopThreadReceipt.parse(prior.receipt);
    }
    const targets = await tx
      .select()
      .from(turns)
      .where(
        and(
          eq(turns.bindingId, binding.id),
          lte(turns.sequence, BigInt(input.throughSequence)),
          isNull(turns.stoppedAt),
        ),
      )
      .orderBy(desc(turns.sequence))
      .limit(50);
    const stoppedMessageIds: string[] = [];
    let activeRunId: string | null = null;
    for (const turn of targets) {
      const view = await readTurnPhase(input.threadId, turn);
      if (
        view.phase === "complete" ||
        view.phase === "stopped" ||
        view.phase === "failed"
      )
        continue;
      const cancel = await mutateThreadQueuedMessages(
        input.threadId,
        { type: "cancel", messageId: turn.messageId },
        { transaction: getDbExec() },
      );
      const runId = cancel?.submittedRunId ?? view.runId;
      if (runId) activeRunId = runId;
      await tx
        .update(turns)
        .set({ stoppedAt: nowIso(), prompt: null })
        .where(turnKey(binding.id, turn.messageId));
      stoppedMessageIds.push(turn.messageId);
    }
    const result = stopThreadReceipt.parse({
      opId: input.opId,
      stoppedMessageIds,
      activeRunId,
      outcome: activeRunId
        ? "requested"
        : stoppedMessageIds.length
          ? "stopped"
          : "completion_won",
    });
    await tx.insert(operations).values({
      bindingId: binding.id,
      opId: input.opId,
      fingerprint: digest,
      receipt: result,
    });
    return result;
  });
  if (stopped.outcome !== "requested" || !stopped.activeRunId) return stopped;
  const ref = await getRunTurnRef(stopped.activeRunId);
  if (!ref) return admissionUnreadable();
  const outcome = await abortTurnByRefDurably(ref.threadId, ref.turnId);
  const aborted =
    outcome === "aborted" ||
    (await getRunStatus(stopped.activeRunId)) === "aborted";
  if (aborted)
    await cancelThreadNotebookRuns(
      scope,
      binding.id,
      input.threadId,
      ref.turnId,
    );
  const result = stopThreadReceipt.parse({
    ...stopped,
    outcome:
      aborted || stopped.stoppedMessageIds.length > 1
        ? "stopped"
        : "completion_won",
  });
  await db.update(operations).set({ receipt: result }).where(key);
  return result;
}

async function cancelThreadNotebookRuns(
  scope: NotebookThreadScope,
  bindingId: string,
  threadId: string,
  turnId: string,
) {
  const events = await getCurrentTurnRunEventsForThread(threadId, turnId);
  const requestSchema = z.object({ requestId: z.string().min(1) });
  const requestIds = new Set<string>();
  for (const { event } of events) {
    if (event.type !== "tool_start" || event.tool !== "start-notebook-run")
      continue;
    const request = requestSchema.safeParse(event.input.request ?? event.input);
    if (request.success) requestIds.add(request.data.requestId);
  }
  if (!requestIds.size) return;
  const { namespaceId } = threadNamespace(scope, bindingId, threadId);
  const db = getDb();
  const runs = await db
    .select({ id: notebookRuns.id })
    .from(notebookRuns)
    .where(
      and(
        eq(notebookRuns.namespaceId, namespaceId),
        eq(notebookRuns.orgId, scope.orgId),
        eq(notebookRuns.ownerEmail, scope.ownerEmail),
        inArray(notebookRuns.requestId, [...requestIds]),
        exists(
          db
            .select({ id: notebookRunWork.submissionId })
            .from(notebookRunWork)
            .where(
              and(
                eq(notebookRunWork.runId, notebookRuns.id),
                eq(notebookRunWork.done, false),
              ),
            ),
        ),
      ),
    )
    .limit(50);
  if (!runs.length) return;
  const { notebookExecution } = await import("./notebook-execution/service.js");
  const execution = await notebookExecution("frontend");
  for (const { id } of runs) {
    const result = await execution.cancel(id, undefined, threadId);
    if (result.status === "pending") execution.wake(id);
    if (result.status === "unreadable" || result.status === "denied")
      admissionUnreadable();
  }
}

export async function readThreadTurnRows(
  bindingId: string,
  after: bigint,
  limit: number,
) {
  return getDb()
    .select()
    .from(turns)
    .where(and(eq(turns.bindingId, bindingId), gt(turns.sequence, after)))
    .orderBy(asc(turns.sequence))
    .limit(limit + 1);
}

export async function latestAnalyticsThreadSequence(bindingId: string) {
  const [last] = await getDb()
    .select({ sequence: turns.sequence })
    .from(turns)
    .where(eq(turns.bindingId, bindingId))
    .orderBy(desc(turns.sequence))
    .limit(1);
  return last?.sequence.toString() ?? null;
}
