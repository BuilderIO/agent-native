import { isActionContractError } from "@agent-native/core/action";
import { and, eq, isNull } from "@agent-native/core/db/schema";
import {
  getCurrentTurnRunEventsForThread,
  getThread,
  getRunTurnRef,
  type AgentChatEvent,
} from "@agent-native/core/server";
import { z } from "zod";

import { askLifecycleErrors as copy } from "../../app/i18n/messages/ask-lifecycle-errors.js";
import {
  readThreadTurnsInput,
  persistedThreadProjection,
  threadTurnView,
  type ThreadTurnReceipt,
} from "../../shared/analytics-thread.js";
import {
  resultIdSchema,
  runReceiptSchema,
} from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";
import { getDb, schema } from "../db/index.js";
import { assertGrantedDataConnection } from "../lib/project-action-access.js";
import {
  admissionUnreadable,
  readAnalyticsThreadAccess,
  readAnalyticsThreadBinding,
  threadNotFound,
} from "./analytics-thread-bootstrap.js";
import {
  readThreadTurnRows,
  readTurnPhase,
  receiptForTurn,
} from "./analytics-thread-turns.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { notebookResultManifests } from "./notebook-execution/schema.js";
import {
  checkNotebookAuthorities,
  readNotebookResultAuthorities,
} from "./notebook-results.js";
import type { NotebookThreadScope } from "./thread-projects.js";

type TurnView = z.infer<typeof threadTurnView>;
type ToolReceipt = TurnView["toolReceipts"][number];
const turns = schema.analyticsThreadTurns;
type TurnRow = typeof turns.$inferSelect;
const chartCall = z.object({
  widget: z.enum(["data-chart", "data-insights"]),
  widgetId: resultIdSchema,
  title: z.string().max(500).default(copy.chart),
});
const resultCall = z.object({ resultId: resultIdSchema });
const foundRun = z.object({
  status: z.literal("found"),
  run: runReceiptSchema,
});
const safeSharedTools = new Set([
  "view-screen",
  "get-thread-summary",
  "get-notebook-execution",
  "add-project-cell",
  "save-project-cell",
  "start-notebook-run",
  "get-notebook-run",
  "get-notebook-result-page",
  "render-data-widget",
  "list-connection-datasets",
  "list-data-connection-schemas",
  "describe-warehouse-table",
  "validate-sql-query",
]);

function collectTurn(events: AgentChatEvent[], projectId: string) {
  const results = new Set<z.infer<typeof resultIdSchema>>();
  const sources = new Set<string>();
  const chartArtifacts: TurnView["chartArtifacts"] = [];
  const tools = new Map<string, ToolReceipt>();
  let durationMs: number | null = null;
  let text = "";
  let denied = false;
  const lastTextIndex = events.reduce(
    (last, { type }, index) => (type === "text" ? index : last),
    -1,
  );
  for (const [index, event] of events.entries()) {
    if (event.omitFromPersistedHistory) {
      denied = true;
      continue;
    }
    if (event.type === "text") {
      text += event.text;
      continue;
    }
    if (
      event.type === "tool_start" ||
      (event.type === "clear" && index < lastTextIndex)
    )
      text = "";
    if (event.type === "done" && event.durationMs !== undefined)
      durationMs = event.durationMs;
    if (event.type !== "tool_done" && event.type !== "tool_start") continue;
    const id = event.executionStepId ?? event.id;
    if (!id) continue;
    if (!safeSharedTools.has(event.tool)) denied = true;
    const state =
      event.type === "tool_start"
        ? "running"
        : event.isError || event.notExecuted
          ? "failed"
          : "complete";
    tools.set(id, { id, name: event.tool, state });
    const connection =
      event.input?.connectionId ??
      event.input?.sourceId ??
      event.input?.dataConnectionId;
    if (typeof connection === "string" && connection) sources.add(connection);
    if (
      typeof event.input?.projectId === "string" &&
      event.input.projectId !== projectId
    )
      denied = true;
    if (event.type !== "tool_done" || event.isError || event.notExecuted)
      continue;
    if (event.tool === "get-notebook-result-page") {
      const result = resultCall.safeParse(event.input);
      if (!result.success) denied = true;
      else results.add(result.data.resultId);
    }
    if (event.tool === "get-notebook-run") {
      if (event.result.startsWith("Skipped duplicate tool call")) continue;
      try {
        const run = foundRun.safeParse(JSON.parse(event.result));
        if (run.success)
          for (const attempt of run.data.run.attempts) {
            if (attempt.state.status === "complete")
              for (const result of attempt.state.resultIds) results.add(result);
          }
      } catch {
        denied = true;
      }
    }
    if (event.tool === "render-data-widget") {
      const chart = chartCall.safeParse(event.input);
      if (chart.success)
        chartArtifacts.push({
          id,
          resultId: chart.data.widgetId,
          title: chart.data.title,
          widget: event.chatUIResult,
        });
      else denied = true;
    }
  }
  return {
    results,
    sources,
    chartArtifacts,
    tools: [...tools.values()],
    durationMs,
    text,
    denied,
  };
}

