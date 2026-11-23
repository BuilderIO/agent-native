import { randomUUID } from "node:crypto";

import { z } from "zod";

import { chartCellContentsSchema } from "../../app/lib/model/contracts.js";
import { runReceiptSchema } from "../../shared/notebook-execution.js";
import { notebookPendingChangesSchema } from "../../shared/notebook-proposals.js";
import { phase1Model } from "./phase1-model.js";
import { required } from "./required";

export type ModelResponse = {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
};

/**
 * Scripted Anthropic Messages API for the local daily suite. Deterministic replies keyed on the
 * latest user message; extend `answerModelRequest` with tool-use scripts (for example the
 * question-to-chart flow) as the ask tests need them.
 */
export type ModelState = { requests: unknown[]; reset(): void };

export function createModelState(): ModelState {
  const state: ModelState = {
    requests: [],
    reset() {
      state.requests.length = 0;
    },
  };
  return state;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function sse(
  res: ModelResponse,
  events: Array<[string, unknown]>,
  gapMs = 0,
) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  for (const [event, data] of events) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (gapMs && event === "content_block_delta") await wait(gapMs);
  }
  res.end();
}

export function reply(
  res: ModelResponse,
  blocks: Block[],
  stream: boolean,
  model: string,
  options: { gapMs?: number; pieces?: number } = {},
) {
  const stop = blocks.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn";
  const message = {
    id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    model,
    content: blocks,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  if (!stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(message));
    return;
  }
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: { ...message, content: [], stop_reason: null },
      },
    ],
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
      ]);
      const pieces = Math.max(1, options.pieces ?? 1);
      const size = Math.ceil(block.text.length / pieces);
      for (let at = 0; at < block.text.length; at += size)
        events.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: {
              type: "text_delta",
              text: block.text.slice(at, at + size),
            },
          },
        ]);
    } else {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input),
          },
        },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 10 },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  void sse(res, events, options.gapMs ?? 0);
}

/** The question as the person typed it: the app appends a `<context ...>` block to every user turn. */
function questionText(text: string) {
  return required(
    text.split(/\n*(?:<|&lt;)(?:context|current-time)[\s>]/i)[0],
  ).trim();
}

type Message = { role: string; content: unknown };

export type ToolResult = {
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
};

function userParts(message: Message | undefined) {
  const content = message?.content;
  if (!content) return { text: "", toolResults: [] as ToolResult[] };
  if (typeof content === "string")
    return { text: questionText(content), toolResults: [] as ToolResult[] };
  const blocks = content as Array<{
    type: string;
    text?: string;
    tool_use_id?: string;
    content?: unknown;
  }>;
  return {
    text: questionText(
      blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(" "),
    ),
    toolResults: blocks.filter((b) => b.type === "tool_result") as ToolResult[],
  };
}

/**
 * The question of the current turn and the tool results that follow it. A turn that continues
 * after a tool call ends with a user message holding only tool results, so the question is the
 * latest user message that has text; the tool results are those after it.
 */
function lastUserTurn(input: { messages?: Message[] }) {
  const users = (input.messages ?? [])
    .filter((m) => m.role === "user")
    .map(userParts);
  let askedAt = users.length - 1;
  while (askedAt >= 0 && users[askedAt]?.text === "") askedAt--;
  if (askedAt < 0)
    return { text: "", toolResults: users.flatMap((u) => u.toolResults) };
  return {
    text: required(users[askedAt]).text,
    toolResults: users.slice(askedAt).flatMap((u) => u.toolResults),
  };
}

/** The chart the first-question flow answers with: a labelled bar chart in the shorthand the chat renders inline. */
export const FAKE_CHART_TITLE = "Revenue by month";
export const FAKE_CHART_LINE = `/chart type=bar title="${FAKE_CHART_TITLE}" labels=["Jan","Feb","Mar","Apr"] data=[120,180,150,210]`;

export const MISSING_PROJECT_ID = "00000000-0000-4000-8000-00000000dead";
export const MISSING_PROJECT_TITLE = "Old churn analysis";

export const MODEL_ERROR_TEXT = "The model is overloaded";

