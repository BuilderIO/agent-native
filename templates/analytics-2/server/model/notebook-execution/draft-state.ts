import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { notebookMessages } from "../../../app/i18n/messages/notebook.js";
import { cellContentsSchema } from "../../../app/lib/model/contracts.js";
import {
  cellRunReceiptSchema,
  executionSnapshotSchema,
  resultIdSchema,
  runIdSchema,
  runSectionCellSchema,
} from "../../../shared/notebook-execution.js";
import { resultManifestSchema } from "../../../shared/notebook-result-contract.js";
import {
  absentSchema,
  deniedSchema,
  revisionSchema,
  unreadableSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import { usesBrowserNotebookKernel } from "../../execution/kernel-client.js";
import { runFailureMessageSchema } from "../../execution/notebook-diagnostics.js";
import { canEditProject, projectAccessLevel } from "../project-grant-access.js";
import {
  digest,
  executionContents,
  matchesExecutionSignature,
  notebookGraph,
  selectionGraph,
  withPriorSqlResultName,
} from "./planner.js";
import { consumeReactiveInputs, pendingReactiveInputs } from "./reactive.js";
import { readProducingPlans } from "./run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRunAttempts,
  notebookRuns,
  notebookRunWork,
} from "./schema.js";
import { readCurrentDraftSnapshot, type ExecutionActor } from "./snapshot.js";
import { currentThreadSnapshot } from "./thread-snapshot.js";

const defaultRunModeSchema = z.enum([
  "auto",
  "upstream",
  "downstream",
  "cell-only",
]);
const runSettingsSchema = z.strictObject({
  defaultMode: defaultRunModeSchema,
  autoRerun: z.boolean(),
  settingsRevision: revisionSchema,
});
const cellRunViewSchema = z.strictObject({
  stale: z.boolean(),
  resultId: resultIdSchema.nullable(),
  attempt: cellRunReceiptSchema.nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().optional(),
  diagnostic: z
    .strictObject({
      message: runFailureMessageSchema,
      detail: z.string().nullable(),
    })
    .optional(),
});

const browserCellSchema = z.strictObject({
  id: z.string(),
  contents: cellContentsSchema,
  signature: z.string(),
  dependencies: z.array(
    z.strictObject({
      name: z.string(),
      cellId: z.string(),
      kind: z.enum(["input", "result", "options"]),
    }),
  ),
  problem: z.string().optional(),
});

export type BrowserNotebookCell = z.infer<typeof browserCellSchema>;

export const getNotebookExecutionOutput = z.discriminatedUnion("status", [
  runSettingsSchema.extend({
    status: z.literal("found"),
    snapshot: executionSnapshotSchema,
    activeRunIds: z.array(runIdSchema),
    reactivePending: z.boolean(),
    cells: z.record(z.string(), cellRunViewSchema),
    browserCells: z.array(browserCellSchema).optional(),
    browserSections: z.array(runSectionCellSchema).optional(),
  }),
  absentSchema,
  deniedSchema,
  unreadableSchema,
]);

export const setNotebookRunSettingsInput = z
  .strictObject({
    projectId: z.string().min(1),
    expectedSettingsRevision: revisionSchema,
    defaultMode: defaultRunModeSchema.optional(),
    autoRerun: z.boolean().optional(),
  })
  .refine(
    ({ defaultMode, autoRerun }) =>
      defaultMode !== undefined || autoRerun !== undefined,
  );

export const setNotebookRunSettingsOutput = z.discriminatedUnion("status", [
  runSettingsSchema.extend({ status: z.literal("saved") }),
  runSettingsSchema.extend({ status: z.literal("conflict") }),
  absentSchema,
]);

const absent = { status: "absent", reason: "not_found" } as const;
const unreadable = { status: "unreadable", reason: "read_failed" } as const;
const completedAttempt = alias(notebookRunAttempts, "completed_attempt");

function optionDiagnostic(code?: string) {
  const copy = notebookMessages.notebook.inputChoices;
  switch (code) {
    case undefined:
      return undefined;
    case "input_option_not_allowed":
      return copy.removed;
    case "input_options_denied":
      return copy.denied;
    case "input_options_unreadable":
      return copy.unreadable;
    default:
      return undefined;
  }
}

