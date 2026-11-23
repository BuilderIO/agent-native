import { randomUUID } from "node:crypto";

import { z } from "zod";

import { sqlCellContentsSchema } from "../../app/lib/model/contracts.js";
import {
  executionSnapshotSchema,
  runReceiptSchema,
} from "../../shared/notebook-execution.js";
import type { Block, ToolResult } from "./fake-model.js";

const magicPrompt =
  "Use notebook tools. Insert a SQL cell using SELECT 13042 AS result, visualize that result in a chart, and add an independent text cell containing Magic scratch 13. Run the candidate SQL before asking for review. Do not confirm anything.";
export const magicEditPrompt =
  "Stage an edit to magic_result using SELECT 13077 AS result. Leave it pending for my review.";
const initialAsk = "Orders by channel for fixture 14";
const warehouseAsk =
  /^Orders by channel for fixture 14 using warehouse ([a-zA-Z0-9_:-]+)$/;
const followUpAsk = "Total those channels";
const createdCell = z.object({ createdCellId: z.string().min(1) });
const createdSqlCell = createdCell.extend({
  project: z.object({
    cells: z.array(z.object({ id: z.string(), contents: z.unknown() })),
  }),
});
const projectScreen = z.object({
  navigation: z.object({
    resourceKind: z.literal("project"),
    resourceId: z.string().min(1),
  }),
  threadId: z.string().min(1),
});

function actions(results: ToolResult[], tools: Array<{ name: string }>) {
  function matching(step: string) {
    return results.filter(({ tool_use_id }) =>
      tool_use_id.startsWith(`toolu_phase1_${step}_`),
    );
  }
  function read(step: string): unknown {
    const item = matching(step).at(-1);
    if (!item) return undefined;
    if (item.is_error || typeof item.content !== "string")
      throw new Error(`Phase 1 fixture tool failed at ${step}`);
    return JSON.parse(item.content) as unknown;
  }
  function invoke(name: string, step: string, input: unknown): Block[] {
    const offered = tools.some((tool) => tool.name === name);
    if (!offered && matching(`find_${step}`).length > 0)
      throw new Error(`Phase 1 fixture could not discover ${name}`);
    if (matching(step).length >= 100)
      throw new Error(`Phase 1 fixture tool did not settle at ${step}`);
    const id = randomUUID().replaceAll("-", "");
    return [
      {
        type: "tool_use",
        id: `toolu_phase1_${offered ? step : `find_${step}`}_${id}`,
        name: offered ? name : "tool-search",
        input: offered ? input : { query: name },
      },
    ];
  }
  return { read, invoke, count: (step: string) => matching(step).length };
}

