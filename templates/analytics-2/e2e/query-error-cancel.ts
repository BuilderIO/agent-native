import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { fakeServiceAccountKey } from "./local/fake-providers.js";
import { writeSqlEditor } from "./sql-editor.js";

export async function checkQueryErrorCancel(
  page: Page,
  base: string,
  fixtureUrl: string,
) {
  const url = new URL(fixtureUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid local fake provider URL");
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (
    name: string,
    data: Record<string, unknown>,
    method = "POST",
  ) => {
    const response = await page.request.fetch(
      `${base}/_agent-native/actions/${name}${method === "GET" ? `?${new URLSearchParams(z.record(z.string(), z.string()).parse(data))}` : ""}`,
      { method, headers, ...(method === "POST" ? { data } : {}) },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const name = `QA query cancellation ${randomUUID()}`;
  let connectionId: string | undefined;
  let projectId: string | undefined;
  let stage = "connection";
  let primaryError: unknown;
  try {
    await page.goto(`${base}/data`, { waitUntil: "domcontentloaded" });
    await page.getByText("Warehouse", { exact: true }).click();
    await page
      .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
      .click();
    await page.getByText("Google BigQuery", { exact: true }).click();
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="projectId"]').fill("local-fake-project");
    await page.locator('input[name="datasetNames"]').fill("agent_native_qa");
    const storage = page.locator('input[name="useBQStorageAPI"]');
    if (await storage.isChecked()) await storage.click();
    await page
      .locator('input[name="serviceAccount"]')
      .fill(JSON.stringify(fakeServiceAccountKey()));
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname.endsWith(
            "/actions/create-workspace-warehouse-form",
          ),
      ),
      page
        .getByRole("button", { name: "Create connection", exact: true })
        .click(),
    ]);
    expect(created.ok()).toBe(true);
    const findConnection = async () => {
      const matches = z
        .object({
          connections: z.array(
            z.object({
              id: z.string().min(1),
              name: z.string(),
              type: z.string(),
              isDraft: z.boolean(),
            }),
          ),
        })
        .parse(await action("list-data-connections", {}, "GET"))
        .connections.filter((item) => item.name === name);
      if (matches.length > 1) throw new Error("Duplicate fixture connections");
      if (matches[0] && (matches[0].type !== "bigquery" || matches[0].isDraft))
        throw new Error("Fixture connection has an unexpected type or state");
      return matches[0]?.id ?? null;
    };
    await expect.poll(findConnection, { timeout: 30000 }).not.toBeNull();
    connectionId = (await findConnection()) ?? undefined;
    if (!connectionId) throw new Error("Created connection disappeared");
    stage = "project";
    projectId = z.object({ id: z.string() }).parse(
      await action("create-project", {
        title: `QA query recovery ${randomUUID()}`,
      }),
    ).id;
    const added = z
      .object({
        createdCellId: z.string(),
        project: z.object({
          cells: z.array(
            z.object({
              id: z.string(),
              contents: z.object({ kind: z.string() }).passthrough(),
            }),
          ),
        }),
      })
      .parse(await action("add-project-cell", { projectId, kind: "sql" }));
    const cell = added.project.cells.find(
      (item) => item.id === added.createdCellId,
    );
    if (!cell || cell.contents.kind !== "sql")
      throw new Error("SQL fixture missing");
    const cellId = cell.id;
    const invalid = "SELECT * FROM `agent_native_qa.missing_table`";
    await action("save-project-cell", {
      projectId,
      cellId,
      contents: {
        ...cell.contents,
        source: invalid,
        dataConnectionId: connectionId,
      },
    });
    stage = "invalid-query";
    const failed = await page.request.post(
      `${base}/_agent-native/actions/run-project-cell`,
      { headers, data: { projectId, cellId, requestId: randomUUID() } },
    );
    const failedBody = await failed.json();
    const persisted = await action("get-project", { projectId }, "GET");
    const journal = z
      .array(
        z.object({ host: z.string(), method: z.string(), path: z.string() }),
      )
      .parse(await (await fetch(new URL("/__control/calls", url))).json());
    console.log(
      "QUERY ERROR CANCEL diagnostic",
      JSON.stringify({
        status: failed.status(),
        body: failedBody,
        cell: persisted.project.cells.find(
          (item: { id: string }) => item.id === cellId,
        ),
        connectionId,
        calls: journal,
      }),
    );
    expect(failed.status()).toBe(422);
    expect(failedBody).toMatchObject({
      errorCode: "warehouse_query_failed",
    });
    expect(
      persisted.project.cells.find((item: { id: string }) => item.id === cellId)
        ?.contents,
    ).toMatchObject({ source: invalid, dataConnectionId: connectionId });
    expect(
      journal.some(
        (call) =>
          call.host === "bigquery.googleapis.com" &&
          call.method === "POST" &&
          call.path === "/bigquery/v2/projects/local-fake-project/queries",
      ),
    ).toBe(true);
    stage = "error-readback";
    const read = async () =>
      z
        .object({
          project: z.object({
            cells: z.array(
              z.object({
                id: z.string(),
                contents: z
                  .object({ source: z.string().optional() })
                  .passthrough(),
              }),
            ),
          }),
          outputs: z.record(z.string(), z.unknown()),
          queryStates: z.record(z.string(), z.unknown()),
        })
        .parse(await action("get-project", { projectId }, "GET"));
    expect((await read()).outputs[cellId]).toMatchObject({
      status: "error",
      output: { type: "error" },
    });
    await page.goto(`${base}/project/${encodeURIComponent(projectId)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const slot = page.locator(`[data-notebook-cell="${cellId}"]`);
    const editor = slot.getByRole("textbox", { name: /^Edit / });
    await expect(
      slot.getByText("Your query could not be executed"),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      slot.getByText("Your query could not be executed"),
    ).toBeVisible();
    stage = "recovery";
    await writeSqlEditor(editor, "SELECT 1 AS result");
    await editor.press("ControlOrMeta+Enter");
    await expect(
      slot.getByRole("columnheader", { name: "result" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(slot.getByText("1", { exact: true }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const execution = z
          .object({
            cells: z
              .record(
                z.string(),
                z.object({ resultId: z.string().nullable() }).passthrough(),
              )
              .optional(),
          })
          .parse(await action("get-notebook-execution", { projectId }, "GET"));
        const resultId = execution.cells?.[cellId]?.resultId;
        if (!resultId) return null;
        return z
          .object({
            status: z.string(),
            manifest: z
              .object({
                fields: z.array(
                  z.object({ name: z.string(), type: z.string() }),
                ),
                rowCount: z.string(),
              })
              .optional(),
            rows: z.array(z.array(z.unknown())).optional(),
          })
          .parse(await action("get-notebook-result-page", { resultId }, "GET"));
      })
      .toMatchObject({
        status: "ready",
        manifest: {
          fields: [{ name: "result" }],
          rowCount: "1",
        },
      });
    expect(
      (await read()).project.cells.find((item) => item.id === cellId)?.contents
        .source,
    ).toBe("SELECT 1 AS result");
    stage = "cancellation";
    const callsBefore = z
      .array(z.unknown())
      .parse(
        await (await fetch(new URL("/__control/calls", url))).json(),
      ).length;
    await writeSqlEditor(editor, "SELECT 1 AS result /* QA_PENDING_JOB */");
    await editor.press("ControlOrMeta+Enter");
    const stop = slot.getByRole("button", { name: /^Stop / });
    await expect(stop).toBeEnabled({ timeout: 30000 });
    await stop.click();
    await expect(
      slot.getByText("Your query was interrupted", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => {
        const execution = z
          .object({
            cells: z
              .record(
                z.string(),
                z.object({
                  attempt: z
                    .object({
                      state: z.object({ status: z.string() }),
                    })
                    .nullable(),
                }),
              )
              .optional(),
          })
          .parse(await action("get-notebook-execution", { projectId }, "GET"));
        return execution.cells?.[cellId]?.attempt?.state.status;
      })
      .toBe("cancelled");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      slot.getByText("Your query was interrupted", { exact: true }),
    ).toBeVisible();
    const calls = z
      .array(
        z.object({ host: z.string(), method: z.string(), path: z.string() }),
      )
      .parse(await (await fetch(new URL("/__control/calls", url))).json())
      .slice(callsBefore);
    const cancel = calls.find(
      (call) =>
        call.host === "bigquery.googleapis.com" &&
        call.method === "POST" &&
        /\/jobs\/[^/]+\/cancel/.test(call.path),
    );
    if (!cancel) throw new Error("Provider cancellation request missing");
    const jobPath = cancel.path.split("?")[0]?.replace(/\/cancel$/, "");
    expect(
      calls.some(
        (call) => call.method === "GET" && call.path.split("?")[0] === jobPath,
      ),
    ).toBe(true);
  } catch (error) {
    primaryError = error;
    console.log(`QUERY ERROR CANCEL failed stage=${stage}`, error);
  } finally {
    const failures: unknown[] =
      primaryError === undefined ? [] : [primaryError];
    const cleanup = async (operation: () => Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        console.log("QUERY ERROR CANCEL cleanup failed", error);
        failures.push(error);
      }
    };
    await cleanup(() =>
      page
        .goto(`${base}/home`, { waitUntil: "domcontentloaded" })
        .then(() => {}),
    );
    await cleanup(async () => {
      if (projectId) {
        await action("trash-project", { projectId });
        await action("delete-project", { projectId });
        const readback = await page.request.get(
          `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId })}`,
          { headers },
        );
        expect(readback.status()).toBe(404);
      }
    });
    await cleanup(async () => {
      const connections = z
        .object({
          connections: z.array(z.object({ id: z.string(), name: z.string() })),
        })
        .parse(await action("list-data-connections", {}, "GET")).connections;
      const owned = connections.filter((item) => item.name === name);
      if (owned.length > 1) throw new Error("Duplicate fixture connections");
      if (connectionId && owned.some((item) => item.id !== connectionId))
        throw new Error("Fixture connection identity changed");
      connectionId ??= owned[0]?.id;
      if (connectionId) {
        await page.goto(`${base}/settings/data-sources`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("button", { name: `${name} options`, exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Delete", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await expect
          .poll(async () =>
            z
              .object({ connections: z.array(z.object({ id: z.string() })) })
              .parse(await action("list-data-connections", {}, "GET"))
              .connections.some((item) => item.id === connectionId),
          )
          .toBe(false);
      }
    });
    if (failures.length)
      throw new AggregateError(
        failures,
        "Query error and cancellation flow failed",
      );
  }
}
