import { setTimeout as delay } from "node:timers/promises";

import {
  getRequestRunContext,
  platformWaitUntil,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  controlIdSchema,
  type CapabilityDecision,
} from "../../../shared/capabilities.js";
import {
  attemptIdSchema,
  resultIdSchema,
  runEventSchema,
  runRequestSchema,
  runReceiptSchema,
  runIdSchema,
  type Snapshot,
} from "../../../shared/notebook-execution.js";
import {
  absentSchema,
  decimalIntegerSchema,
  deniedSchema,
  pendingSchema,
  unreadableSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import {
  evaluateDraftRunPermission,
  evaluatePreparedDraftSqlCapability,
} from "../../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../../lib/workspace-access.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { readPublishPreviewSnapshot } from "../publish-previews.js";
import { readPublishedExecutionSnapshot } from "../published-app-sessions.js";
import { createDraftKernelControl } from "./kernel-control.js";
import { pendingReactiveInputs } from "./reactive.js";
import { createRunStore, type RunEntry } from "./run-store.js";
import {
  notebookReactiveInputs,
  notebookRuns,
  notebookRunWork,
} from "./schema.js";
import {
  readCurrentDraftSnapshot,
  type ExecutionActor,
  type SnapshotReader,
} from "./snapshot.js";
import {
  readExecutionSnapshot as readDraftOrThreadSnapshot,
  readRunThread,
} from "./thread-snapshot.js";

export const getNotebookRunInput = z.strictObject({
  runId: runIdSchema,
  after: decimalIntegerSchema.default("0"),
  first: z.number().int().min(1).max(100).default(50),
  threadId: z.string().min(1).max(128).optional(),
});

export const getNotebookRunOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    run: runReceiptSchema,
    events: z.array(runEventSchema),
    building: z.array(
      z.strictObject({ attemptId: attemptIdSchema, resultId: resultIdSchema }),
    ),
    nextCursor: decimalIntegerSchema,
  }),
  absentSchema,
  deniedSchema,
  unreadableSchema,
  pendingSchema,
]);

const readExecutionSnapshot: SnapshotReader = (actor, snapshot, tx) => {
  switch (snapshot.namespace.kind) {
    case "preview":
      return readPublishPreviewSnapshot(actor, snapshot, tx);
    case "release-session":
    case "release-default":
      return readPublishedExecutionSnapshot(actor, snapshot, tx);
    case "schedule-tick":
      return import("../published-app-schedules.js").then(
        ({ readScheduledExecutionSnapshot }) =>
          readScheduledExecutionSnapshot(actor, snapshot, tx),
      );
    case "draft":
    case "thread":
      return readDraftOrThreadSnapshot(actor, snapshot, tx);
  }
};

export const notebookRunStore = createRunStore(readExecutionSnapshot);
export const draftKernelControl = createDraftKernelControl(
  notebookRunStore,
  wakeNotebookRun,
);

function accessRefusal(decision: CapabilityDecision) {
  if (decision.status === "allowed") return null;
  if (decision.status === "absent")
    return { status: "absent", reason: "not_found" } as const;
  if (decision.status === "pending" || decision.status === "unavailable")
    return { status: "pending", reason: "not_ready" } as const;
  if (decision.status === "unreadable")
    return { status: "unreadable", reason: "read_failed" } as const;
  return { status: "denied", reason: "access_denied" } as const;
}

export async function currentExecutionActor(
  caller: string,
): Promise<ExecutionActor> {
  await ensureAnalyticsDatabase();
  const { ownerEmail, orgId } = await requireCurrentWorkspace();
  return { ownerEmail, orgId, caller };
}

export async function notebookExecution(caller: string) {
  const actor = await currentExecutionActor(caller);
  return {
    ...executionFor(
      actor,
      evaluateDraftRunPermission,
      readExecutionSnapshot,
      async ({ ref }, cellId, contents) =>
        accessRefusal(
          await evaluatePreparedDraftSqlCapability(
            await requireCurrentWorkspace(),
            { id: cellId, projectId: ref.projectId, contents },
            contents.dataConnectionId,
          ),
        ),
    ),
    wake(runId: string) {
      wakeNotebookRun(actor, runId);
    },
  };
}