function chartToolResult(results: ToolResult[], stage: string) {
  const matches = results.filter((result) =>
    result.tool_use_id.startsWith(`toolu_first_chart_${stage}_`),
  );
  const match = matches.at(0);
  if (matches.length !== 1 || !match || match.is_error)
    throw new Error(`First-run chart ${stage} tool result missing or failed`);
  const content = match.content;
  if (typeof content !== "string")
    throw new Error(`First-run chart ${stage} result is not JSON text`);
  return JSON.parse(
    stage === "search" ? required(content.split("\n\n")[0]) : content,
  ) as unknown;
}

function chartTool(name: string, stage: string, input: unknown): Block {
  return {
    type: "tool_use",
    id: `toolu_first_chart_${stage}_${randomUUID().replaceAll("-", "")}`,
    name,
    input,
  };
}

function firstRunChart(
  text: string,
  results: ToolResult[],
  tools: Array<{ name: string }>,
  request: string,
): Block[] | null {
  const prompt =
    /^Query staged dataset (\S+) named "[^"]+" and make a saved bar chart of amount by label\. Show me the chart\.$/.exec(
      text,
    );
  if (!prompt) return null;
  const datasetId = required(prompt[1]);
  // The Home ask thread binds its own project; the context note names it.
  const bound = /bound to project (\S+) and thread/.exec(request);
  if (!bound)
    throw new Error("First-run chart request carries no bound project note");
  const projectId = required(bound[1]);
  const offered = tools.some((tool) => tool.name === "query-staged-dataset");
  const searched = results.some((result) =>
    result.tool_use_id.startsWith("toolu_first_chart_search_"),
  );
  if (results.length === 0 && !offered)
    return [
      chartTool("tool-search", "search", { query: "query-staged-dataset" }),
    ];
  if (searched) {
    const found = z
      .object({
        results: z.array(z.object({ name: z.string(), callable: z.boolean() })),
      })
      .parse(chartToolResult(results, "search"));
    if (
      !found.results.some(
        (item) => item.name === "query-staged-dataset" && item.callable,
      ) ||
      !offered
    )
      throw new Error(
        "First-run chart query tool was not discovered and offered",
      );
  }
  const actionResults = results.filter(
    (result) => !result.tool_use_id.startsWith("toolu_first_chart_search_"),
  );
  if (actionResults.length === 0)
    return [chartTool("query-staged-dataset", "query", { datasetId })];

  const query = z
    .object({
      dataset: z.object({ id: z.string(), totalRows: z.number() }),
      rowCount: z.number(),
      rows: z.array(
        z
          .object({
            label: z.string(),
            amount: z.union([z.string(), z.number()]),
          })
          .passthrough(),
      ),
    })
    .parse(chartToolResult(results, "query"));
  if (
    query.dataset.id !== datasetId ||
    query.rowCount !== query.rows.length ||
    query.dataset.totalRows !== query.rowCount ||
    query.rowCount === 0
  )
    throw new Error(
      "First-run chart query returned incomplete or mismatched rows",
    );
  const rows = query.rows.map((row) => {
    const value =
      typeof row.amount === "string" ? row.amount.trim() : row.amount;
    if (
      typeof value === "string" &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
    )
      throw new Error("First-run chart amount is not numeric");
    const amount = Number(value);
    if (!Number.isFinite(amount))
      throw new Error("First-run chart amount is not finite");
    return { ...row, amount };
  });
  const stageResults = (stage: string) =>
    results.filter((item) =>
      item.tool_use_id.startsWith(`toolu_first_chart_${stage}_`),
    );
  if (stageResults("add").length === 0)
    return [
      chartTool("add-project-cell", "add", {
        projectId,
        kind: "sql",
        name: "chart_source",
        source: rows
          .map(
            (row) =>
              `SELECT '${row.label.replaceAll("'", "''")}' AS label, ${row.amount} AS amount`,
          )
          .join(" UNION ALL "),
      }),
    ];
  const added = z
    .object({ createdCellId: z.string().min(1) })
    .passthrough()
    .parse(chartToolResult(results, "add"));
  if (stageResults("run").length === 0)
    return [
      chartTool("run-project-cell", "run", {
        projectId,
        cellId: added.createdCellId,
      }),
    ];
  const run = z
    .object({ runId: z.string().min(1), threadId: z.string().min(1) })
    .passthrough()
    .parse(chartToolResult(results, "run"));
  const reads = results.filter((item) =>
    item.tool_use_id.startsWith("toolu_first_chart_read"),
  );
  const latestRead = reads.at(-1);
  const resultIds: string[] = [];
  if (latestRead) {
    if (latestRead.is_error || typeof latestRead.content !== "string")
      throw new Error("First-run chart run read failed");
    const read = z
      .object({
        status: z.literal("found"),
        run: z.object({
          attempts: z.array(
            z.object({
              state: z
                .object({
                  status: z.string(),
                  resultIds: z.array(z.string()).optional(),
                })
                .passthrough(),
            }),
          ),
        }),
      })
      .passthrough()
      .parse(JSON.parse(latestRead.content));
    for (const attempt of read.run.attempts) {
      if (
        attempt.state.status === "failed" ||
        attempt.state.status === "cancelled"
      )
        throw new Error(`First-run chart cell run ${attempt.state.status}`);
      if (attempt.state.status === "complete")
        resultIds.push(...(attempt.state.resultIds ?? []));
    }
  }
  if (resultIds.length === 0) {
    if (reads.length >= 40)
      throw new Error("First-run chart run never completed");
    return [
      chartTool("get-notebook-run", `read${reads.length}`, {
        runId: run.runId,
        threadId: run.threadId,
        first: 100 - reads.length,
      }),
    ];
  }
  if (stageResults("widget").length === 0)
    return [
      chartTool("render-data-widget", "widget", {
        widget: "data-chart",
        widgetId: required(resultIds[0]),
        title: "Amount by label",
        chartSeries: {
          type: "bar",
          xKey: "label",
          series: [{ key: "amount", label: "Amount" }],
          data: rows.map((row) => ({ label: row.label, amount: row.amount })),
        },
      }),
    ];
  const widget = stageResults("widget")[0];
  if (!widget || widget.is_error)
    throw new Error("First-run chart widget render failed");
  return [{ type: "text", text: "I charted amount by label." }];
}