function projectTurn(
  row: TurnRow,
  receipt: ThreadTurnReceipt,
  events: AgentChatEvent[],
  projectId: string,
) {
  const turn = collectTurn(events, projectId);
  const sources = [...new Set([...row.sourceIds, ...turn.sources])];
  return persistedThreadProjection.parse({
    receipt,
    answerBlocks: turn.text.trim()
      ? [{ kind: "markdown", text: turn.text.slice(0, 32_000) }]
      : [],
    chartArtifacts: turn.chartArtifacts.slice(0, 20),
    toolReceipts: turn.tools.slice(0, 100),
    durationMs: turn.durationMs,
    sourceIds: sources.slice(0, 100),
    resultIds: [...turn.results].slice(0, 100),
    privateContext:
      row.privateContext ||
      turn.denied ||
      sources.length > 100 ||
      turn.results.size > 100,
  });
}

function persistTerminalProjection(
  row: TurnRow,
  projection: z.infer<typeof persistedThreadProjection>,
) {
  return getDb()
    .update(turns)
    .set({ projection })
    .where(
      and(
        eq(turns.bindingId, row.bindingId),
        eq(turns.messageId, row.messageId),
        isNull(turns.projection),
      ),
    );
}

export async function persistAnalyticsThreadRun(
  _scope: unknown,
  run: { runId: string; threadId: string; turnId: string; status: string },
  { turnContinues }: { turnContinues: boolean },
) {
  if (turnContinues || !run.turnId.startsWith("queued-")) return;
  const messageId = z.uuid().safeParse(run.turnId.slice("queued-".length));
  if (!messageId.success) return;
  const thread = await getThread(run.threadId);
  if (!thread?.orgId || !thread.source?.appId) return;
  const bound = await readAnalyticsThreadBinding(
    {
      ownerEmail: thread.ownerEmail,
      orgId: thread.orgId,
      appId: thread.source.appId,
    },
    run.threadId,
  );
  if (!bound || bound.bootstrap.ownerId !== thread.ownerEmail) return;
  const [row] = await getDb()
    .select()
    .from(turns)
    .where(
      and(
        eq(turns.bindingId, bound.binding.id),
        eq(turns.messageId, messageId.data),
      ),
    )
    .limit(1);
  if (!row || row.projection) return;
  const terminal =
    run.status === "completed"
      ? "complete"
      : run.status === "aborted"
        ? "stopped"
        : "failed";
  const prior = await readTurnPhase(run.threadId, row);
  const receipt = receiptForTurn(
    run.threadId,
    row,
    terminal,
    prior.runId ?? run.runId,
  );
  const events = await getCurrentTurnRunEventsForThread(
    run.threadId,
    run.turnId,
  );
  if (!events.length && terminal === "complete") return admissionUnreadable();
  await persistTerminalProjection(
    row,
    projectTurn(
      row,
      receipt,
      events.map(({ event }) => event),
      bound.project.id,
    ),
  );
}

