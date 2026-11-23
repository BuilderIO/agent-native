import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { checkResultMenuHandoff } from "../app/components/notebook/CellOutputView.handoff.e2e.js";
import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import { addCellKind } from "./add-cell-kind.js";
import { writeSqlEditor } from "./sql-editor.js";
import { fetchUiAction } from "./ui-capability.js";

/** Exercises a newly opened, empty project against a real query supplied by the caller. */
export async function checkSayaSqlCell(
  page: Page,
  base: string,
  query: string,
  expectedColumn: string,
  prepareCell?: () => Promise<void>,
) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const preferencesSchema = z.object({
    lineNumbers: z.boolean(),
    fullWidthCells: z.boolean(),
  });
  const readPreferences = async () => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/get-editor-preferences`,
      { headers },
    );
    if (!response.ok())
      throw new Error(`get-editor-preferences: HTTP ${response.status()}`);
    return preferencesSchema.parse(await response.json());
  };
  const writePreferences = async (
    preferences: z.infer<typeof preferencesSchema>,
  ) => {
    const response = await page.request.post(
      `${base}/_agent-native/actions/set-editor-preferences`,
      { headers, data: preferences },
    );
    if (!response.ok())
      throw new Error(`set-editor-preferences: HTTP ${response.status()}`);
    expect(await readPreferences()).toEqual(preferences);
  };
  const initialPreferences = await readPreferences();
  let stage = "preferences";
  try {
    await writePreferences({ ...initialPreferences, lineNumbers: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    stage = "python-omitted";
    await expect(
      page.getByRole("button", { name: "Python", exact: true }),
    ).toBeVisible(); // oracle-change: Python cells are now available from the notebook toolbar
    stage = "add-sql";
    await page.getByRole("button", { name: "Query", exact: true }).click();
    const cell = page.locator("[data-notebook-cell]").last();
    const editor = cell.getByRole("textbox", { name: /^Edit / });
    await expect(editor).toBeVisible();
    stage = "edit-sql";
    await writeSqlEditor(editor, query);
    const editorText = () =>
      cell
        .locator(".cm-line")
        .allTextContents()
        .then((lines) => lines.join("\n"));
    await expect.poll(editorText).toBe(query);
    stage = "editor-affordances";
    await expect(editor).toHaveCSS("font-family", /mono/i);
    await expect(cell.locator(".cm-lineNumbers")).toBeVisible();
    await expect(cell.locator(".cm-foldGutter")).toBeVisible();
    await expect(cell.locator(".cm-line span").first()).toBeVisible();
    if (prepareCell) {
      stage = "prepare-sample-source";
      await prepareCell();
      await page.reload();
      await expect(editor).toBeVisible();
    }
    stage = "run-sql";
    await cell.hover();
    await expect(
      cell.getByRole("button", { name: /^Data connection:/ }),
    ).toBeVisible();
    await cell.getByRole("button", { name: /^Run SQL\b/ }).click();
    stage = "result-preview";
    const output = cell.locator(".nb-output-section");
    await expect(
      output.getByRole("columnheader", { name: expectedColumn }),
    ).toBeVisible({ timeout: 30000 });
    await expect(output).toContainText("50 rows", { timeout: 30000 }); // oracle-change: client sort and filter need a complete result, so the fixture fits one 50-row page
    const scroll = output.locator(".nb-table-scroll");
    await expect(scroll).toBeVisible();
    await expect(output.getByRole("row").nth(1)).toBeVisible();
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await output
      .getByRole("button", { name: `Column actions for ${expectedColumn}` })
      .click();
    const menu = page.getByRole("menu").filter({ visible: true });
    await expect(menu).toHaveCount(1);
    await menu
      .getByRole("menuitem", { name: "Sort 9 → 1", exact: true })
      .click();
    await expect(
      output.getByRole("columnheader", { name: expectedColumn }),
    ).toHaveAttribute("aria-sort", "descending");
    const columnValues = () =>
      output.locator("table").evaluate((table, columnName) => {
        const headers = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("thead th"),
        );
        const index = headers.findIndex((header) =>
          header.innerText.includes(columnName),
        );
        if (index < 0) throw new Error("Expected result column missing");
        return Array.from(table.querySelectorAll("tbody tr"), (row) =>
          Number(row.children[index]?.textContent?.replaceAll(",", "")),
        );
      }, expectedColumn);
    const sortedValues = await columnValues();
    expect(sortedValues.length).toBeGreaterThan(1);
    expect(sortedValues.every((value) => Number.isFinite(value))).toBe(true);
    expect(
      sortedValues.every(
        (value, index) =>
          index === 0 || (sortedValues[index - 1] ?? value) >= value,
      ),
    ).toBe(true);
    stage = "filter-result";
    await output
      .getByRole("button", { name: `Column actions for ${expectedColumn}` })
      .click();
    await expect(menu).toHaveCount(1);
    await menu
      .getByRole("menuitem", { name: "Filter...", exact: true })
      .click();
    const maximum = sortedValues.at(0);
    if (maximum === undefined)
      throw new Error("Filter fixture has no numeric values");
    const threshold = sortedValues.find((value) => value < maximum);
    if (threshold === undefined)
      throw new Error("Filter fixture has no distinct values");
    const matching = sortedValues.filter((value) => value > threshold);
    await output
      .getByLabel(`Filter ${expectedColumn}`, { exact: true })
      .fill(String(threshold));
    await expect(output.locator("tbody tr")).toHaveCount(matching.length);
    await expect.poll(columnValues).toEqual(matching);
    await output
      .getByLabel(`Filter ${expectedColumn}`, { exact: true })
      .fill(String(maximum));
    await expect(output.locator("tbody tr")).toHaveCount(0);
    await expect(output).toContainText("0 shown of 50 rows (unfiltered)");
    await output
      .getByRole("button", { name: `Remove filter ${expectedColumn} 1` })
      .click();
    await expect(output.locator("tbody tr").first()).toBeVisible();
    await expect(cell.locator("time[datetime]")).toBeVisible();
    stage = "reload";
    await page.reload();
    const restored = page.locator("[data-notebook-cell]").last();
    await expect
      .poll(() =>
        restored
          .locator(".cm-line")
          .allTextContents()
          .then((lines) => lines.join("\n")),
      )
      .toBe(query);
    await expect(
      restored.getByRole("columnheader", { name: expectedColumn }),
    ).toBeVisible();
  } catch (error) {
    console.error(`SAYA SQL FAILURE stage=${stage}`);
    await page.screenshot({
      path: ".tmp/analytics-owner/saya-sql-failure.png",
    });
    throw error;
  } finally {
    await writePreferences(initialPreferences);
  }
}

/** Exercises the built-in sample source without an external provider. */
export async function checkSayaSqlBasic(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const post = async (name: string, data: unknown) => {
    const response = await fetchUiAction(
      page.request,
      base,
      `${base}/_agent-native/actions/${name}`,
      { method: "POST", data },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const { id } = z
    .object({ id: z.string() })
    .parse(await post("create-project", { title: `Saya SQL ${randomUUID()}` }));
  const query = "SELECT *\nFROM orders\nLIMIT 50";
  const read = async () => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    if (!response.ok())
      throw new Error(`get-project: HTTP ${response.status()}`);
    return z
      .object({ project: projectDocumentSchema })
      .parse(await response.json()).project;
  };
  try {
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    await checkSayaSqlCell(page, base, query, "order_total", async () => {
      await expect
        .poll(async () => {
          const cell = (await read()).cells.at(0);
          return (
            cell?.contents.kind === "sql" && cell.contents.source === query
          );
        })
        .toBe(true);
      const picker = page
        .locator("[data-notebook-cell]")
        .first()
        .getByRole("button", { name: /^Data connection:/ });
      await picker.click();
      await page
        .getByRole("menu", { name: "Data connections" })
        .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
        .click();
      await expect(picker).toHaveAccessibleName(
        "Data connection: [Demo] Public Data",
      );
      await expect
        .poll(async () => {
          const cell = (await read()).cells.at(0);
          return cell?.contents.kind === "sql"
            ? cell.contents.dataConnectionId
            : undefined;
        })
        .toBe(SAMPLE_DATA_SOURCE_ID);
    });
    await addCellKind(page, "Chart");
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(2);
    const chart = page.locator("[data-notebook-cell]").last();
    const chartId = await chart.getAttribute("data-notebook-cell");
    if (!chartId) throw new Error("Chart cell id missing");
    const chartState = async () =>
      (await read()).cells.find((cell) => cell.id === chartId)?.contents;
    await chart
      .getByRole("combobox", { name: "DataFrame", exact: true })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "dataframe", exact: true })
      .click();
    await chart.getByRole("combobox", { name: "X-axis", exact: true }).click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "channel", exact: true })
      .click();
    await chart.getByRole("combobox", { name: "Y-axis", exact: true }).click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "order_total", exact: true })
      .click();
    await expect(
      chart.locator(".nb-vega-chart[data-chart-mark-type='bar']").first(),
    ).toBeVisible();
    await expect.poll(chartState).toMatchObject({
      kind: "chart",
      dataframe: "dataframe",
      chartSpec: { xField: expect.any(String), yField: expect.any(String) },
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator(
          `[data-notebook-cell="${chartId}"] .nb-vega-chart[data-chart-mark-type='bar']`,
        )
        .first(),
    ).toBeVisible();
    await page.screenshot({ path: ".tmp/analytics-owner/saya-sql-basic.png" });

    const handoff = z.object({ id: z.string(), href: z.string() }).parse(
      await post("create-project", {
        title: `Result menu handoff ${randomUUID()}`,
        sampleDataset: "orders",
      }),
    );
    try {
      await page.goto(`${base}${handoff.href}`, {
        waitUntil: "domcontentloaded",
      });
      const handoffCell = page.locator("[data-notebook-cell]").first();
      const editor = handoffCell.getByRole("textbox", { name: /^Edit / });
      const handoffQuery =
        "SELECT order_id, order_total FROM orders ORDER BY order_id LIMIT 10";
      await writeSqlEditor(editor, handoffQuery);
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: handoff.id })}`,
            { headers },
          );
          if (!response.ok())
            throw new Error(`get-project: HTTP ${response.status()}`);
          const project = z
            .object({ project: projectDocumentSchema })
            .parse(await response.json()).project;
          const contents = project.cells.at(0)?.contents;
          return contents?.kind === "sql" ? contents.source : undefined;
        })
        .toBe(handoffQuery);
      await handoffCell.hover();
      await handoffCell.locator('[data-rid="notebook.cell.run"]').click();
      await expect(
        handoffCell.getByRole("columnheader", { name: /order_total/ }),
      ).toBeVisible();
      await expect(handoffCell.locator(".nb-table tbody tr")).toHaveCount(10);
      await checkResultMenuHandoff(page, handoffCell);
      await page.screenshot({
        path: ".tmp/analytics-owner/saya-result-menu-handoff.png",
      });
    } finally {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      await post("trash-project", { projectId: handoff.id });
      await post("delete-project", { projectId: handoff.id });
    }
  } catch (error) {
    console.error("SAYA SQL BASIC FAILURE", error);
    await page.screenshot({
      path: ".tmp/analytics-owner/saya-sql-basic-failure.png",
    });
    throw error;
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await post("trash-project", { projectId: id });
    await post("delete-project", { projectId: id });
  }
}