export function wakeNotebookRun(actor: ExecutionActor, runId: string) {
  const work = drainNotebookRun(actor, runId, {
    deadlineAt: Date.now() + 90_000,
  }).catch((error: unknown) => {
    console.error("Notebook worker dispatch failed", { runId, error });
  });
  (getRequestRunContext()?.waitUntil ?? platformWaitUntil())?.(work);
}

export async function findClaimableNotebookRunActor(
  orgId: string,
  runId: string,
  now = Date.now(),
): Promise<ExecutionActor | null> {
  const parsedRunId = runIdSchema.parse(runId);
  const [next] = await getDb()
    .select({ leaseUntil: notebookRunWork.leaseUntil })
    .from(notebookRunWork)
    .where(
      and(
        eq(notebookRunWork.runId, parsedRunId),
        eq(notebookRunWork.done, false),
      ),
    )
    .orderBy(asc(notebookRunWork.ordinal))
    .limit(1);
  if (!next) return null;
  if (next.leaseUntil !== null && next.leaseUntil > now) return null;
  const [run] = await getDb()
    .select({
      orgId: notebookRuns.orgId,
      ownerEmail: notebookRuns.ownerEmail,
      caller: notebookRuns.caller,
    })
    .from(notebookRuns)
    .where(and(eq(notebookRuns.id, parsedRunId), eq(notebookRuns.orgId, orgId)))
    .limit(1);
  return run ?? null;
}

export function executionFor(
  actor: ExecutionActor,
  authorizeDraft: typeof evaluateDraftRunPermission,
  load: SnapshotReader,
  authorizeTarget?: Parameters<typeof createRunStore>[1],
) {
  const store = createRunStore(load, authorizeTarget);
  async function authorize(
    control: string,
    snapshot: Parameters<SnapshotReader>[1],
  ) {
    const decision = await authorizeDraft(controlIdSchema.parse(control), {
      kind: "project",
      workspaceId: snapshot.ref.workspaceId,
      projectId: snapshot.ref.projectId,
    });
    return accessRefusal(decision);
  }
  return {
    async start(request: Parameters<typeof store.admit>[1], entry?: RunEntry) {
      return (
        (await authorize("start-notebook-run", request.snapshot)) ??
        store.admit(actor, request, entry)
      );
    },
    async get({
      runId,
      first,
      after,
      threadId,
    }: z.infer<typeof getNotebookRunInput>) {
      const read = await store.read(actor, runId, BigInt(after), first);
      if (read.status !== "found") return read;
      const { snapshot } = read.run.request;
      if (snapshot.namespace.kind === "schedule-tick") {
        const { readAuthorizedScheduleTick } =
          await import("../published-app-schedules.js");
        return (await readAuthorizedScheduleTick(actor, snapshot))
          ? read
          : ({ status: "denied", reason: "access_denied" } as const);
      }
      const failure = await requireRunThread(snapshot, threadId);
      if (failure) return failure;
      return (await authorize("get-notebook-run", snapshot)) ?? read;
    },
    async cancel(
      runId: string,
      cellId?: Parameters<typeof store.cancel>[2],
      threadId?: string,
    ) {
      const read = await store.read(actor, runId, 0n, 1);
      if (read.status !== "found") return read;
      const failure = await requireRunThread(
        read.run.request.snapshot,
        threadId,
      );
      if (failure) return failure;
      return (
        (await authorize("cancel-notebook-run", read.run.request.snapshot)) ??
        store.cancel(actor, runId, cellId)
      );
    },
  };

  async function requireRunThread(snapshot: Snapshot, threadId?: string) {
    if (
      snapshot.namespace.kind === "thread" &&
      !(await readRunThread(actor, snapshot, threadId))
    )
      return { status: "denied", reason: "access_denied" } as const;
    return null;
  }
}