export async function getNotebookExecution(
  actor: ExecutionActor,
  projectId: string,
  threadId?: string,
): Promise<z.infer<typeof getNotebookExecutionOutput>> {
  return getDb().transaction(async (tx) => {
    const loaded = threadId
      ? await currentThreadSnapshot(actor, { projectId, threadId }, tx, "share")
      : await readCurrentDraftSnapshot(actor, projectId, tx, "share");
    switch (loaded.status) {
      case "absent":
        return absent;
      case "denied":
        return { status: "denied", reason: "access_denied" };
      case "unreadable":
        return unreadable;
      case "accepted":
        break;
    }
    const { snapshot } = loaded.value;
    const graph = notebookGraph(loaded.value.cells);
    const runnable = graph.filter(({ cell }) => cell.contents.kind !== "input");
    const cells: Record<string, z.infer<typeof cellRunViewSchema>> = {};
    const active = new Set<z.infer<typeof runIdSchema>>();
    if (runnable.length > 0) {
      const rows = await tx
        .select({
          cellId: notebookOutputs.cellId,
          generation: notebookOutputs.generation,
          resultId: notebookOutputs.resultId,
          latest: notebookRunAttempts.receipt,
          latestFinished: notebookRunAttempts.finishedAt,
          latestStarted: notebookRunAttempts.startedAt,
          diagnostic: notebookRunAttempts.diagnostic,
          result: notebookResultManifests.manifest,
          completed: completedAttempt.receipt,
          completedAt: completedAttempt.finishedAt,
          completedStarted: completedAttempt.startedAt,
          work: {
            runId: notebookRunWork.runId,
            done: notebookRunWork.done,
            providerJob: notebookRunWork.providerJob,
          },
        })
        .from(notebookOutputs)
        .leftJoin(
          notebookRunAttempts,
          eq(notebookRunAttempts.id, notebookOutputs.attemptId),
        )
        .leftJoin(
          notebookRunWork,
          eq(notebookRunWork.attemptId, notebookOutputs.attemptId),
        )
        .leftJoin(
          notebookResultManifests,
          eq(notebookResultManifests.id, notebookOutputs.resultId),
        )
        .leftJoin(
          completedAttempt,
          eq(
            completedAttempt.id,
            sql`${notebookResultManifests.manifest}->'result'->'producer'->>'attemptId'`,
          ),
        )
        .where(
          and(
            eq(notebookOutputs.namespaceId, snapshot.namespace.namespaceId),
            inArray(
              notebookOutputs.cellId,
              runnable.map(({ cell }) => cell.id),
            ),
          ),
        )
        .limit(runnable.length);
      const byId = new Map(rows.map((row) => [row.cellId, row]));
      const snapshotResults = rows.flatMap(({ resultId, result }) => {
        if (!resultId || !result) return [];
        return resultManifestSchema.safeParse(result).data ?? [];
      });
      if (
        snapshotResults.length !==
        rows.filter(({ resultId }) => resultId).length
      )
        return unreadable;
      const failedIds = rows.flatMap(({ latest }) =>
        latest?.state.status === "failed" ? [latest.attempt.runId] : [],
      );
      const [producingPlans, failedPlans] = await Promise.all([
        readProducingPlans(tx, actor, [
          ...new Set(
            snapshotResults.map(({ result }) => result.producer.runId),
          ),
        ]),
        readProducingPlans(tx, actor, [...new Set(failedIds)], {
          namespaceId: snapshot.namespace.namespaceId,
        }),
      ]);
      const currentNodes = new Map(graph.map((node) => [node.cell.id, node]));
      const changedLineage = new Set<string>();
      for (const node of runnable) {
        const { cell, dependencies } = node;
        const row = byId.get(cell.id);
        const result = row?.result?.result;
        const sourcePlan = result && producingPlans.get(result.producer.runId);
        const compatible =
          result?.snapshot.head.versionId === snapshot.ref.head.versionId;
        const current =
          row?.latest?.attempt.outputGeneration === row?.generation
            ? row?.latest
            : null;
        const lastFailure =
          row?.latest?.state.status === "failed" ? row.latest : null;
        const failedState = lastFailure?.state;
        const message =
          failedState?.status === "failed"
            ? (optionDiagnostic(row?.diagnostic?.code) ??
              row?.diagnostic?.message ??
              row?.diagnostic?.provider?.message ??
              row?.diagnostic?.code ??
              failedState.reason)
            : null;
        const finishedAt =
          current && row?.latestFinished
            ? row.latestFinished
            : compatible
              ? (row?.completedAt ?? null)
              : null;
        const startedAt =
          current && row?.latestFinished
            ? row.latestStarted
            : compatible
              ? (row?.completedStarted ?? null)
              : null;
        const durationMs =
          finishedAt && startedAt
            ? Date.parse(finishedAt) - Date.parse(startedAt)
            : undefined;
        const previous = compatible
          ? sourcePlan?.cells.find((candidate) => candidate.cell.id === cell.id)
          : undefined;
        const inputChanged = dependencies.some((dependency) => {
          if (dependency.kind !== "input") return false;
          const saved = sourcePlan?.cells.find(
            ({ cell }) => cell.id === dependency.cellId,
          );
          const live = currentNodes.get(dependency.cellId);
          return saved?.signature !== live?.signature;
        });
        const sourceResults = dependencies.filter(
          ({ kind }) => kind !== "input",
        );
        if (
          previous &&
          (inputChanged ||
            sourceResults.some(({ cellId }) => changedLineage.has(cellId)) ||
            digest(
              sourceResults.map(({ cellId }) => cells[cellId]?.resultId),
            ) !== result?.dependencyFingerprint)
        )
          changedLineage.add(cell.id);
        let failedStale: boolean | undefined;
        if (lastFailure) {
          const plan = failedPlans.get(lastFailure.attempt.runId);
          const failedSource = plan?.cells.find(
            ({ cell: attempted }) => attempted.id === cell.id,
          );
          if (!failedSource) return unreadable;
          const live = plan?.selection
            ? selectionGraph(loaded.value.cells, cell.id, plan.selection)
            : graph;
          failedStale = !matchesExecutionSignature(
            plan?.selection
              ? live?.find(({ cell: candidate }) => candidate.id === cell.id)
              : node,
            failedSource.signature,
            failedSource,
            (id) => currentNodes.get(id)?.signature,
          );
        }
        cells[cell.id] = {
          stale:
            failedStale ??
            (!previous ||
              changedLineage.has(cell.id) ||
              digest(executionContents(previous.cell.contents)) !==
                digest(
                  executionContents(
                    withPriorSqlResultName(
                      cell.contents,
                      previous.cell.contents,
                    ),
                  ),
                )),
          resultId: compatible ? result.resultId : null,
          attempt:
            current ??
            lastFailure ??
            (compatible ? (row?.completed ?? null) : null),
          finishedAt,
          ...(durationMs !== undefined && durationMs >= 0
            ? { durationMs }
            : {}),
          ...(message
            ? {
                diagnostic: {
                  message,
                  detail:
                    row?.work?.providerJob?.jobId ??
                    (current ?? lastFailure)?.attempt.attemptId ??
                    null,
                },
              }
            : {}),
        };
        if (row?.work && !row.work.done && current) active.add(row.work.runId);
      }
      const liveRuns = await tx
        .selectDistinct({ runId: notebookRunWork.runId })
        .from(notebookRunWork)
        .innerJoin(notebookRuns, eq(notebookRuns.id, notebookRunWork.runId))
        .where(
          and(
            eq(notebookRuns.namespaceId, snapshot.namespace.namespaceId),
            eq(notebookRunWork.done, false),
          ),
        );
      for (const { runId } of liveRuns) active.add(runId);
    }
    return {
      status: "found",
      ...loaded.settings,
      snapshot,
      activeRunIds: [...active],
      reactivePending: Boolean(
        await pendingReactiveInputs(tx, projectId, snapshot.ref.head.versionId),
      ),
      cells,
      ...(!threadId &&
      usesBrowserNotebookKernel() &&
      graph.some(
        ({ cell }) =>
          (cell.contents.kind === "code" &&
            cell.contents.language === "python") ||
          (cell.contents.kind === "sql" &&
            cell.contents.connectionMode === "dataframes"),
      )
        ? {
            ...(loaded.value.sectionCells
              ? { browserSections: loaded.value.sectionCells }
              : {}),
            browserCells: graph.map(
              ({ cell, signature, dependencies, problem }) => ({
                ...cell,
                signature,
                dependencies,
                ...(problem ? { problem } : {}),
              }),
            ),
          }
        : {}),
    };
  });
}

