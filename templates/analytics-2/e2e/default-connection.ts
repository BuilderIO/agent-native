import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { runReceiptSchema } from "../shared/notebook-execution.js";
import { prepareDefaultConnectionFixture } from "./default-connection-fixture.js";
import { safeErrorDiagnostic } from "./failure-diagnostic.js";
import { readAttempt } from "./phase1/execution-readback.js";
import { writeSqlEditor } from "./sql-editor.js";
import { fetchUiAction } from "./ui-capability.js";

export function actionPath(base: string, action: string): string {
  return new URL(`${base.replace(/\/$/, "")}/_agent-native/actions/${action}`)
    .pathname;
}

export async function selectLiveFlowModel(
  page: Page,
): Promise<{ status: "pass" } | { status: "unavailable"; reason: string }> {
  const button = page.locator(
    '[data-agent-composer-variant="hero"] [data-agent-composer-slot="model-button"]',
  );
  const model = page.locator(
    '[data-agent-composer-model-row="claude-sonnet-5-5"]:visible',
  );
  const effortSection = page.locator(
    '[data-agent-composer-model-section="effort"]:visible',
  );
  const medium = page.locator(
    '[data-agent-composer-effort-level="medium"]:visible',
  );
  let stage = "open model picker";
  try {
    await button.click({ timeout: 10000 });
    await expect(model).toBeEnabled({ timeout: 10000 });
    stage = "select model";
    await model.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(model).toBeHidden();
    await expect(button).toHaveAttribute("aria-label", /Sonnet 5\.5/);
    await button.click();
    await expect(model).toHaveAttribute("aria-checked", "true");
    stage = "select medium effort";
    await effortSection.hover();
    await expect(medium).toBeEnabled();
    await medium.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(medium).toBeHidden();
    await expect(button).toHaveAttribute("aria-label", /Effort: Medium/);
    stage = "verify model and effort";
    await button.click();
    await expect(model).toHaveAttribute("aria-checked", "true");
    await effortSection.hover();
    await expect(medium).toHaveAttribute("aria-checked", "true");
    stage = "close model picker";
    await page.keyboard.press("Escape");
    if ((await button.getAttribute("aria-expanded")) === "true")
      await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(model).toBeHidden();
    await expect(effortSection).toBeHidden();
    await expect(medium).toBeHidden();
    console.log("MODEL claude-sonnet-5-5 effort=medium verified");
    return { status: "pass" };
  } catch (error) {
    console.log(
      `MODEL selection failed at ${stage}: ${safeErrorDiagnostic(error)}`,
    );
    return {
      status: "unavailable",
      reason: `Sonnet 5.5 with medium effort unavailable at ${stage}`,
    };
  }
}

