import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import {
  callAction,
  assertQaIdentity,
  deleteProjectAndExpect404,
} from "./live-fixtures/shared.js";
import { publishProject } from "./publish-project.js";

export async function checkPublishedDateRange(page: Page, base: string) {
  await assertQaIdentity(page, base);
  const common = {
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
  };
  const created = (await callAction(page, base, "create-project", {
    requestId: randomUUID(),
    title: `QA custom date range ${randomUUID()}`,
    starter: {
      kind: "cells",
      cells: [
        {
          ...common,
          kind: "input",
          name: "period",
          label: "Period",
          inputType: "DROPDOWN",
          defaultValueString: "30d",
          options: ["30d", "custom"],
          optionLabels: { "30d": "Last 30 days", custom: "Custom range" },
          rangeInputs: { start: "begin", end: "finish" },
        },
        {
          ...common,
          kind: "input",
          name: "begin",
          inputType: "DATE",
          hidden: true,
          defaultValueString: "2026-10-01",
        },
        {
          ...common,
          kind: "input",
          name: "finish",
          inputType: "DATE",
          hidden: true,
          defaultValueString: "2026-10-31",
        },
        {
          ...common,
          kind: "sql",
          source:
            "SELECT '{{ begin }}' || ' through ' || '{{ finish }}' AS picked",
          dataConnectionId: "builtin-sample-data",
          databaseSchema: null,
          resultVariable: "selected_dates",
          outputResult: true,
        },
        {
          ...common,
          kind: "text",
          text: "Selected {{ begin }} through {{ finish }}",
        },
      ],
    },
  })) as { id: string };
  expect(created.id).toBeTruthy();
  try {
    const read = (await callAction(
      page,
      base,
      "get-project",
      { projectId: created.id },
      "GET",
    )) as { project: { cells: { id: string; contents: { kind: string } }[] } };
    const sql = read.project.cells.find(
      ({ contents }) => contents.kind === "sql",
    );
    if (!sql) throw new Error("Fixture query is missing");
    const ran = (await callAction(page, base, "run-project-cell", {
      projectId: created.id,
      cellId: sql.id,
    })) as { status: string };
    expect(ran.status).toBe("complete");
    await publishProject(page, base, created.id);
    await page.goto(`${base}/app/${created.id}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const preset = page.getByRole("combobox", { name: "Value for Period" });
    await expect(preset).toHaveText("Last 30 days", { timeout: 120000 });
    await expect(page.locator("tbody tr").first().locator("td")).toHaveText(
      ["2026-10-01 through 2026-10-31"],
      { timeout: 30000 },
    );
    const customSaved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/set-published-app-inputs") &&
        r.request().method() === "POST",
    );
    await preset.click();
    await page
      .getByRole("option", { name: "Custom range", exact: true })
      .click();
    expect((await customSaved).status()).toBe(200);
    const start = page.getByLabel("Start date", { exact: true });
    const end = page.getByLabel("End date", { exact: true });
    await expect(start).toHaveValue("2026-10-01");
    await expect(end).toHaveValue("2026-10-31");
    const updates: unknown[] = [];
    const observe = (request: import("@playwright/test").Request) => {
      if (request.url().endsWith("/set-published-app-inputs"))
        updates.push(request.postDataJSON());
    };
    page.on("request", observe);
    try {
      await start.fill("2026-11-02");
      await expect(
        page.getByRole("status").filter({ hasText: /start date/ }),
      ).toBeVisible();
      expect(updates).toHaveLength(0);
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/set-published-app-inputs") &&
          r.request().method() === "POST",
      );
      await end.fill("2026-11-08");
      expect((await saved).status()).toBe(200);
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        updates: [
          { value: { kind: "date", value: "2026-11-02" } },
          { value: { kind: "date", value: "2026-11-08" } },
        ],
      });
      await expect(
        page.getByText("Selected 2026-11-02 through 2026-11-08", {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      page.off("request", observe);
    }
    await expect(page.locator("tbody tr").first().locator("td")).toHaveText(
      ["2026-11-02 through 2026-11-08"],
      { timeout: 30000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(start).toHaveValue("2026-11-02", { timeout: 120000 });
    await expect(end).toHaveValue("2026-11-08");
    await expect(page.locator("tbody tr").first().locator("td")).toHaveText([
      "2026-11-02 through 2026-11-08",
    ]);
    await page
      .getByRole("button", { name: /^Reset .*input.*default view/ })
      .click();
    await expect(preset).toHaveText("Last 30 days");
    await expect(start).toHaveCount(0);
    await expect(
      page.getByText("Selected 2026-10-01 through 2026-10-31", { exact: true }),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(preset).toHaveText("Last 30 days", { timeout: 120000 });
    console.log(
      "CUSTOM_RANGE private bounds saved together; reload and reset verified",
    );
  } finally {
    await page.goto("about:blank");
    await deleteProjectAndExpect404(page, base, created.id);
  }
}