function defaultConnectionQuery(
  text: string,
  results: ToolResult[],
  tools: Array<{ name: string }>,
): Block[] | null {
  const match =
    /^Create and run a SQL cell named qa_agent_default in project (\S+) with query: (.+)$/.exec(
      text,
    );
  if (!match) return null;
  const projectId = required(match[1]);
  const source = required(match[2]);
  const tool = (name: string, stage: string, input: unknown): Block => ({
    type: "tool_use",
    id: `toolu_default_${stage}_${randomUUID().replaceAll("-", "")}`,
    name,
    input,
  });
  const read = (stage: string): unknown => {
    const found = results
      .filter((item) => item.tool_use_id.startsWith(`toolu_default_${stage}_`))
      .at(-1);
    if (!found) return undefined;
    if (found.is_error || typeof found.content !== "string")
      throw new Error(`Default connection fixture failed at ${stage}`);
    return JSON.parse(found.content);
  };
  const invoke = (name: string, stage: string, input: unknown): Block[] => {
    const offered = tools.some((item) => item.name === name);
    if (
      !offered &&
      results.some((item) =>
        item.tool_use_id.startsWith(`toolu_default_find${stage}_`),
      )
    )
      throw new Error(`Default connection could not discover ${name}`);
    return [
      tool(
        offered ? name : "tool-search",
        offered ? stage : `find${stage}`,
        offered ? input : { query: name },
      ),
    ];
  };
  const added = read("add");
  if (added === undefined)
    return invoke("add-project-cell", "add", {
      projectId,
      kind: "sql",
      name: "qa_agent_default",
      source,
    });
  const { createdCellId: targetCellId, threadId } = z
    .object({
      createdCellId: z.string().min(1),
      threadId: z.string().min(1),
      proposalIds: z.array(z.string()).min(1),
    })
    .parse(added);
  const pending = read("pending");
  const review =
    pending === undefined
      ? undefined
      : notebookPendingChangesSchema.parse(pending);
  if (review?.hasMore) throw new Error("Default query review is incomplete");
  const candidate = review?.changes.find(
    (change) => change.cellId === targetCellId && change.status === "pending",
  );
  if (review && !candidate) throw new Error("Default query proposal missing");
  const candidateId = candidate?.resultIds[0];
  if (!candidateId || !candidate.runId) {
    const reads = results.filter((item) =>
      item.tool_use_id.startsWith("toolu_default_pending_"),
    ).length;
    if (reads >= 100) throw new Error("Default query candidate did not settle");
    return invoke("get-notebook-pending-changes", "pending", {
      projectId,
      threadId,
      ...(review
        ? { after: (BigInt(review.cursor) + BigInt(reads)).toString() }
        : {}),
    });
  }
  if (candidate.resultIds.length !== 1)
    throw new Error("Default query candidate has ambiguous results");
  const current = read("run");
  if (current === undefined)
    return invoke("get-notebook-run", "run", {
      runId: candidate.runId,
      threadId,
    });
  const { run } = z
    .object({ status: z.literal("found"), run: runReceiptSchema })
    .parse(current);
  const attempt = run.attempts.find(
    ({ attempt }) => attempt.cellId === targetCellId,
  );
  if (
    run.runId !== candidate.runId ||
    attempt?.state.status !== "complete" ||
    !attempt.state.resultIds.some((id) => id === candidateId)
  )
    throw new Error("Default query candidate run is not complete");
  const rows = read("rows");
  if (rows === undefined)
    return invoke("get-notebook-result-page", "rows", {
      resultId: candidateId,
      threadId,
      page: 1,
    });
  z.object({
    status: z.literal("ready"),
    rows: z.array(z.array(z.unknown())).min(1),
    manifest: z.object({
      status: z.literal("complete"),
      result: z.object({ resultId: z.literal(candidateId) }),
    }),
  }).parse(rows);
  return [
    {
      type: "text",
      text: "I ran the proposed SQL cell with the default connection and read back its result. It is ready for your review.",
    },
  ];
}