/** Uses an already configured QA warehouse and a caller-supplied table query. */
export async function checkDefaultConnection(
  page: Page,
  base: string,
  query: string | undefined,
  expectedRows?: unknown[][],
  selectLiveModel = false,
  fixtureConnectionId?: string,
): Promise<{ status: "pass" } | { status: "unavailable"; reason: string }> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  async function action(
    name: string,
    data: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ) {
    const url = `${base}/_agent-native/actions/${name}`;
    const response = await fetchUiAction(
      page.request,
      base,
      method === "GET"
        ? `${url}?${new URLSearchParams(data as Record<string, string>)}`
        : url,
      { method, ...(method === "POST" ? { data } : {}) },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  }
  if (fixtureConnectionId && (!query || !expectedRows))
    return { status: "unavailable", reason: "The table fixture is incomplete" };
  let selected: { id: string; name: string };
  if (!query || fixtureConnectionId) {
    const prepared = await prepareDefaultConnectionFixture(
      action,
      query && fixtureConnectionId && expectedRows
        ? { connectionId: fixtureConnectionId, query, expectedRows }
        : undefined,
    );
    if (prepared.status === "unavailable") return prepared;
    selected = prepared.selected;
    query = prepared.query;
    expectedRows = prepared.expectedRows;
  } else {
    const connections = z
      .object({
        connections: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            isDefault: z.boolean(),
            isDraft: z.boolean(),
          }),
        ),
      })
      .parse(await action("list-data-connections", {}, "GET"));
    const connection = connections.connections.find(
      (item) => item.isDefault && !item.isDraft,
    );
    if (!connection)
      return {
        status: "unavailable",
        reason: "No default connection is available",
      };
    selected = connection;
  }
  if (!query)
    throw new Error("Default connection query missing after preparation");
  const created = z.object({ id: z.string() }).parse(
    await action("create-project", {
      title: `Default connection QA ${randomUUID()}`,
    }),
  );
  let threadId: string | undefined;
  let primaryError: unknown;
  const read = async () =>
    z
      .object({ project: projectDocumentSchema })
      .parse(await action("get-project", { projectId: created.id }, "GET"))
      .project;
  try {
    await page.goto(
      `${base}/project/${encodeURIComponent(created.id)}/latest`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    await expect.poll(async () => (await read()).cells.length).toBe(1);
    const cell = (await read()).cells.at(0);
    if (!cell || cell.contents.kind !== "sql")
      throw new Error("SQL cell missing");
    expect(cell.contents.dataConnectionId).toBe(selected.id);
    await expect(page.locator("[data-notebook-cell]").first()).toContainText(
      selected.name,
    );
    const editor = page
      .locator(
        "[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source",
      )
      .first();
    await writeSqlEditor(editor, query);
    await editor.press("ControlOrMeta+Enter");
    const resultTable = page.locator("[data-notebook-cell] table").first();
    const assertRenderedRows = async () => {
      await expect(resultTable).toBeVisible({ timeout: 60000 });
      if (
        expectedRows?.length !== 1 ||
        expectedRows[0]?.length !== 1 ||
        expectedRows[0][0] !== 1
      )
        return;
      const rows = resultTable.locator("tbody tr");
      await expect(rows).toHaveCount(expectedRows.length);
      for (const [index, row] of expectedRows.entries()) {
        await expect(rows.nth(index).locator("td")).toHaveText(row.map(String));
      }
    };
    await assertRenderedRows();
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertRenderedRows();
    await expect(page.locator("[data-notebook-cell]").first()).toContainText(
      selected.name,
    );
    expect((await read()).cells.at(0)?.contents).toMatchObject({
      dataConnectionId: selected.id,
      source: query,
    });
    const assertSavedRows = async (cellId: string) => {
      const outputs = z
        .object({
          outputs: z.record(
            z.string(),
            z.object({
              status: z.string(),
              output: z
                .object({
                  type: z.string(),
                  rows: z.array(z.array(z.unknown())),
                })
                .nullable(),
            }),
          ),
        })
        .parse(
          await action("get-project", { projectId: created.id }, "GET"),
        ).outputs;
      expect(outputs[cellId]?.status).toBe("complete");
      expect(outputs[cellId]?.output?.type).toBe("table");
      expect(outputs[cellId]?.output?.rows.length).toBeGreaterThan(0);
      if (expectedRows)
        expect(outputs[cellId]?.output?.rows).toEqual(expectedRows);
    };
    const assertNativeRows = async (cellId: string) => {
      let persistedResultId: string | undefined;
      await expect
        .poll(
          async () => {
            const execution = z
              .object({
                status: z.literal("found"),
                cells: z.record(
                  z.string(),
                  z.object({
                    resultId: z.string().nullable(),
                    stale: z.boolean(),
                    attempt: z
                      .object({ state: z.object({ status: z.string() }) })
                      .nullable(),
                  }),
                ),
              })
              .parse(
                await action(
                  "get-notebook-execution",
                  { projectId: created.id },
                  "GET",
                ),
              );
            if (!Object.hasOwn(execution.cells, cellId)) return false;
            const cell = execution.cells[cellId];
            if (
              cell.attempt &&
              ["failed", "cancelled"].includes(cell.attempt.state.status)
            )
              throw new Error(
                `Native query ended ${cell.attempt.state.status}`,
              );
            if (!cell.stale && cell.resultId) {
              persistedResultId = cell.resultId;
              return true;
            }
            return false;
          },
          { timeout: 60000 },
        )
        .toBe(true);
      const resultId = persistedResultId;
      if (!resultId) throw new Error("Native query result was not persisted");
      const result = z
        .object({
          status: z.literal("ready"),
          rows: z.array(z.array(z.unknown())),
          manifest: z.object({
            status: z.literal("complete"),
            rowCount: z.string(),
            result: z.object({ resultId: z.literal(resultId) }),
          }),
        })
        .parse(await action("get-notebook-result-page", { resultId }, "GET"));
      expect(result.rows.length).toBeGreaterThan(0);
      if (expectedRows) {
        expect(result.rows).toEqual(
          expectedRows.map((row) =>
            row.map((value) =>
              typeof value === "number" && Number.isSafeInteger(value)
                ? { type: "integer", value: String(value) }
                : value,
            ),
          ),
        );
        expect(result.manifest.rowCount).toBe(String(expectedRows.length));
      }
      return resultId;
    };
    await assertNativeRows(cell.id);
    const persisted = (await read()).cells.find((item) => item.id === cell.id);
    if (!persisted || persisted.contents.kind !== "sql")
      throw new Error("Persisted SQL cell missing");
    const { connectionMode: _mode, ...legacyContents } = persisted.contents;
    await action("save-project-cell", {
      projectId: created.id,
      cellId: cell.id,
      contents: { ...legacyContents, dataConnectionId: null },
    });
    expect(
      (await read()).cells.find((item) => item.id === cell.id)?.contents,
    ).toMatchObject({
      kind: "sql",
      dataConnectionId: null,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toBeVisible();
    const rerun = page.waitForResponse(
      (response) => {
        if (
          new URL(response.url()).pathname !==
            actionPath(base, "start-notebook-run") ||
          response.request().method() !== "POST"
        )
          return false;
        const request = z
          .object({
            snapshot: z.object({ ref: z.object({ projectId: z.string() }) }),
            targetCellId: z.string(),
          })
          .safeParse(response.request().postDataJSON());
        return (
          request.success &&
          request.data.snapshot.ref.projectId === created.id &&
          request.data.targetCellId === cell.id
        );
      },
      { timeout: 60000 },
    );
    await editor.press("ControlOrMeta+Enter");
    const rerunResponse = await rerun;
    expect(rerunResponse.ok()).toBe(true);
    const receipt = runReceiptSchema.parse(await rerunResponse.json());
    expect(receipt.status).toBe("admitted");
    await expect
      .poll(
        async () => {
          const attempt = readAttempt(
            await action("get-notebook-run", { runId: receipt.runId }, "GET"),
            receipt.runId,
            cell.id,
          );
          if (["failed", "cancelled"].includes(attempt.state.status))
            throw new Error(`Default SQL rerun ended ${attempt.state.status}`);
          return attempt.state.status;
        },
        { timeout: 60000 },
      )
      .toBe("complete");
    await expect(
      page.locator("[data-notebook-cell] table").first(),
    ).toBeVisible({ timeout: 60000 });
    expect(
      (await read()).cells.find((item) => item.id === cell.id)?.contents,
    ).toMatchObject({
      kind: "sql",
      dataConnectionId: selected.id,
      source: query,
    });
    await assertNativeRows(cell.id);
    const resultSchema = z.object({
      status: z.enum([
        "running",
        "cancelling",
        "cancelled",
        "complete",
        "error",
      ]),
      output: z
        .object({
          type: z.string(),
          rows: z.array(z.array(z.unknown())).optional(),
        })
        .nullable(),
    });
    const runAndRead = async (cellId: string) => {
      let result = resultSchema.parse(
        await action("run-project-cell", { projectId: created.id, cellId }),
      );
      await expect
        .poll(
          async () => {
            if (
              result.status === "error" ||
              result.status === "cancelled" ||
              result.status === "cancelling"
            )
              throw new Error(`SQL run ended ${result.status}`);
            if (result.status === "running")
              result = resultSchema.parse(
                await action("run-project-cell", {
                  projectId: created.id,
                  cellId,
                  operation: "poll",
                }),
              );
            return result.status;
          },
          { timeout: 60000, intervals: [1000, 2000] },
        )
        .toBe("complete");
      expect(result.output?.type).toBe("table");
      expect(result.output?.rows?.length).toBeGreaterThan(0);
      if (expectedRows) expect(result.output?.rows).toEqual(expectedRows);
      await assertSavedRows(cellId);
    };
    const add = async (name: string) => {
      const result = z
        .object({ createdCellId: z.string(), project: projectDocumentSchema })
        .parse(
          await action("add-project-cell", {
            projectId: created.id,
            kind: "sql",
            name,
            source: query,
          }),
        );
      const added = result.project.cells.find(
        (item) => item.id === result.createdCellId,
      );
      if (!added || added.contents.kind !== "sql")
        throw new Error("Added SQL cell missing");
      expect(added.contents.dataConnectionId).toBe(selected.id);
      expect(added.contents.source).toBe(query);
      return added;
    };
    const actionCreated = await add("qa_action_created");
    await runAndRead(actionCreated.id);
    expect(
      (await read()).cells.find((item) => item.id === actionCreated.id)
        ?.contents,
    ).toMatchObject({
      kind: "sql",
      dataConnectionId: selected.id,
      source: query,
    });
    console.log(
      "DEFAULT CONNECTION manual, direct action and persisted null-source SQL runs verified",
    );
    const engine = await page.request.get(
      `${base}/_agent-native/agent-engine/status`,
      { headers },
    );
    if (!engine.ok()) throw new Error(`Agent engine HTTP ${engine.status()}`);
    if (
      !z.object({ chatEligible: z.boolean() }).parse(await engine.json())
        .chatEligible
    )
      return {
        status: "unavailable",
        reason: "Agent engine is unavailable for the default-connection query",
      };
    if (selectLiveModel) {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      const modelResult = await selectLiveFlowModel(page);
      if (modelResult.status === "unavailable") return modelResult;
    }
    await page.goto(
      `${base}/project/${encodeURIComponent(created.id)}/latest?notebookView=agent`,
      { waitUntil: "domcontentloaded" },
    );
    const composer = page.locator(
      '.ws-agent-notebook [data-agent-composer-slot="area"] [role="textbox"][contenteditable="true"]',
    );
    await expect(composer).toHaveCount(1);
    const prompt = `Create and run a SQL cell named qa_agent_default in project ${created.id} with query: ${query}`;
    await composer.fill(prompt);
    const [snapshot] = await Promise.all([
      page.waitForRequest(
        (request) => {
          const url = new URL(request.url());
          const baseUrl = new URL(base);
          const prefix = `${baseUrl.pathname.replace(/\/$/, "")}/_agent-native/agent-chat/threads/`;
          const id = url.pathname.startsWith(prefix)
            ? url.pathname.slice(prefix.length)
            : "";
          return (
            request.method() === "PUT" &&
            url.origin === baseUrl.origin &&
            id !== "" &&
            !id.includes("/")
          );
        },
        { timeout: 60000 },
      ),
      composer.press("Enter"),
    ]);
    const encodedId = new URL(snapshot.url()).pathname.split("/").at(-1);
    if (!encodedId) throw new Error("Agent thread ID missing");
    const agentThreadId = decodeURIComponent(encodedId);
    threadId = agentThreadId;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(agentThreadId)}`,
            { headers },
          );
          if (!response.ok())
            throw new Error(`Agent thread HTTP ${response.status()}`);
          const lifecycle = z
            .object({
              runLifecycles: z.object({
                runs: z.array(
                  z.object({
                    status: z.string(),
                    terminalReason: z.string().nullable(),
                    threadProjectionErrorCode: z.string().nullable(),
                  }),
                ),
              }),
            })
            .parse(await response.json()).runLifecycles;
          const run = lifecycle.runs.at(-1);
          if (run && ["errored", "cancelled", "aborted"].includes(run.status))
            throw new Error(`Agent run ended ${run.status}`);
          return (
            run?.status === "completed" &&
            run.terminalReason === "done" &&
            run.threadProjectionErrorCode === null
          );
        },
        { timeout: 180000, intervals: [2000, 5000] },
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "View pending changes", exact: true })
      .click();
    const confirmation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          actionPath(base, "decide-notebook-pending-changes") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm all", exact: true })
      .click();
    const confirmed = await confirmation;
    expect(confirmed.ok()).toBe(true);
    expect(await confirmed.json()).toMatchObject({
      decision: "confirm",
      checkpointId: expect.any(String),
    });
    const agentCell = (await read()).cells.find(
      (item) =>
        item.contents.kind === "sql" &&
        item.contents.resultVariable === "qa_agent_default",
    );
    if (!agentCell) throw new Error("Agent SQL cell missing");
    expect(agentCell.contents).toMatchObject({
      kind: "sql",
      source: query,
      dataConnectionId: selected.id,
    });
    await assertNativeRows(agentCell.id);
    await page.goto(
      `${base}/project/${encodeURIComponent(created.id)}/latest`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page
        .locator("[data-notebook-cell]")
        .filter({ hasText: "qa_agent_default" })
        .locator("table"),
    ).toBeVisible({ timeout: 60000 });
    await assertNativeRows(agentCell.id);
    return { status: "pass" };
  } catch (error) {
    primaryError = error;
    try {
      await page.screenshot({
        path: ".tmp/analytics-owner/default-before-cleanup.png",
        timeout: 3000,
      });
    } catch (captureError) {
      throw new AggregateError(
        [error, captureError],
        "Default query failed and evidence capture failed",
      );
    }
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (threadId)
      try {
        const response = await page.request.delete(
          `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(threadId)}`,
          { headers },
        );
        if (!response.ok())
          throw new Error(`Agent thread cleanup HTTP ${response.status()}`);
        const deleted = await page.request.get(
          `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(threadId)}`,
          { headers },
        );
        if (deleted.status() !== 404)
          throw new Error(
            `Agent thread cleanup readback HTTP ${deleted.status()}`,
          );
      } catch (error) {
        cleanupErrors.push(error);
      }
    try {
      await action("trash-project", { projectId: created.id });
      await action("delete-project", { projectId: created.id });
      const deleted = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
        { headers },
      );
      if (deleted.status() !== 404)
        throw new Error(`Default connection cleanup HTTP ${deleted.status()}`);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        primaryError === undefined
          ? cleanupErrors
          : [primaryError, ...cleanupErrors],
        "Default connection cleanup failed",
      );
  }
}