export async function sweepNotebookRuns({
  deadlineAt,
  signal,
}: {
  deadlineAt: number;
  signal?: AbortSignal;
}) {
  await ensureAnalyticsDatabase();
  const { sweepProposalRuns } = await import("./proposal-runs.js");
  await sweepProposalRuns(deadlineAt, signal);
  const projects = schema.projects;
  const pending = await getDb()
    .select({
      projectId: projects.id,
      ownerEmail: projects.ownerEmail,
      orgId: projects.orgId,
    })
    .from(notebookReactiveInputs)
    .innerJoin(
      projects,
      and(
        eq(projects.id, notebookReactiveInputs.projectId),
        eq(projects.workingVersionId, notebookReactiveInputs.versionId),
      ),
    )
    .where(
      and(isNull(projects.trashedAt), eq(projects.notebookAutoRerun, true)),
    )
    .orderBy(asc(projects.id))
    .limit(16);
  for (const { projectId, ...scope } of pending) {
    if (signal?.aborted || Date.now() >= deadlineAt) return;
    if (scope.ownerEmail && scope.orgId)
      await admitReactiveNotebookRun(
        {
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          caller: "frontend",
        },
        projectId,
      );
  }
  const rows = await getDb()
    .selectDistinct({
      id: notebookRuns.id,
      ownerEmail: notebookRuns.ownerEmail,
      orgId: notebookRuns.orgId,
      caller: notebookRuns.caller,
    })
    .from(notebookRuns)
    .innerJoin(notebookRunWork, eq(notebookRuns.id, notebookRunWork.runId))
    .where(
      and(
        eq(notebookRunWork.done, false),
        or(
          inArray(
            sql<string>`${notebookRuns.receipt}->'request'->'snapshot'->'namespace'->>'kind'`,
            [
              "draft",
              "thread",
              "preview",
              "release-session",
              "release-default",
            ],
          ),
          sql`exists (
            select 1 from ${schema.publishedAppScheduleTicks}
            where ${schema.publishedAppScheduleTicks.runId} = ${notebookRuns.id}
              and ${schema.publishedAppScheduleTicks.terminalAt} is null
          )`,
        ),
        or(
          isNull(notebookRunWork.leaseUntil),
          lte(notebookRunWork.leaseUntil, Date.now()),
        ),
      ),
    )
    .orderBy(asc(notebookRuns.id))
    .limit(16);
  if (!rows.length) return;
  for (const { id, ...actor } of rows) {
    if (signal?.aborted || Date.now() >= deadlineAt) return;
    await drainNotebookRun(actor, id, { deadlineAt, signal });
  }
}

async function admitReactiveNotebookRun(
  actor: ExecutionActor,
  projectId: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await readCurrentDraftSnapshot(actor, projectId);
    if (loaded.status !== "accepted" || !loaded.settings.autoRerun) return;
    const { snapshot } = loaded.value;
    const pending = await pendingReactiveInputs(
      getDb(),
      projectId,
      snapshot.ref.head.versionId,
    );
    const first = pending?.inputCellIds[0];
    if (!first) return;
    const request = runRequestSchema.parse({
      snapshot,
      requestId: `reactive:${snapshot.inputRevision}`,
      mode: "auto",
      targetCellId: first,
      cache: "reuse",
      staleValues: "reject",
    });
    const receipt = await notebookRunStore.admit(actor, request, {
      reactive: true,
    });
    if (receipt.status === "admitted") return receipt;
    if (receipt.status !== "rejected" || receipt.reason !== "stale_snapshot")
      return;
  }
}

export function wakeReactiveNotebookRun(
  actor: ExecutionActor,
  projectId: string,
) {
  const execution = delay(30)
    .then(async () => {
      const receipt = await admitReactiveNotebookRun(actor, projectId);
      if (receipt)
        await drainNotebookRun(actor, receipt.runId, {
          deadlineAt: Date.now() + 90_000,
        });
    })
    .catch((error: unknown) => {
      console.error("Notebook reactive dispatch failed", { projectId, error });
    });
  platformWaitUntil()?.(execution);
}

export async function drainNotebookRun(
  actor: ExecutionActor,
  runId: string,
  {
    deadlineAt,
    signal,
  }: { deadlineAt: number; signal?: AbortSignal | undefined },
) {
  const [{ createNotebookWorker }, { createHostedKernelPort }] =
    await Promise.all([
      import("../../execution/notebook-worker.js"),
      import("../../execution/notebook-kernel.js"),
    ]);
  const worker = createNotebookWorker(
    notebookRunStore,
    createHostedKernelPort(notebookRunStore),
  );
  await runWithRequestContext(
    { orgId: actor.orgId, userEmail: actor.ownerEmail },
    async () => {
      await requireCurrentWorkspace();
      while (!signal?.aborted && Date.now() < deadlineAt) {
        if (!(await worker(actor, runId, signal))) break;
      }
    },
  );
}
