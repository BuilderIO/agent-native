import { randomUUID } from "node:crypto";

import { observeBuild, stableBuild } from "../../build-boundary.js";
import { readAttempt } from "../../phase1/execution-readback.js";
import { safeRequest } from "../../safe-request.js";
import { expect, test } from "./fixtures";

test("report SAYA-1117-INPUT-DOCS: dynamic multiselect binds a verified result", async ({
  page,
  context,
  base,
}) => {
  test.setTimeout(300_000);
  const before = await observeBuild(context.request, base);
  expect(before.kind).toBe("read");
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const call = async (
    name: string,
    data: Record<string, unknown>,
    method = "POST",
  ) => {
    const response = await safeRequest(
      `${method} /_agent-native/actions/${name}`,
      () =>
        context.request.fetch(`${base}/_agent-native/actions/${name}`, {
          method,
          headers,
          ...(method === "GET"
            ? { params: data as Record<string, string> }
            : { data }),
        }),
    );
    expect(response.status(), name).toBe(200);
    return response.json();
  };
  const created = await call("create-project", {
    title: `QA dynamic input ${randomUUID()}`,
  });
  const projectId: string = created.id;
  console.log("INPUT_BINDING_FIXTURE", projectId);
  const read = () => call("get-project", { projectId }, "GET");
  const runCell = async (cellId: string) => {
    const state = await call("get-notebook-execution", { projectId }, "GET");
    expect(state.status).toBe("found");
    const run = await call("start-notebook-run", {
      snapshot: state.snapshot,
      requestId: randomUUID(),
      mode: "upstream",
      targetCellId: cellId,
      staleValues: "reject",
      cache: "reuse",
    });
    expect(run.status).toBe("admitted");
    await expect
      .poll(
        async () => {
          const receipt = await call(
            "get-notebook-run",
            { runId: run.runId },
            "GET",
          );
          expect(receipt.status).toBe("found");
          const attempt = readAttempt(receipt, run.runId, cellId);
          if (
            ["failed", "blocked", "cancelled"].includes(attempt?.state.status)
          )
            throw new Error(`Notebook run ended ${attempt.state.status}`);
          return attempt?.state.status;
        },
        { timeout: 120_000, intervals: [1000, 2000] },
      )
      .toBe("complete");
    const latest = await call("get-notebook-execution", { projectId }, "GET");
    const resultId: string = latest.cells[cellId].resultId;
    expect(resultId).toBeTruthy();
    const result = await call("get-notebook-result-page", { resultId }, "GET");
    expect(result.status).toBe("ready");
    expect(result.manifest.status).toBe("complete");
    return { resultId, result };
  };
  try {
    await call("add-project-cell", {
      projectId,
      kind: "sql",
      name: "choices",
      source: "SELECT 'alpha' AS choice",
      dataConnectionId: "builtin-sample-data",
    });
    const producer = (await read()).project.cells[0];
    await page.goto(`${base}/project/${encodeURIComponent(projectId)}/latest`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(1, {
      timeout: 30_000,
    });
    const source = await runCell(producer.id);
    expect(source.result.rows).toEqual([["alpha"]]);
    await call("add-project-cell", {
      projectId,
      kind: "input",
      name: "selected_choices",
      inputType: "MULTISELECT",
    });
    const input = (await read()).project.cells[1];
    const contents = {
      ...input.contents,
      dynamicOptions: {
        producerCellId: producer.id,
        valueFieldId: source.result.manifest.fields[0].fieldId,
      },
    };
    await call("save-project-cell", {
      projectId,
      cellId: input.id,
      expectedUpdatedAt: input.updatedAt,
      contents,
    });
    const choices = await call(
      "get-notebook-input-choices",
      {
        projectId,
        cellId: input.id,
      },
      "GET",
    );
    expect(choices).toEqual({
      status: "ready",
      resultId: source.resultId,
      values: [{ value: "alpha", label: "alpha" }],
    });
    const configured = (await read()).project.cells[1];
    await call("save-project-cell", {
      projectId,
      cellId: input.id,
      expectedUpdatedAt: configured.updatedAt,
      inputOptionsResultId: choices.resultId,
      contents: { ...contents, defaultValueString: '["alpha"]' },
    });
    await call("add-project-cell", {
      projectId,
      kind: "sql",
      name: "filtered",
      source:
        "SELECT 'alpha' AS picked WHERE 'alpha' IN ({{ selected_choices | array }})",
      dataConnectionId: "builtin-sample-data",
    });
    const consumer = (await read()).project.cells[2];
    const filtered = await runCell(consumer.id);
    expect(filtered.result.rows).toEqual([["alpha"]]);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(3);
    const reopened = await read();
    expect(reopened.project.cells[1].contents).toMatchObject({
      dynamicOptions: contents.dynamicOptions,
      defaultValueString: '["alpha"]',
    });
    const reopenedResult = await call(
      "get-notebook-result-page",
      {
        resultId: filtered.resultId,
      },
      "GET",
    );
    expect(reopenedResult.rows).toEqual([["alpha"]]);
    console.log(
      "INPUT_BINDING_PASS complete choices, saved selection, parameterized result, fresh readback",
    );
  } finally {
    await page.close();
    await call("trash-project", { projectId });
    await call("delete-project", { projectId });
    const absent = await context.request.get(
      `${base}/_agent-native/actions/get-project`,
      {
        headers,
        params: { projectId },
      },
    );
    expect(absent.status()).toBe(404);
    const after = await observeBuild(context.request, base);
    expect(
      stableBuild(before, after),
      "The served build must remain stable",
    ).toBe(true);
    console.log(
      "INPUT_BINDING_CLEANUP 404; stable served build",
      JSON.stringify(after),
    );
  }
});

test("report M5-1117-LIVE-DAILY-HARNESS: Notebook edits persist across reload", async ({
  page,
  context,
  base,
}) => {
  const title = `QA daily notebook ${randomUUID()}`;
  const action = async (
    name: "create-project" | "get-project" | "trash-project" | "delete-project",
    body: Record<string, string>,
    method: "GET" | "POST" = "POST",
  ) => {
    const url = `${base}/_agent-native/actions/${name}`;
    const labels = {
      "create-project": "POST /_agent-native/actions/create-project",
      "get-project": "GET /_agent-native/actions/get-project",
      "trash-project": "POST /_agent-native/actions/trash-project",
      "delete-project": "POST /_agent-native/actions/delete-project",
    } as const;
    const response = await safeRequest(labels[name], () =>
      method === "GET"
        ? context.request.get(url, { params: body })
        : context.request.post(url, { data: body }),
    );
    if (!response.ok()) throw new Error(`${name} HTTP ${response.status()}`);
    return await response.json();
  };
  const created = await action("create-project", { title });
  if (typeof created.id !== "string" || !created.id)
    throw new Error(
      "Create project returned no id; inspect QA workspace before retrying",
    );
  const projectId: string = created.id;
  try {
    await page.goto(`${base}/project/${encodeURIComponent(projectId)}/latest`);
    await page.getByRole("button", { name: "Query", exact: true }).click();
    const cell = page.locator("[data-notebook-cell]");
    await expect(cell).toHaveCount(1);
    const editor = cell.locator(
      ".nb-sql-editor .cm-content, textarea.nb-cell-source",
    );
    await editor.fill("select 1 as daily_check");
    await expect
      .poll(
        async () => {
          const result = await action("get-project", { projectId }, "GET");
          return result.project?.cells?.map(
            (item: { contents: { source?: string } }) => item.contents.source,
          );
        },
        { timeout: 15_000 },
      )
      .toEqual(["select 1 as daily_check"]);
    await page.reload();
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(1);
    const restoredEditor = page
      .locator("[data-notebook-cell]")
      .locator(".nb-sql-editor .cm-content, textarea.nb-cell-source");
    await expect
      .poll(() =>
        restoredEditor.evaluate((element) =>
          element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent,
        ),
      )
      .toBe("select 1 as daily_check");
  } finally {
    await page.close();
    await action("trash-project", { projectId });
    await action("delete-project", { projectId });
    const readback = await safeRequest(
      "GET /_agent-native/actions/get-project",
      () =>
        context.request.get(`${base}/_agent-native/actions/get-project`, {
          params: { projectId },
        }),
    );
    if (readback.status() !== 404)
      throw new Error(
        `Deleted QA project ${projectId} readback HTTP ${readback.status()}`,
      );
  }
});
