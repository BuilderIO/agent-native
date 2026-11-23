import { expect, type Page, type Request } from "@playwright/test";
import { z } from "zod";

import {
  chartCellContentsSchema,
  type ProjectDocument,
} from "../app/lib/model/contracts.js";
import { runReceiptSchema } from "../shared/notebook-execution.js";
import { notebookTransformSchema } from "../shared/visualization-contracts.js";
import { readAttempt } from "./phase1/execution-readback.js";

type ProjectFixture = { id: string; href: string };
type Helpers = {
  create(page: Page, purpose: string): Promise<ProjectFixture>;
  createFromHome(page: Page): Promise<ProjectFixture>;
  open(page: Page, href: string): Promise<void>;
  read(page: Page, id: string): Promise<ProjectDocument>;
};

function diagnosticId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : null;
}

export async function waitForCellRerun(
  read: () => Promise<{
    queryStates: Record<
      string,
      { requestId: string; status: string } | undefined
    >;
  }>,
  cellId: string,
  requestId: string,
  initialStatus: string,
  options: { timeout: number; intervals: number[] } = {
    timeout: 30000,
    intervals: [250, 1000],
  },
) {
  if (initialStatus === "complete") return;
  if (initialStatus !== "running")
    throw new Error(`SQL rerun ended ${initialStatus}`);
  let observed: { requestId: string; status: string } | undefined;
  try {
    await expect
      .poll(
        async () => {
          const state = (await read()).queryStates[cellId];
          observed = state;
          if (state?.requestId !== requestId) return "waiting for rerun";
          if (
            ["error", "cancelled", "cancel_unknown", "unavailable"].includes(
              state.status,
            )
          )
            throw new Error(`SQL rerun ended ${state.status}`);
          return state.status;
        },
        { ...options, message: "Submitted SQL rerun must complete" },
      )
      .toBe("complete");
  } catch (error) {
    const statuses = [
      "not_run",
      "queued",
      "running",
      "cancelling",
      "cancel_unknown",
      "cancelled",
      "complete",
      "error",
      "unavailable",
    ];
    console.log(
      "SQL RERUN DIAGNOSTIC",
      JSON.stringify({
        expectedRequestId: diagnosticId(requestId),
        observedRequestId: diagnosticId(observed?.requestId),
        status:
          observed && statuses.includes(observed.status)
            ? observed.status
            : "unavailable",
      }),
    );
    throw error;
  }
}

export async function waitForAgentRun(
  page: Page,
  base: string,
  threadId: string,
  options: { timeout: number; intervals: number[] } = {
    timeout: 180000,
    intervals: [2000, 5000],
  },
) {
  const latest = `${base}/_agent-native/agent-chat/runs/latest?${new URLSearchParams({ threadId })}`;
  try {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(latest);
          if (response.status() === 404) return "pending";
          if (!response.ok())
            throw new Error(`Agent run status HTTP ${response.status()}`);
          const result = (await response.json()) as { status?: string };
          if (["errored", "aborted", "truncated"].includes(result.status ?? ""))
            throw new Error(`Agent run ${result.status}`);
          return result.status;
        },
        { ...options, message: "Agent run must complete" },
      )
      .toBe("completed");
  } catch (error) {
    try {
      const response = await page.request.get(latest, { timeout: 5000 });
      if (!response.ok())
        throw new Error(`Run diagnostic HTTP ${response.status()}`);
      const run = (await response.json()) as Record<string, unknown>;
      let toolSummary: string[] | "unavailable" = "unavailable";
      try {
        const thread = await page.request.get(
          `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(threadId)}`,
          { timeout: 5000 },
        );
        if (!thread.ok())
          throw new Error(`Thread diagnostic HTTP ${thread.status()}`);
        const snapshot = (await thread.json()) as { threadData?: unknown };
        if (typeof snapshot.threadData !== "string")
          throw new Error("Thread diagnostic unreadable");
        const data: unknown = JSON.parse(snapshot.threadData);
        const allowedTools = new Set([
          "add-project-cell",
          "run-project-cell",
          "update-project-cell",
          "get-project",
          "update-project",
          "tool-search",
        ]);
        const tools = new Set<string>();
        const queue: unknown[] = [data];
        for (let i = 0; i < queue.length && i < 10000; i++) {
          const value = queue[i];
          if (!value || typeof value !== "object") continue;
          if (Array.isArray(value)) {
            queue.push(...value.slice(0, Math.max(0, 10000 - queue.length)));
            continue;
          }
          const item = value as Record<string, unknown>;
          if (
            item.type === "tool-call" &&
            typeof item.toolName === "string" &&
            allowedTools.has(item.toolName)
          )
            tools.add(item.toolName);
          for (const key of ["agentKit", "messages", "content", "parts"])
            if (item[key]) queue.push(item[key]);
        }
        toolSummary = [...tools];
      } catch {
        toolSummary = "unavailable";
      }
      const timestamp = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value
          : null;
      const status = [
        "queued",
        "running",
        "completed",
        "errored",
        "aborted",
        "truncated",
      ].includes(String(run.status))
        ? run.status
        : "unrecognized";
      console.log(
        "AGENT RUN DIAGNOSTIC",
        JSON.stringify({
          threadId: diagnosticId(threadId),
          runId: diagnosticId(run.runId),
          status,
          startedAt: timestamp(run.startedAt),
          heartbeatAt: timestamp(run.heartbeatAt),
          lastProgressAt: timestamp(run.lastProgressAt),
          tools: toolSummary,
        }),
      );
    } catch {
      console.log(
        "AGENT RUN DIAGNOSTIC",
        JSON.stringify({
          threadId: diagnosticId(threadId),
          run: "unavailable",
        }),
      );
    }
    throw error;
  }
}