function claimReadback(
  text: string,
  results: ToolResult[],
  tools: Array<{ name: string }>,
): Block[] | null {
  const match =
    /^In this project create a SQL cell named base with exactly SELECT 'one' AS label, 1 AS value, add a configured bar chart bound to base with label on the x-axis and value on the y-axis, and rename this project to "QA verified ([^"]+)"\. Read the project back before reporting what you saved\.$/.exec(
      text,
    );
  if (!match) return null;
  const projectId = required(match[1]);
  const title = `QA verified ${projectId}`;
  const tool = (name: string, stage: string, input: unknown): Block => ({
    type: "tool_use",
    id: `toolu_claim_${stage}_${randomUUID().replaceAll("-", "")}`,
    name,
    input,
  });
  const result = (stage: string): unknown | undefined => {
    const found = results.filter((item) =>
      item.tool_use_id.startsWith(`toolu_claim_${stage}_`),
    );
    if (!found.length) return undefined;
    if (
      (found.length !== 1 && stage !== "sqlReady") ||
      found.length > 100 ||
      found.at(-1)?.is_error ||
      typeof found.at(-1)?.content !== "string"
    )
      throw new Error(`Claim ${stage} tool result missing or failed`);
    const content = found.at(-1)?.content;
    if (typeof content !== "string")
      throw new Error("Claim tool result unreadable");
    return JSON.parse(
      stage.startsWith("discover")
        ? required(content.split("\n\n")[0])
        : content,
    );
  };
  const invoke = (name: string, stage: string, input: unknown): Block[] => {
    const discovered = result(`discover${stage}`);
    const offered = tools.some((item) => item.name === name);
    if (discovered !== undefined) {
      const search = z
        .object({
          results: z.array(
            z.object({ name: z.string(), callable: z.boolean() }),
          ),
        })
        .parse(discovered);
      if (
        !offered ||
        !search.results.some((item) => item.name === name && item.callable)
      )
        throw new Error(`Claim ${name} tool not offered after discovery`);
    }
    if (!offered)
      return [tool("tool-search", `discover${stage}`, { query: name })];
    return [tool(name, stage, input)];
  };
  const initial = result("initial");
  if (initial === undefined)
    return invoke("get-project", "initial", { projectId });
  z.object({ project: z.object({ id: z.literal(projectId) }) }).parse(initial);
  const sql = result("sql");
  if (sql === undefined)
    return invoke("add-project-cell", "sql", {
      projectId,
      kind: "sql",
      name: "base",
      source: "SELECT 'one' AS label, 1 AS value",
    });
  const addedSchema = z.object({
    createdCellId: z.string().min(1),
    threadId: z.string().min(1),
    proposalIds: z.array(z.string()).min(1),
  });
  const sqlProposal = addedSchema.parse(sql);
  const sqlReady = result("sqlReady");
  const sourceReview =
    sqlReady === undefined
      ? undefined
      : notebookPendingChangesSchema.parse(sqlReady);
  if (sourceReview?.hasMore) throw new Error("Claim SQL review is incomplete");
  const candidate = sourceReview?.changes.find(
    (change) =>
      change.cellId === sqlProposal.createdCellId &&
      change.status === "pending",
  );
  const sourceResultId = candidate?.resultIds[0];
  if (!sourceResultId) {
    const reads = results.filter((item) =>
      item.tool_use_id.startsWith("toolu_claim_sqlReady_"),
    ).length;
    if (reads >= 100) throw new Error("Claim SQL candidate did not settle");
    return invoke("get-notebook-pending-changes", "sqlReady", {
      projectId,
      threadId: sqlProposal.threadId,
      ...(sourceReview
        ? { after: (BigInt(sourceReview.cursor) + BigInt(reads)).toString() }
        : {}),
    });
  }
  if (candidate.resultIds.length !== 1)
    throw new Error("Claim SQL candidate is ambiguous");
  const sourceResult = result("sqlResult");
  if (sourceResult === undefined)
    return invoke("get-notebook-result-page", "sqlResult", {
      resultId: sourceResultId,
      threadId: sqlProposal.threadId,
      page: 1,
    });
  const sourcePage = z
    .object({
      status: z.literal("ready"),
      rows: z.tuple([z.tuple([z.literal("one"), z.literal(1)])]),
      manifest: z.object({
        status: z.literal("complete"),
        result: z.object({
          resultId: z.literal(sourceResultId),
          producer: z.object({ exportId: z.string().min(1) }),
        }),
        fields: z.tuple([
          z.object({ fieldId: z.string().min(1), name: z.literal("label") }),
          z.object({ fieldId: z.string().min(1), name: z.literal("value") }),
        ]),
      }),
    })
    .parse(sourceResult);
  const chart = result("chart");
  if (chart === undefined)
    return invoke("add-project-cell", "chart", {
      projectId,
      kind: "chart",
      dataframe: "base",
      afterCellId: sqlProposal.createdCellId,
    });
  const chartProposal = addedSchema.parse(chart);
  if (chartProposal.threadId !== sqlProposal.threadId)
    throw new Error("Claim proposals belong to different conversations");
  const threadId = sqlProposal.threadId;
  const pending = result("pending");
  if (pending === undefined)
    return invoke("get-notebook-pending-changes", "pending", {
      projectId,
      threadId,
    });
  const proposed = notebookPendingChangesSchema.parse(pending);
  if (proposed.hasMore) throw new Error("Claim pending read is incomplete");
  const cell = proposed.changes
    .flatMap(({ after }) => after?.cells ?? [])
    .find(({ id }) => id === chartProposal.createdCellId);
  if (!cell) throw new Error("Claim chart proposal missing");
  const contents = chartCellContentsSchema.parse(cell.contents);
  const spec = contents.chartSpec;
  if (
    spec.mark !== "bar" ||
    spec.sourceCellId !== sqlProposal.createdCellId ||
    spec.sourceExportId !== sourcePage.manifest.result.producer.exportId ||
    !spec.xField ||
    !spec.yField ||
    spec.fieldLabels?.[spec.xField] !== "label" ||
    spec.fieldLabels[spec.yField] !== "value"
  )
    throw new Error("Claim chart was not bound to the query fields");
  const renamed = result("rename");
  if (renamed === undefined)
    return invoke("update-project", "rename", { projectId, title });
  z.object({
    project: z.object({ id: z.literal(projectId), title: z.literal(title) }),
  }).parse(renamed);
  const read = result("read");
  if (read === undefined)
    return invoke("get-notebook-pending-changes", "read", {
      projectId,
      threadId,
    });
  const reviewed = notebookPendingChangesSchema.parse(read);
  if (
    reviewed.hasMore ||
    reviewed.changes.some(({ status }) => status !== "pending")
  )
    throw new Error("Claim review is incomplete or no longer pending");
  const cells = reviewed.changes.flatMap(({ after }) => after?.cells ?? []);
  z.object({
    kind: z.literal("sql"),
    source: z.literal("SELECT 'one' AS label, 1 AS value"),
    resultVariable: z.literal("base"),
  }).parse(cells.find(({ id }) => id === sqlProposal.createdCellId)?.contents);
  z.object({
    kind: z.literal("chart"),
    dataframe: z.literal("base"),
    chartSpec: z.object({
      mark: z.literal("bar"),
      xField: z.literal(spec.xField),
      yField: z.literal(spec.yField),
    }),
  }).parse([...cells].reverse().find(({ id }) => id === cell.id)?.contents);
  return [
    {
      type: "text",
      text: "I renamed the project and read back the SQL and bar chart proposals. They are ready for your review.",
    },
  ];
}