function magic(results: ToolResult[], tools: Array<{ name: string }>) {
  const { read, invoke, count } = actions(results, tools);
  const screen = read("screen");
  if (screen === undefined) return invoke("view-screen", "screen", {});
  const { navigation, threadId } = projectScreen.parse(screen);
  const projectId = navigation.resourceId;
  const sql = read("sql");
  if (sql === undefined)
    return invoke("add-project-cell", "sql", {
      projectId,
      kind: "sql",
      name: "magic_result",
      source: "SELECT 13042 AS result",
    });
  const { createdCellId: sqlId } = createdCell.parse(sql);
  if (read("chart") === undefined)
    return invoke("add-project-cell", "chart", {
      projectId,
      kind: "chart",
      dataframe: "magic_result",
      afterCellId: sqlId,
    });
  const scratch = read("scratch");
  if (scratch === undefined)
    return invoke("add-project-cell", "scratch", { projectId, kind: "text" });
  const { createdCellId: cellId } = createdCell.parse(scratch);
  if (read("text") === undefined)
    return invoke("save-project-cell", "text", {
      projectId,
      cellId,
      contents: {
        id: cellId,
        kind: "text",
        text: "Magic scratch 13",
        order: "a1",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    });
  const pending = read("pending");
  let after: string | undefined;
  if (pending !== undefined) {
    const { changes, cursor } = z
      .object({
        cursor: z.string().regex(/^\d+$/),
        changes: z.array(
          z.object({ cellId: z.string(), resultIds: z.array(z.string()) }),
        ),
      })
      .parse(pending);
    if (
      changes.some(
        (change) => change.cellId === sqlId && change.resultIds.length > 0,
      )
    )
      return [
        {
          type: "text" as const,
          text: "The query, chart, and scratch cell are ready for your review.",
        },
      ];
    after = (BigInt(cursor) + BigInt(count("pending"))).toString();
  }
  return invoke("get-notebook-pending-changes", "pending", {
    projectId,
    threadId,
    ...(after ? { after } : {}),
  });
}

function ask(
  text: string,
  results: ToolResult[],
  tools: Array<{ name: string }>,
) {
  const { read, invoke, count } = actions(results, tools);
  const screen = read("screen");
  if (screen === undefined) return invoke("view-screen", "screen", {});
  const { threadId } = z.object({ threadId: z.string().min(1) }).parse(screen);
  const summary = read("summary");
  if (summary === undefined)
    return invoke("get-thread-summary", "summary", { threadId });
  const {
    binding: { projectId },
  } = z
    .object({
      binding: z.object({
        projectId: z.string().min(1),
        threadId: z.literal(threadId),
      }),
    })
    .parse(summary);
  const connectionId = warehouseAsk.exec(text)?.[1];
  const initial = text === initialAsk || connectionId !== undefined;
  const title = initial ? "Orders by channel" : "Total orders";
  const query =
    "SELECT 'web' AS channel, 14042 AS orders UNION ALL SELECT 'sales', 14084";
  const sql = read("sql");
  if (sql === undefined)
    return invoke("add-project-cell", "sql", {
      projectId,
      kind: "sql",
      name: initial ? "channel_orders" : "total_orders",
      source: initial
        ? query
        : `SELECT SUM(orders) AS orders FROM (${query}) AS channels`,
    });
  const { createdCellId: targetCellId } = createdCell.parse(sql);
  if (connectionId && read("warehouseSave") === undefined) {
    const { cells } = createdSqlCell.parse(sql).project;
    const { connectionMode: _, ...contents } = sqlCellContentsSchema.parse(
      cells.find(({ id }) => id === targetCellId)?.contents,
    );
    return invoke("save-project-cell", "warehouseSave", {
      projectId,
      cellId: targetCellId,
      contents: { ...contents, dataConnectionId: connectionId },
    });
  }
  const execution = read("execution");
  if (execution === undefined)
    return invoke("get-notebook-execution", "execution", {
      projectId,
      threadId,
    });
  const { snapshot } = z
    .object({
      status: z.literal("found"),
      snapshot: executionSnapshotSchema,
    })
    .parse(execution);
  const admitted = read("start");
  if (admitted === undefined)
    return invoke("start-notebook-run", "start", {
      snapshot,
      targetCellId,
      requestId: randomUUID(),
      mode: "cell-only",
      staleValues: "reject",
      cache: "bypass",
    });
  const { runId } = runReceiptSchema.parse(admitted);
  const current = read("run");
  const pollRun = () =>
    invoke("get-notebook-run", "run", {
      runId,
      threadId,
      first: count("run") + 1,
    });
  if (current === undefined) return pollRun();
  const { run } = z
    .object({ status: z.literal("found"), run: runReceiptSchema })
    .parse(current);
  const attempt = run.attempts.find(
    ({ attempt }) => attempt.cellId === targetCellId,
  );
  if (!attempt) throw new Error("Phase 1 Ask SQL cell has no attempt");
  if (attempt.state.status === "queued" || attempt.state.status === "running") {
    return pollRun();
  }
  if (
    attempt.state.status !== "complete" ||
    attempt.state.resultIds.length !== 1
  )
    throw new Error(`Phase 1 Ask SQL ended ${attempt.state.status}`);
  const [resultId] = attempt.state.resultIds;
  const result = read("result");
  if (result === undefined)
    return invoke("get-notebook-result-page", "result", {
      resultId,
      threadId,
      page: 1,
    });
  const digits = z.string().regex(/^\d+$/);
  const number = z
    .union([
      z.number(),
      digits,
      z.object({ value: digits }).transform(({ value }) => value),
    ])
    .pipe(z.coerce.number());
  const { rows } = z
    .object({ status: z.literal("ready"), rows: z.array(z.array(z.unknown())) })
    .parse(result);
  const chartData = initial
    ? z
        .array(z.tuple([z.string(), number]))
        .length(2)
        .parse(rows)
        .map(([channel, orders]) => ({ channel, orders }))
    : [
        {
          channel: "Total",
          orders: z.tuple([z.tuple([number])]).parse(rows)[0][0],
        },
      ];
  if (read("widget") === undefined)
    return invoke("render-data-widget", "widget", {
      widget: "data-chart",
      widgetId: resultId,
      title,
      chartSeries: {
        type: "bar",
        title,
        xKey: "channel",
        series: [{ key: "orders", label: "Orders" }],
        data: chartData,
      },
    });
  return [
    {
      type: "text" as const,
      text: chartData
        .map(({ channel, orders }) => `- **${channel}**: **${orders}**`)
        .join("\n"),
    },
  ];
}

function magicEdit(results: ToolResult[], tools: Array<{ name: string }>) {
  const { read, invoke } = actions(results, tools);
  const screen = read("screen");
  if (screen === undefined) return invoke("view-screen", "screen", {});
  const {
    navigation: { resourceId: projectId },
    threadId,
  } = projectScreen.parse(screen);
  const project = read("project");
  if (project === undefined)
    return invoke("get-project", "project", { projectId });
  const { cells } = createdSqlCell.shape.project.parse(
    z.object({ project: z.unknown() }).parse(project).project,
  );
  const cell = cells
    .map(({ contents }) => contents)
    .find(
      (contents) =>
        z
          .object({ resultVariable: z.literal("magic_result") })
          .safeParse(contents).success,
    );
  const contents = sqlCellContentsSchema.parse(cell);
  const edited = read("edit");
  if (edited === undefined)
    return invoke("save-project-cell", "edit", {
      projectId,
      cellId: contents.id,
      contents: { ...contents, source: "SELECT 13077 AS result" },
    });
  z.object({
    editStatus: z.literal("pending_review"),
    threadId: z.literal(threadId),
    proposalIds: z.array(z.string().min(1)).min(1),
  }).parse(edited);
  return [{ type: "text" as const, text: "The SQL edit is ready for review." }];
}

export async function phase1Model(
  text: string,
  results: ToolResult[],
  tools: Array<{ name: string }>,
): Promise<Block[] | null> {
  if (text === magicPrompt) return magic(results, tools);
  if (text === magicEditPrompt) return magicEdit(results, tools);
  if (text === initialAsk || text === followUpAsk || warehouseAsk.test(text))
    return ask(text, results, tools);
  return null;
}