export async function report1794947190(page: Page, helpers: Helpers) {
  const project = await helpers.createFromHome(page);
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await helpers.open(page, project.href);
      const prompt = page.getByRole("textbox", {
        name: "What would you like to know?",
      });
      await expect(prompt).toBeEnabled({
        timeout: attempt === 0 ? 2000 : 20000,
      });
      await prompt.click();
      await expect(prompt).toBeFocused();
      await prompt.fill("Show billing");
      await expect(prompt).toHaveValue("Show billing", { timeout: 400 });
      await page.getByRole("button", { name: "More", exact: true }).click();
      // oracle-change: the cell menu is titled More and dismisses with Escape; its Close row was removed.
      const menu = page.getByRole("menu", { name: "More", exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem").first()).toBeEnabled();
      await menu.press("Escape");
      await expect(menu).toBeHidden();
    }
    await page.getByRole("button", { name: "Search for data" }).click();
    // oracle-change: the data browser is a non-modal side panel; retain the immediate-open deadline.
    const dataBrowser = page.getByRole("complementary", {
      name: "Data browser",
    });
    await expect(dataBrowser).toBeVisible({ timeout: 400 });
    await expect(
      page.getByRole("dialog", { name: "Data browser" }),
    ).toHaveCount(0);
    await dataBrowser
      .getByRole("button", { name: "Close Data browser" })
      .click();
    await expect(dataBrowser).toBeHidden();
    // oracle-change: Upload a CSV now opens the CSV picker directly; retain the 400 ms response deadline.
    const [csvPicker] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 400 }),
      page.getByRole("button", { name: "Upload a CSV" }).click(),
    ]);
    expect(await csvPicker.element().getAttribute("accept")).toBe(
      ".csv,text/csv",
    );
    expect(csvPicker.isMultiple()).toBe(false);
    await csvPicker.setFiles([]);
    expect((await helpers.read(page, project.id)).cells).toEqual([]);
    await page.evaluate(() => {
      const original = window.postMessage.bind(window);
      window.postMessage = (
        message: unknown,
        targetOrigin?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          "data" in message &&
          message.type === "agentNative.submitChat"
        ) {
          document.documentElement.dataset.testAgentSubmission = JSON.stringify(
            message.data,
          );
          return;
        }
        if (typeof targetOrigin === "string")
          original(message, targetOrigin, transfer);
        else original(message, targetOrigin);
      };
    });
    const prompt = page.getByRole("textbox", {
      name: "What would you like to know?",
    });
    await prompt.press("Enter");
    await expect
      .poll(
        () => page.locator("html").getAttribute("data-test-agent-submission"),
        { timeout: 400 },
      )
      .toEqual(expect.stringContaining("Show billing"));
    const submission = JSON.parse(
      (await page.locator("html").getAttribute("data-test-agent-submission")) ??
        "null",
    ) as { context?: string; submit?: boolean };
    expect(submission.submit).toBe(true);
    expect(submission.context).toContain(project.id);
    expect(errors).toEqual([]);
  } finally {
    page.off("pageerror", onError);
  }
}