/**
 * Scripted behaviours, keyed on the question text:
 *  - "[chart]"  : tool_use list-data-connections first, then (after its tool_result) a chart answer.
 *  - "[stream]" : the answer arrives in several slow pieces (~1.2 s overall).
 *  - "[slow]"   : nothing for 2.5 s, then a short answer.
 *  - "[error]"  : the model call fails (HTTP 529) every time.
 *  - "[tool-error]": tool_use of an action that fails (get-project with a missing id), then a text answer.
 *  - "[missing-project]": an answer that links a project id that does not exist.
 * Anything else gets a short plain answer that echoes the question.
 */
export async function answerModelRequest(
  input: Record<string, unknown>,
  res: ModelResponse,
  state: ModelState,
) {
  state.requests.push(input);
  const stream = input.stream === true;
  const model = String(input.model ?? "claude-fake");
  const system = JSON.stringify(input.system ?? "");
  const tools = Array.isArray(input.tools)
    ? (input.tools as Array<{ name: string }>)
    : [];
  const { text, toolResults } = lastUserTurn(input as { messages?: Message[] });
  if (/title/i.test(system) && !tools.length)
    return reply(
      res,
      [{ type: "text", text: "Daily question" }],
      stream,
      model,
    );
  // Side calls (follow-up suggestions) never fail or stall the visible answer.
  if (tools.length === 1 && required(tools[0]).name === "suggest-follow-ups")
    return reply(res, [{ type: "text", text: "" }], stream, model);
  const phase1 = await phase1Model(text, toolResults, tools);
  if (phase1) return reply(res, phase1, stream, model);
  const scriptedClaim = claimReadback(text, toolResults, tools);
  if (scriptedClaim) return reply(res, scriptedClaim, stream, model);
  const scriptedChart = firstRunChart(
    text,
    toolResults,
    tools,
    JSON.stringify(input),
  );
  if (scriptedChart) return reply(res, scriptedChart, stream, model);
  const scriptedDefault = defaultConnectionQuery(text, toolResults, tools);
  if (scriptedDefault) return reply(res, scriptedDefault, stream, model);
  if (text.includes("[error]")) {
    res.writeHead(529, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "overloaded_error", message: MODEL_ERROR_TEXT },
      }),
    );
    return;
  }
  if (text.includes("[slow]")) await wait(2500);
  if (text.includes("[chart]")) {
    if (toolResults.length === 0)
      return reply(
        res,
        [
          { type: "text", text: "Let me look at the connected data first." },
          {
            type: "tool_use",
            id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
            name: "list-data-connections",
            input: {},
          },
        ],
        stream,
        model,
      );
    return reply(
      res,
      [
        {
          type: "text",
          text: `Here is revenue by month.\n\n${FAKE_CHART_LINE}\n\nRevenue peaked in April.`,
        },
      ],
      stream,
      model,
    );
  }
  if (text.includes("[tool-error]")) {
    if (toolResults.length === 0)
      return reply(
        res,
        [
          {
            type: "tool_use",
            id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
            name: "get-project",
            input: { projectId: "missing-project-id" },
          },
        ],
        stream,
        model,
      );
    return reply(
      res,
      [{ type: "text", text: "That project could not be read." }],
      stream,
      model,
    );
  }
  if (text.includes("[missing-project]"))
    return reply(
      res,
      [
        {
          type: "text",
          text: `See [${MISSING_PROJECT_TITLE}](/project/${MISSING_PROJECT_ID}/latest) for the earlier analysis.`,
        },
      ],
      stream,
      model,
    );
  const streamed = text.includes("[stream]");
  return reply(
    res,
    [
      {
        type: "text",
        text: `Here is what I found for: ${text.slice(0, 80)}${streamed ? ". The first piece, then the second piece, then the third piece, then the last piece." : ""}`,
      },
    ],
    stream,
    model,
    streamed ? { gapMs: 250, pieces: 5 } : {},
  );
}