export async function setNotebookRunSettings(
  actor: ExecutionActor,
  input: z.infer<typeof setNotebookRunSettingsInput>,
): Promise<z.infer<typeof setNotebookRunSettingsOutput>> {
  const { projects } = schema;
  return getDb().transaction(async (tx) => {
    const filter = and(
      eq(projects.id, input.projectId),
      eq(projects.orgId, actor.orgId),
      isNull(projects.trashedAt),
    );
    const selection = {
      defaultMode: projects.notebookDefaultRunMode,
      autoRerun: projects.notebookAutoRerun,
      revision: projects.notebookRunSettingsRevision,
    };
    const [current] = await tx
      .select({
        ...selection,
        ownerEmail: projects.ownerEmail,
        visibility: projects.visibility,
      })
      .from(projects)
      .where(filter)
      .limit(1)
      .for("update");
    if (!current) return absent;
    if (
      !canEditProject(
        await projectAccessLevel(
          actor,
          {
            id: input.projectId,
            ownerEmail: current.ownerEmail,
            orgId: actor.orgId,
            visibility: current.visibility,
          },
          [],
          tx,
        ),
      )
    )
      return absent;
    const settingsRevision = revisionSchema.parse(String(current.revision));
    const {
      revision: _revision,
      ownerEmail: _ownerEmail,
      visibility: _visibility,
      ...settings
    } = current;
    if (settingsRevision !== input.expectedSettingsRevision)
      return { status: "conflict", ...settings, settingsRevision };
    const defaultMode = input.defaultMode ?? current.defaultMode;
    const autoRerun = input.autoRerun ?? current.autoRerun;
    if (defaultMode === current.defaultMode && autoRerun === current.autoRerun)
      return { status: "saved", ...settings, settingsRevision };
    const revision = current.revision + 1n;
    const [updated] = await tx
      .update(projects)
      .set({
        notebookDefaultRunMode: defaultMode,
        notebookAutoRerun: autoRerun,
        notebookRunSettingsRevision: revision,
      })
      .where(filter)
      .returning(selection);
    if (!updated) return absent;
    if (!autoRerun) await consumeReactiveInputs(tx, input.projectId);
    return {
      status: "saved",
      defaultMode,
      autoRerun,
      settingsRevision: revisionSchema.parse(String(revision)),
    };
  });
}