export async function report1794947983(
  page: Page,
  helpers: Helpers,
  base: string,
  snapshotThreadId: (request: Request) => string | null,
) {
  const project = await helpers.create(page, "agent cell readback");
  const title = `QA verified ${project.id}`;
  await helpers.open(page, project.href);
  const prompt = page.getByRole("textbox", {
    name: "What would you like to know?",
  });
  await prompt.fill(
    `In this project create a SQL cell named base with exactly SELECT 'one' AS label, 1 AS value, add a configured bar chart bound to base with label on the x-axis and value on the y-axis, and rename this project to "${title}". Read the project back before reporting what you saved.`,
  );
  const snapshot = page.waitForRequest(
    (request) => snapshotThreadId(request) !== null,
    { timeout: 60000 },
  );
  await prompt.press("Enter");
  const submittedSnapshot = await snapshot;
  const threadId = snapshotThreadId(submittedSnapshot);
  if (!threadId) throw new Error("Agent thread was not identified");
  await waitForAgentRun(page, base, threadId);
  expect((await helpers.read(page, project.id)).cells).toHaveLength(0);
  await page
    .getByRole("button", { name: "View pending changes", exact: true })
    .click();
  const confirmation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/_agent-native/actions/decide-notebook-pending-changes" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm all", exact: true }).click();
  const confirmed = await confirmation;
  expect(confirmed.ok()).toBe(true);
  expect(await confirmed.json()).toMatchObject({
    decision: "confirm",
    checkpointId: expect.any(String),
  });
  await expect
    .poll(async () => (await helpers.read(page, project.id)).cells.length)
    .toBe(2);
  await helpers.open(page, `/thread/${encodeURIComponent(threadId)}`);
  const reply = page
    .locator('article.agentkit-message[data-role="assistant"]')
    .last();
  try {
    await expect(reply).toBeVisible();
  } catch (error) {
    try {
      const articles = await page.locator("article").evaluateAll((nodes) => ({
        total: nodes.length,
        messages: nodes.filter((node) =>
          node.classList.contains("agentkit-message"),
        ).length,
        assistants: nodes.filter(
          (node) => node.getAttribute("data-role") === "assistant",
        ).length,
        users: nodes.filter((node) => node.getAttribute("data-role") === "user")
          .length,
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const saved = await Promise.race([
        helpers.read(page, project.id),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Project diagnostic timed out")),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      console.log(
        "AGENT CLAIM DIAGNOSTIC",
        JSON.stringify({
          articles,
          titleMatches: saved.title === title,
          cells: saved.cells.map((cell) => ({
            kind: cell.contents.kind,
            baseLabel:
              cell.contents.kind === "sql" &&
              (cell.contents.label === "base" ||
                cell.contents.resultVariable === "base"),
          })),
        }),
      );
    } catch {
      console.log("AGENT CLAIM DIAGNOSTIC unavailable");
    }
    throw error;
  }
  await expect(reply).not.toHaveAttribute("aria-busy", "true");
  expect((await reply.innerText()).trim()).not.toBe("");
  const saved = await helpers.read(page, project.id);
  expect(saved.title).toBe(title);
  expect(
    saved.cells.some(
      (cell) =>
        cell.contents.kind === "sql" &&
        cell.contents.source.trim() === "SELECT 'one' AS label, 1 AS value" &&
        (cell.contents.label === "base" ||
          cell.contents.resultVariable === "base"),
    ),
  ).toBe(true);
  expect(
    saved.cells.some(
      (cell) =>
        cell.contents.kind === "chart" &&
        cell.contents.dataframe === "base" &&
        cell.contents.chartSpec.mark === "bar" &&
        cell.contents.chartSpec.fieldLabels?.[
          cell.contents.chartSpec.xField ?? ""
        ] === "label" &&
        cell.contents.chartSpec.fieldLabels[
          cell.contents.chartSpec.yField ?? ""
        ] === "value",
    ),
  ).toBe(true);
  await helpers.open(page, project.href);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(
    page
      .locator("[data-notebook-cell]")
      .filter({ hasText: "SELECT 'one' AS label, 1 AS value" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-notebook-cell]").filter({ hasText: /chart/i }).first(),
  ).toBeVisible();

  const sql = saved.cells.find(
    (cell) =>
      cell.contents.kind === "sql" &&
      cell.contents.source.trim() === "SELECT 'one' AS label, 1 AS value" &&
      cell.contents.resultVariable === "base",
  );
  const chart = saved.cells.find(
    (cell) =>
      cell.contents.kind === "chart" &&
      cell.contents.dataframe === "base" &&
      cell.contents.chartSpec.mark === "bar" &&
      cell.contents.chartSpec.fieldLabels?.[
        cell.contents.chartSpec.xField ?? ""
      ] === "label" &&
      cell.contents.chartSpec.fieldLabels[
        cell.contents.chartSpec.yField ?? ""
      ] === "value",
  );
  if (!sql || !chart) throw new Error("Saved SQL result or chart is missing");
  const savedChartSpec = chartCellContentsSchema.parse(
    chart.contents,
  ).chartSpec;
  const sqlCell = page.locator(`[data-notebook-cell="${sql.id}"]`);
  const chartCell = page.locator(`[data-notebook-cell="${chart.id}"]`);
  await sqlCell.hover();
  const submitted = page.waitForResponse(
    (response) => {
      const request = response.request();
      if (
        request.method() !== "POST" ||
        new URL(request.url()).pathname !==
          "/_agent-native/actions/start-notebook-run"
      )
        return false;
      const body = z
        .object({
          snapshot: z.object({ ref: z.object({ projectId: z.string() }) }),
          targetCellId: z.string(),
        })
        .safeParse(request.postDataJSON());
      return (
        body.success &&
        body.data.snapshot.ref.projectId === project.id &&
        body.data.targetCellId === sql.id
      );
    },
    { timeout: 30000 },
  );
  await sqlCell.locator('[data-rid="notebook.cell.run"]').click();
  const runResponse = await submitted;
  if (!runResponse.ok())
    throw new Error(`SQL rerun HTTP ${runResponse.status()}`);
  const receipt = runReceiptSchema.parse(await runResponse.json());
  expect(receipt.status).toBe("admitted");
  const get = async (name: string, input: Record<string, string>) => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/${name}?${new URLSearchParams(input)}`,
      { headers: { "x-agent-native-frontend": "1" } },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  await expect
    .poll(
      async () => {
        const attempt = readAttempt(
          await get("get-notebook-run", { runId: receipt.runId }),
          receipt.runId,
          sql.id,
        );
        if (["failed", "cancelled"].includes(attempt.state.status))
          throw new Error(`SQL rerun ended ${attempt.state.status}`);
        return attempt.state.status;
      },
      { timeout: 30000 },
    )
    .toBe("complete");
  const assertResult = async () => {
    const execution = z
      .object({
        cells: z.record(
          z.string(),
          z.object({ resultId: z.string().nullable() }),
        ),
      })
      .parse(await get("get-notebook-execution", { projectId: project.id }));
    const resultId = execution.cells[sql.id]?.resultId;
    if (!resultId) throw new Error("Saved SQL result missing");
    expect(
      await get("get-notebook-result-page", { resultId, page: "1" }),
    ).toMatchObject({
      status: "ready",
      page: 1,
      manifest: {
        status: "complete",
        rowCount: "1",
        result: { resultId },
        fields: [
          { fieldId: "0", name: "label", type: "string" },
          { fieldId: "1", name: "value", type: "number" },
        ],
      },
      rows: [["one", 1]],
    });
  };
  await expect(sqlCell.locator(".nb-table tbody tr")).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(sqlCell.locator(".nb-table tbody tr").first()).toContainText(
    "one",
  );
  await assertResult();
  const assertBar = async () => {
    const transform = notebookTransformSchema.parse(
      await get("get-notebook-transform", {
        projectId: project.id,
        cellId: chart.id,
        mode: "chart",
      }),
    );
    const source = transform.sources.find(
      ({ binding }) => binding.cellId === sql.id,
    );
    if (!source) throw new Error("Saved chart source missing");
    const x = source.fields.find(({ name }) => name === "label");
    const y = source.fields.find(({ name }) => name === "value");
    if (!x || !y) throw new Error("Saved chart fields missing");
    expect(
      (await helpers.read(page, project.id)).cells.find(
        ({ id }) => id === chart.id,
      )?.contents,
    ).toMatchObject({
      kind: "chart",
      dataframe: "base",
      chartSpec: {
        sourceCellId: sql.id,
        mark: "bar",
        xField: x.fieldId,
        yField: y.fieldId,
      },
    });
    expect(transform.result).toMatchObject({
      status: "ready",
      kind: "chart",
      rows: [{ x: "one", value: 1 }],
    });
    const bar = chartCell.locator(".nb-chart-mark-bar g.mark-rect path");
    try {
      await expect(bar).toHaveCount(1);
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute(
        "aria-label",
        "x: one; value: 1; series: value; label: one; Value: 1",
      );
    } catch (error) {
      try {
        console.log(
          "CLAIM CHART",
          await chartCell.innerText({ timeout: 3000 }),
        );
        await page.screenshot({
          path: ".tmp/analytics-owner/claim-chart-before-cleanup.png",
          timeout: 3000,
        });
      } catch {
        console.log("CLAIM CHART diagnostic unavailable");
      }
      throw error;
    }
  };
  await assertBar();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(sqlCell.locator(".nb-table tbody tr").first()).toContainText(
    "one",
  );
  await assertResult();
  await assertBar();
  expect(
    (await helpers.read(page, project.id)).cells.find(
      (cell) => cell.id === chart.id,
    )?.contents,
  ).toMatchObject({
    kind: "chart",
    dataframe: "base",
    chartSpec: {
      sourceCellId: sql.id,
      mark: "bar",
      xField: savedChartSpec.xField,
      yField: savedChartSpec.yField,
      fieldLabels: savedChartSpec.fieldLabels,
    },
  });
  await chartCell.scrollIntoViewIfNeeded();
  const screenshot = `.tmp/analytics-2-constant-sql-chart-${Date.now()}.png`;
  await page.screenshot({ path: screenshot });
  console.log(`EXPLICIT USER RUN chart screenshot ${screenshot}`);
}
