import { mkdir } from "node:fs/promises";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { z } from "zod";

import { projectDocumentSchema } from "../../app/lib/model/contracts";
import { open, seed } from "./dash.helpers";
import { expect, test } from "./fixtures";
import { cellLocator } from "./notebook.helpers";

test("report A2-COMPONENT-SNAPSHOT-OUTPUTS: captured results survive import and reload", async ({
  daily,
}) => {
  const source = await seed(daily, [
    { kind: "sql" },
    { kind: "sql" },
    { kind: "sql" },
    { kind: "sql" },
  ]);
  const created = await daily.action<{ component: { id: string } }>(
    "manage-component",
    {
      operation: "create",
      projectId: source.id,
      name: `Proof ${source.id}`,
      cellIds: source.cellIds,
    },
  );
  const id = created.component.id;
  expect(id).toMatch(/^[\da-f-]+$/);
  // Seed controlled output in the isolated local database: SQL runs naturally yield tables,
  // while the app currently cannot produce all of the supported output variants itself.
  const outputs = [
    { type: "text", text: "Persisted component text" },
    { type: "metric", value: 42, formatted: "42 units" },
    { type: "error", message: "Seeded query error", detail: null },
    {
      type: "table",
      columns: [{ name: "amount", type: "number" }],
      rows: Array.from({ length: 51 }, (_, n) => [n]),
      rowCount: 100,
      truncated: true,
    },
  ];
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  if (
    dbUrl.protocol !== "postgresql:" ||
    dbUrl.hostname !== "127.0.0.1" ||
    !dbUrl.port ||
    dbUrl.username !== "qa_analytics2" ||
    dbUrl.password ||
    dbUrl.pathname !== "/qa_analytics2" ||
    dbUrl.search ||
    dbUrl.hash
  )
    throw new Error("An isolated local QA database is required");
  try {
    const stored = await getDbExec().execute({
      sql: `SELECT cells_json AS "cellsJson" FROM analytics2_components WHERE id = ?`,
      args: [id],
    });
    const row = z.object({ cellsJson: z.string() }).parse(stored.rows[0]);
    const cells = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(row.cellsJson));
    expect(cells).toHaveLength(outputs.length);
    const snapshot = cells.map((cell, index) => ({
      ...cell,
      output: outputs[index],
      sourceConnectionIds: [],
    }));
    const result = await getDbExec().execute({
      sql: `UPDATE analytics2_components SET cells_json = ? WHERE id = ? RETURNING id`,
      args: [JSON.stringify(snapshot), id],
    });
    expect(result.rows.map((updated) => updated.id)).toEqual([id]);
  } finally {
    await closeDbExec();
  }
  const target = await seed(daily, [{ kind: "component-import" }]);
  const project = await daily.action<{
    project: {
      cells: Array<{ id: string; contents: Record<string, unknown> }>;
    };
  }>("get-project", { projectId: target.id }, "GET");
  const imported = project.project.cells.find(
    (cell) => cell.id === target.cellIds[0],
  );
  if (!imported) throw new Error("Import cell was not created");
  await daily.action("save-project-cell", {
    projectId: target.id,
    cellId: imported.id,
    contents: {
      ...imported.contents,
      componentVersionId: id,
      title: "Proof component",
    },
  });
  await open(daily, target);
  const check = async () => {
    const region = daily.page.locator(".nb-component-import");
    await expect(region).toContainText("Persisted component text");
    await expect(region).toContainText("42 units");
    await expect(region).toContainText("Seeded query error");
    await expect(region).toContainText("100 rows");
    await expect(region).not.toContainText("This cell captured no result.");
  };
  await check();
  await daily.reload();
  await expect(cellLocator(daily.page)).toHaveCount(1, { timeout: 60_000 });
  await check();
  await mkdir(".tmp/analytics-owner", { recursive: true });
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/component-snapshot-proof.png",
    fullPage: true,
  });
});

test("report A2-BQ-V3-TABLE-PAGER: published tables page 34 rows and reset after reload", async ({
  daily,
}) => {
  const project = await daily.createProject();
  const add = async (kind: "sql" | "display-table") => {
    const result = await daily.action<{
      project: unknown;
      createdCellId: string;
    }>("add-project-cell", { projectId: project.id, kind });
    const cell = projectDocumentSchema
      .parse(result.project)
      .cells.find((entry) => entry.id === result.createdCellId);
    if (!cell) throw new Error(`Missing ${kind} cell`);
    return cell;
  };
  const sql = await add("sql");
  if (sql.contents.kind !== "sql") throw new Error("Missing SQL contents");
  const values = Array.from(
    { length: 34 },
    (_, index) => `(${index + 1})`,
  ).join(",");
  await daily.action("save-project-cell", {
    projectId: project.id,
    cellId: sql.id,
    expectedUpdatedAt: sql.updatedAt,
    contents: {
      ...sql.contents,
      hidden: true,
      source: `SELECT n FROM (VALUES ${values}) AS v(n) CROSS JOIN (SELECT 1 FROM orders LIMIT 1) sample`,
      dataConnectionId: "builtin-sample-data",
      resultVariable: "pager_data",
    },
  });
  const run = await daily.action<{ status: string }>("run-project-cell", {
    projectId: project.id,
    cellId: sql.id,
  });
  expect(run.status).toBe("complete");
  const ids: string[] = [];
  for (const configured of [false, true]) {
    const cell = await add("display-table");
    if (cell.contents.kind !== "display-table")
      throw new Error("Missing display table contents");
    ids.push(cell.id);
    await daily.action("save-project-cell", {
      projectId: project.id,
      cellId: cell.id,
      expectedUpdatedAt: cell.updatedAt,
      contents: {
        ...cell.contents,
        dataframe: "pager_data",
        columns: configured
          ? [{ name: "n", header: null, hidden: false, format: null }]
          : [],
      },
    });
  }
  await daily.action("publish-project", { projectId: project.id });
  await daily.open(`/app/${project.id}/latest`);
  for (const id of ids) {
    const table = daily.page.locator(`[data-published-cell="${id}"]`);
    await expect(table.locator("tbody tr")).toHaveCount(25, {
      timeout: 60_000,
    });
    await expect(table.locator("tbody tr").last()).toContainText("25");
    await table.getByRole("button", { name: "Next page" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(9);
    await expect(table.locator("tbody tr").first()).toContainText("26");
    await expect(table.locator("tbody tr").last()).toContainText("34");
  }
  await daily.reload();
  for (const id of ids) {
    const table = daily.page.locator(`[data-published-cell="${id}"]`);
    await expect(table).toBeVisible({ timeout: 60_000 });
    await expect(table.locator("tbody tr")).toHaveCount(25);
  }
  await mkdir(".tmp/analytics-owner", { recursive: true });
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/published-pager-proof.png",
    fullPage: true,
  });
});