async function permitsConnection(id: string) {
  try {
    await assertGrantedDataConnection(id);
    return true;
  } catch (error) {
    if (isActionContractError(error) && error.statusCode < 500) return false;
    throw error;
  }
}

export async function readAnalyticsThreadTurns(
  scope: NotebookThreadScope,
  input: z.infer<typeof readThreadTurnsInput>,
) {
  await ensureAnalyticsDatabase();
  const authorized = await readAnalyticsThreadAccess(scope, input.threadId);
  if (!authorized) threadNotFound();
  const after = BigInt(input.after ?? "0");
  const end = authorized.owner ? input.limit : 100;
  const rows = await readThreadTurnRows(
    authorized.binding.id,
    authorized.owner ? after : 0n,
    end,
  );
  const views: TurnView[] = [];
  let inheritedDenial = false;
  for (const row of rows.slice(0, end)) {
    const receipt = await readTurnPhase(input.threadId, row);
    let projection = row.projection
      ? persistedThreadProjection.parse(row.projection)
      : null;
    if (!projection) {
      const ref = receipt.runId ? await getRunTurnRef(receipt.runId) : null;
      if (receipt.runId && !ref) return admissionUnreadable();
      const events = ref
        ? await getCurrentTurnRunEventsForThread(input.threadId, ref.turnId)
        : [];
      if (!events.length && receipt.phase === "complete")
        return admissionUnreadable();
      projection = projectTurn(
        row,
        receipt,
        events.map(({ event }) => event),
        authorized.project.id,
      );
      if (receipt.phase === "complete")
        await persistTerminalProjection(row, projection);
    }
    const manifests = new Set<string>();
    let denied: boolean =
      !authorized.owner && (inheritedDenial || projection.privateContext);
    if (!authorized.owner && !denied) {
      for (const id of projection.sourceIds) {
        if (!(await permitsConnection(id))) {
          denied = true;
          break;
        }
      }
    }
    for (const id of projection.resultIds) {
      const resultId = resultIdSchema.parse(id);
      const [stored] = await getDb()
        .select({ manifest: notebookResultManifests.manifest })
        .from(notebookResultManifests)
        .where(eq(notebookResultManifests.id, resultId))
        .limit(1);
      const parsed = completeResultManifestSchema.safeParse(stored?.manifest);
      if (
        !parsed.success ||
        parsed.data.result.snapshot.projectId !== authorized.project.id ||
        parsed.data.result.snapshot.workspaceId !== scope.orgId
      ) {
        if (!authorized.owner) denied = true;
        continue;
      }
      if (!authorized.owner && !denied) {
        const outcome = await checkNotebookAuthorities(
          { ...scope, caller: "frontend" },
          await readNotebookResultAuthorities([parsed.data]),
        );
        if (outcome?.status === "unreadable") return admissionUnreadable();
        denied = outcome?.status === "denied";
      }
      manifests.add(resultId);
    }
    inheritedDenial ||= denied;
    if (row.sequence <= after) continue;
    if (!authorized.owner && receipt.phase !== "complete") continue;
    views.push(
      threadTurnView.parse({
        receipt,
        denied,
        answerBlocks: denied ? [] : projection.answerBlocks,
        chartArtifacts: denied
          ? []
          : projection.chartArtifacts.filter(({ resultId }) =>
              manifests.has(resultId),
            ),
        toolReceipts: denied ? [] : projection.toolReceipts,
        durationMs: denied ? null : projection.durationMs,
      }),
    );
    if (views.length > input.limit) break;
  }
  const page = views.slice(0, input.limit);
  const hasNext = authorized.owner
    ? rows.length > input.limit
    : views.length > input.limit;
  if (!authorized.owner && rows.length > end && !hasNext)
    return admissionUnreadable();
  return {
    turns: page,
    next: hasNext ? (page.at(-1)?.receipt.sequence ?? null) : null,
  };
}
