import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { publishProject } from "./publish-project.js";

export async function checkPublishedStyles(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (name: string, data: Record<string, unknown>) => {
    const response = await page.request.post(
      `${base}/_agent-native/actions/${name}`,
      { headers, data },
    );
    if (!response.ok()) {
      console.log(`STYLE ACTION FAILED ${name} HTTP ${response.status()}`);
      throw new Error(`${name} HTTP ${response.status()}`);
    }
    return response.json();
  };
  const created = await action("create-project", {
    title: `QA published style ${randomUUID()}`,
  });
  const id: string = created.id;
  expect(id).toBeTruthy();
  try {
    const added = projectDocumentSchema.parse(
      (await action("add-project-cell", { projectId: id, kind: "sql" }))
        .project,
    );
    const sql = added.cells.find((cell) => cell.contents.kind === "sql");
    if (!sql || sql.contents.kind !== "sql")
      throw new Error("SQL cell missing");
    await action("save-project-cell", {
      projectId: id,
      cellId: sql.id,
      expectedUpdatedAt: sql.updatedAt,
      contents: {
        ...sql.contents,
        source: "SELECT channel, order_total FROM orders LIMIT 2",
        dataConnectionId: "builtin-sample-data",
        resultVariable: "qa_table",
      },
    });
    expect(
      (await action("run-project-cell", { projectId: id, cellId: sql.id }))
        .status,
    ).toBe("complete");
    const doc = projectDocumentSchema.parse(
      (await action("add-project-cell", { projectId: id, kind: "chart" }))
        .project,
    );
    const chart = doc.cells.find((cell) => cell.contents.kind === "chart");
    if (!chart || chart.contents.kind !== "chart")
      throw new Error("Chart cell missing");
    await action("save-project-cell", {
      projectId: id,
      cellId: chart.id,
      expectedUpdatedAt: chart.updatedAt,
      contents: {
        ...chart.contents,
        dataframe: JSON.stringify([
          { day: "0", value: 5 },
          { day: "1", value: 3 },
        ]),
        chartSpec: {
          mark: "line",
          xField: "day",
          yField: "value",
          seriesField: null,
          title: "QA published styles",
          seriesLabels: { "0": "Email", "1": "+1" },
        },
      },
    });
    // oracle-change: a project publishes with an empty App builder by design (AppLayoutSnapshot.tsx emptyLayout); initialize the layout from outputs first.
    const current = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    const live = (await current.json()).project;
    const head = live.draftHead;
    await action("set-app", {
      protocol: 1,
      projectId: id,
      workingVersionId: head.versionId,
      observedHead: head,
      opId: randomUUID(),
      changes: [
        {
          type: "set-app",
          expectedLayoutRevision: live.appLayout?.revision ?? "0",
          patches: [{ type: "initialize", includeExecutionOutputs: true }],
        },
      ],
    });
    await publishProject(page, base, id);
    for (const mode of ["direct", "reload"]) {
      if (mode === "direct")
        await page.goto(`${base}/app/${encodeURIComponent(id)}/latest`, {
          waitUntil: "domcontentloaded",
        });
      else await page.reload({ waitUntil: "domcontentloaded" });
      const line = page.locator(".mark-line path").first();
      await expect(line).toBeVisible({ timeout: 30000 });
      // oracle-change: charts draw through Vega (VegaChart.tsx), so Vega mark classes replace nb-chart-*; combine both exact category assertions without assuming a Y tick count.
      await expect(
        page
          .locator(".role-axis-label text")
          .filter({ hasText: /^(?:Email|\+1)$/ }),
      ).toHaveText(["Email", "+1"]);
      const style = await line.evaluate((el) => ({
        fill: getComputedStyle(el).fill,
        stroke: getComputedStyle(el).stroke,
        strokeWidth: getComputedStyle(el).strokeWidth,
      }));
      console.log(`STYLE ${mode} ${JSON.stringify(style)}`);
      await page.screenshot({
        path: `.tmp/analytics-owner/turn-1000-style-${mode}.png`,
      });
      expect(style.fill).toBe("none");
      expect(style.stroke).not.toBe("none");
      expect(style.strokeWidth).toBe("2px");
      const table = page.locator(".nb-table").first();
      await expect(table).toBeVisible();
      const tableStyle = await table.evaluate((el) => ({
        fontSize: getComputedStyle(el).fontSize,
        lineHeight: getComputedStyle(el).lineHeight,
      }));
      console.log(`TABLE ${mode} ${JSON.stringify(tableStyle)}`);
      expect(tableStyle).toEqual({ fontSize: "12px", lineHeight: "16px" });
    }
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await action("trash-project", { projectId: id });
    await action("delete-project", { projectId: id });
    const absent = await page.request.get(
      `${base}/_agent-native/actions/get-project`,
      { headers, params: { projectId: id } },
    );
    expect(absent.status()).toBe(404);
    console.log("STYLE QA owned project deleted; readback 404");
  }
}
