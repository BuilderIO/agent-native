import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, type Page, type Route } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import { addCellKind } from "./add-cell-kind.js";
import { safeRequest } from "./safe-request.js";
import { writeSqlEditor } from "./sql-editor.js";
import { fetchUiAction } from "./ui-capability.js";

const headers = {
  "x-agent-native-frontend": "1",
  "x-agent-native-csrf": "1",
};

export async function leaveProject(page: Page, base: string) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(`${base}/home`);
}

export async function withProject(
  page: Page,
  base: string,
  run: (fixture: {
    id: string;
    read: () => Promise<z.infer<typeof projectDocumentSchema>>;
    readPublished: () => Promise<z.infer<typeof projectDocumentSchema>>;
  }) => Promise<void>,
) {
  const call = async (
    name: string,
    data: Record<string, string>,
    method: "GET" | "POST" = "POST",
  ) => {
    const url = `${base}/_agent-native/actions/${name}`;
    const response = await safeRequest(
      `${method} /_agent-native/actions/${name}`,
      () =>
        fetchUiAction(
          page.request,
          base,
          method === "GET" ? `${url}?${new URLSearchParams(data)}` : url,
          { method, ...(method === "POST" ? { data } : {}) },
        ),
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const created = z.object({ id: z.string() }).parse(
    await call("create-project", {
      title: `QA notebook workflow ${randomUUID()}`,
    }),
  );
  const read = async () =>
    z
      .object({ project: projectDocumentSchema })
      .parse(await call("get-project", { projectId: created.id }, "GET"))
      .project;
  const readPublished = async () =>
    z
      .object({ project: projectDocumentSchema })
      .parse(
        await call(
          "get-project",
          { projectId: created.id, version: "latest" },
          "GET",
        ),
      ).project;
  try {
    await page.goto(
      `${base}/project/${encodeURIComponent(created.id)}/latest`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    const landed = new URL(page.url()).pathname;
    if (!landed.includes(encodeURIComponent(created.id)))
      throw new Error(
        `project page redirected: wanted /project/${created.id}/latest, landed on ${landed}`,
      );
    await page
      .getByRole("group", { name: "Add code cell" })
      .last()
      .waitFor({ timeout: 15000 })
      .catch(async (error) => {
        const text = (await page.locator("body").innerText())
          .replace(/\s+/g, " ")
          .slice(0, 300);
        throw new Error(`project page not ready at ${page.url()}: ${text}`, {
          cause: error,
        });
      });
    await run({ id: created.id, read, readPublished }).catch((error) => {
      if (!(error instanceof Error)) throw error;
      throw new Error(error.message.replace(/\s+/g, " ").slice(0, 700), {
        cause: error,
      });
    });
  } finally {
    await leaveProject(page, base);
    await call("trash-project", { projectId: created.id });
    await call("delete-project", { projectId: created.id });
    const response = await safeRequest(
      "GET /_agent-native/actions/get-project",
      () =>
        page.request.get(
          `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
          { headers },
        ),
    );
    if (response.status() !== 404)
      throw new Error(`Project cleanup readback HTTP ${response.status()}`);
  }
}

const cells = (page: Page) => page.locator("[data-notebook-cell]");

export async function addText(page: Page, value: string) {
  const previousCount = await cells(page).count();
  await addCellKind(page, "Text");
  await expect(cells(page)).toHaveCount(previousCount + 1);
  const cell = cells(page).last();
  const editor = cell.getByRole("textbox", { name: /^Edit Text/ });
  await expect(editor).toBeVisible();
  await editor.fill(value);
  await editor.blur();
  return cell;
}

export async function checkMarkdownTextCells(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await addText(page, "A note written by QA");
    await addCellKind(page, "Markdown");
    const markdown = cells(page).last();
    const editor = markdown.getByRole("textbox", { name: /^Edit Markdown/ });
    await expect(editor).toBeFocused();
    await editor.fill("# QA heading\n\nA **bold** note.");
    await editor.blur();
    await expect(
      markdown.getByRole("heading", { name: "QA heading" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await read()).cells.map((cell) => cell.contents))
      .toMatchObject([
        { kind: "text", text: "A note written by QA" },
        { kind: "markdown", markdown: "# QA heading\n\nA **bold** note." },
      ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cells(page)).toHaveCount(2);
    await expect(
      cells(page).first().getByText("A note written by QA"),
    ).toBeVisible();
    await expect(
      cells(page).last().getByRole("heading", { name: "QA heading" }),
    ).toBeVisible();
    await expect(
      cells(page).last().getByText("bold", { exact: true }),
    ).toBeVisible();
  });
}

export async function checkCellReorder(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await addText(page, "first QA cell");
    await expect.poll(async () => (await read()).cells.length).toBe(1);
    await addText(page, "second QA cell");
    await expect
      .poll(async () =>
        (await read()).cells.map((cell) =>
          cell.contents.kind === "text" ? cell.contents.text : null,
        ),
      )
      .toEqual(["first QA cell", "second QA cell"]);
    const original = (await read()).cells.map((cell) => cell.id);
    const first = cells(page).first();
    await first.hover();
    await first.getByRole("button", { name: /^More actions for / }).click();
    await page
      .getByRole("menuitem", { name: "Move down", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).cells.map((cell) => cell.id))
      .toEqual([original[1], original[0]]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cells(page)).toHaveCount(2);
    await expect
      .poll(() =>
        cells(page).evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-notebook-cell")),
        ),
      )
      .toEqual([original[1], original[0]]);
    await expect(
      cells(page)
        .first()
        .getByRole("textbox", { name: /^Edit Text/ }),
    ).toHaveValue("second QA cell");
    await expect(
      cells(page)
        .last()
        .getByRole("textbox", { name: /^Edit Text/ }),
    ).toHaveValue("first QA cell");

    await addText(page, "third QA cell");
    const moved = (await read()).cells.map((cell) => cell.id);
    expect(moved).toHaveLength(3);
    const texts = async () =>
      (await read()).cells.map((cell) =>
        cell.contents.kind === "text" ? cell.contents.text : null,
      );
    await expect
      .poll(texts)
      .toEqual(["second QA cell", "first QA cell", "third QA cell"]);
    const last = cells(page).last();
    const box = await last.boundingBox();
    if (box == null) throw new Error("last cell has no layout box");
    await cells(page).first().hover();
    await cells(page)
      .first()
      .getByRole("img", { name: "Drag to reorder" })
      .dragTo(last, {
        targetPosition: { x: box.width / 2, y: box.height * 0.75 },
      });
    await expect
      .poll(async () => (await read()).cells.map((cell) => cell.id))
      .toEqual([moved[1], moved[2], moved[0]]);
    expect(await texts()).toEqual([
      "first QA cell",
      "third QA cell",
      "second QA cell",
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cells(page)).toHaveCount(3);
    await expect
      .poll(() =>
        cells(page).evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-notebook-cell")),
        ),
      )
      .toEqual([moved[1], moved[2], moved[0]]);
    expect(await texts()).toEqual([
      "first QA cell",
      "third QA cell",
      "second QA cell",
    ]);
    await page.screenshot({
      path: ".tmp/analytics-owner/cell-reorder-local.png",
    });
  });
}

export async function checkNotebookKeyboardShortcuts(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const first = cells(page).first();
    const editor = first.getByRole("textbox", { name: /^Edit SQL/ });
    await expect(editor).toBeVisible();
    const connection = first.getByRole("button", { name: /^Data connection:/ });
    await connection.click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    await expect(connection).toHaveAccessibleName(
      "Data connection: [Demo] Public Data",
    );
    await editor.fill("SELECT * FROM orders LIMIT 1");
    await editor.press("Shift+Enter");
    await expect(first.locator("tbody tr")).toHaveCount(1, { timeout: 30000 });
    await expect(cells(page)).toHaveCount(2);
    const next = cells(page).nth(1);
    const nextEditor = next.getByRole("textbox", { name: /^Edit SQL/ });
    await expect(nextEditor).toBeFocused();
    await nextEditor.press("Escape");
    await expect(next).toBeFocused();
    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await expect(cells(page)).toHaveCount(1);
    await expect
      .poll(async () =>
        (await read()).cells.map((cell) =>
          cell.contents.kind === "sql" ? cell.contents.source : null,
        ),
      )
      .toEqual(["SELECT * FROM orders LIMIT 1"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cells(page)).toHaveCount(1);
    await expect(cells(page).first().locator("tbody tr")).toHaveCount(1);
    expect((await read()).cells[0]?.contents).toMatchObject({
      kind: "sql",
      source: "SELECT * FROM orders LIMIT 1",
    });
  });
}

export async function checkChainedSqlCell(page: Page, base: string) {
  await withProject(page, base, async ({ id, read }) => {
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const first = cells(page).first();
    const firstPicker = first.getByRole("button", {
      name: /^Data connection:/,
    });
    if (
      (await firstPicker.getAttribute("aria-label")) !==
      "Data connection: [Demo] Public Data"
    ) {
      await firstPicker.click();
      await page
        .getByRole("menu", { name: "Data connections" })
        .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
        .click();
    }
    await expect(firstPicker).toHaveAccessibleName(
      "Data connection: [Demo] Public Data",
    );
    await expect
      .poll(async () => {
        const contents = (await read()).cells.at(0)?.contents;
        return contents?.kind === "sql" ? contents.dataConnectionId : undefined;
      })
      .toBe(SAMPLE_DATA_SOURCE_ID); // oracle-change: the new SQL cell is preconfigured with its current default connection
    const firstEditor = first.getByRole("textbox", { name: /^Edit SQL/ });
    await writeSqlEditor(firstEditor, "SELECT order_total FROM orders LIMIT 2");
    await firstEditor.press("ControlOrMeta+Enter");
    await expect(first.locator("tbody tr")).toHaveCount(2, { timeout: 30000 });
    const initial = await read();
    expect(initial.cells[0]?.contents).toMatchObject({
      kind: "sql",
      resultVariable: "dataframe",
      source: "SELECT order_total FROM orders LIMIT 2",
    });
    await page
      .getByRole("button", { name: "Query", exact: true })
      .last()
      .click();
    await expect(cells(page)).toHaveCount(2);
    const second = cells(page).last();
    const picker = second.getByRole("button", { name: /^Data connection:/ });
    if (
      (await picker.getAttribute("aria-label")) !==
      "Data connection: Dataframes"
    ) {
      await picker.click();
      await page
        .getByRole("menu", { name: "Data connections" })
        .getByRole("menuitemradio", { name: /Dataframes/ })
        .click();
    }
    await expect(picker).toHaveAccessibleName("Data connection: Dataframes");
    const editor = second.getByRole("textbox", { name: /^Edit SQL/ });
    await writeSqlEditor(editor, "SELECT COUNT(*) AS n FROM dataframe");
    await editor.press("ControlOrMeta+Enter");
    await expect(second.locator("tbody tr")).toHaveCount(1, { timeout: 30000 });
    await expect(second.locator("tbody tr").first().locator("td")).toHaveText([
      "2",
    ]);
    const secondId = await second.getAttribute("data-notebook-cell");
    if (!secondId) throw new Error("Dependent SQL cell id missing");
    await expect
      .poll(async () => {
        const execResp = await safeRequest(
          "GET /_agent-native/actions/get-notebook-execution",
          () =>
            page.request.get(
              `${base}/_agent-native/actions/get-notebook-execution?${new URLSearchParams({ projectId: id })}`,
              { headers },
            ),
        );
        if (!execResp.ok()) return null;
        const execution = z
          .object({
            cells: z
              .record(
                z.string(),
                z.object({ resultId: z.string().nullable() }).passthrough(),
              )
              .optional(),
          })
          .parse(await execResp.json());
        const resultId = execution.cells?.[secondId]?.resultId;
        if (!resultId) return null;
        const pageResp = await safeRequest(
          "GET /_agent-native/actions/get-notebook-result-page",
          () =>
            page.request.get(
              `${base}/_agent-native/actions/get-notebook-result-page?${new URLSearchParams({ resultId })}`,
              { headers },
            ),
        );
        if (!pageResp.ok()) return null;
        return z
          .object({
            status: z.string(),
            rows: z.array(z.array(z.unknown())).optional(),
          })
          .parse(await pageResp.json());
      })
      .toMatchObject({
        status: "ready",
        rows: [[{ type: "integer", value: "2" }]],
      });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cells(page)).toHaveCount(2);
    await expect(
      cells(page).last().locator("tbody tr").first().locator("td"),
    ).toHaveText(["2"]);
  });
}

async function prepareChart(
  page: Page,
  read: () => Promise<z.infer<typeof projectDocumentSchema>>,
) {
  await page
    .getByRole("button", { name: "Query", exact: true })
    .first()
    .click();
  const query = cells(page).first();
  const picker = query.getByRole("button", { name: /^Data connection:/ });
  await picker.click();
  await page
    .getByRole("menu", { name: "Data connections" })
    .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
    .click();
  await expect(picker).toHaveAccessibleName(
    "Data connection: [Demo] Public Data",
  );
  const sql = "SELECT channel, order_total FROM orders LIMIT 2";
  const editor = query.getByRole("textbox", { name: /^Edit SQL/ });
  await editor.fill(sql);
  await editor.press("ControlOrMeta+Enter");
  await expect(query.locator("tbody tr")).toHaveCount(2, { timeout: 30000 });
  await addCellKind(page, "Chart");
  await expect(cells(page)).toHaveCount(2);
  const chart = cells(page).last();
  const id = await chart.getAttribute("data-notebook-cell");
  if (!id) throw new Error("Chart cell id missing");
  const chartState = async () =>
    withFieldNames(
      (await read()).cells.find((cell) => cell.id === id)?.contents,
    );
  await chart.getByRole("combobox", { name: "DataFrame", exact: true }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "dataframe", exact: true })
    .click();
  await expect
    .poll(chartState)
    .toMatchObject({ kind: "chart", dataframe: "dataframe" });
  await chart.getByRole("combobox", { name: "X-axis", exact: true }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "channel", exact: true })
    .click();
  await expect
    .poll(chartState)
    .toMatchObject({ kind: "chart", chartSpec: { xField: "channel" } });
  await chart.getByRole("combobox", { name: "Y-axis", exact: true }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "order_total", exact: true })
    .click();
  await expect
    .poll(chartState)
    .toMatchObject({ kind: "chart", chartSpec: { yField: "order_total" } });
  await expect(
    chart.locator(".nb-vega-chart[data-chart-mark-type='bar']"),
  ).toBeVisible();
  return { id, chart, chartState };
}

// Stored chart specs key axes by result fieldId and carry id -> column name
// in fieldLabels (CompleteResultChart.tsx), so oracles compare resolved names.
function withFieldNames(contents: unknown): unknown {
  const c = contents as
    | {
        chartSpec?: {
          xField?: string;
          yField?: string;
          fieldLabels?: Record<string, string>;
        };
      }
    | undefined;
  const spec = c?.chartSpec;
  if (!spec?.fieldLabels) return contents;
  const name = (f?: string) => (f ? (spec.fieldLabels?.[f] ?? f) : f);
  return {
    ...c,
    chartSpec: {
      ...spec,
      xField: name(spec.xField),
      yField: name(spec.yField),
    },
  };
}

export async function checkRefineChart(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    const { chart, chartState } = await prepareChart(page, read);
    await chart.getByRole("button", { name: "Chart type" }).first().click();
    await chart.getByRole("button", { name: "Line", exact: true }).click();
    await expect.poll(chartState).toMatchObject({
      kind: "chart",
      chartSpec: { mark: "line", xField: "channel", yField: "order_total" },
    });
    await expect(chart.locator('[data-chart-mark-type="line"]')).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await chart.getByRole("button", { name: "Chart type" }).first().click();
    await expect(
      chart.getByRole("button", { name: "Line", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator('[data-chart-mark-type="line"]')).toBeVisible();
    await expect(chart.getByRole("combobox", { name: "DataFrame" })).toHaveText(
      "dataframe",
    );
    await expect(chart.getByRole("combobox", { name: "X-axis" })).toHaveText(
      "channel",
    );
    await expect(chart.getByRole("combobox", { name: "Y-axis" })).toHaveText(
      "order_total",
    );
  });
}

export async function checkChartFormatting(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    const { chart, chartState } = await prepareChart(page, read);
    const title = "Revenue by channel, quarterly";
    const titleInput = chart.getByRole("textbox", { name: "Chart title" });
    await titleInput.click();
    await page.keyboard.type(title, { delay: 20 });
    await expect(titleInput).toHaveValue(title);
    await titleInput.press("Enter");
    await expect
      .poll(chartState)
      .toMatchObject({ kind: "chart", chartSpec: { title } });

    await chart.getByText("Appearance", { exact: true }).click();
    await chart
      .getByRole("combobox", { name: "Value format", exact: true })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "Percent", exact: true })
      .click();
    await expect
      .poll(chartState)
      .toMatchObject({ kind: "chart", chartSpec: { yFormatter: "percent" } });
    await expect(
      chart.locator(".role-axis .role-axis-label text").last(),
    ).toContainText("%");

    await chart.getByRole("button", { name: "Chart type" }).first().click();
    await chart.getByRole("button", { name: "Pie", exact: true }).click();
    await expect(chart.locator(".role-legend")).toBeVisible();
    await chart.getByRole("checkbox", { name: "Show legend" }).uncheck();
    await expect
      .poll(chartState)
      .toMatchObject({ kind: "chart", chartSpec: { legend: false } });
    await expect(chart.locator(".role-legend")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      chart.getByRole("textbox", { name: "Chart title" }),
    ).toHaveValue(title);
  });
}

export async function checkPublishDashboard(page: Page, base: string) {
  await withProject(page, base, async ({ id, read, readPublished }) => {
    const chart = await prepareChart(page, read);
    await page
      .getByRole("button", { name: "App builder", exact: true })
      .click();
    const editManually = page.getByRole("button", {
      name: "Edit app manually",
      exact: true,
    });
    if (await editManually.isVisible()) {
      await editManually.click();
    }
    const builder = page.locator(".nb-app-builder");
    await expect(
      builder.locator(".nb-vega-chart[data-chart-mark-type='bar']"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Publish app" });
    await dialog
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    const published = await readPublished();
    expect(
      withFieldNames(
        published.cells.find((cell) => cell.id === chart.id)?.contents,
      ),
    ).toMatchObject({
      kind: "chart",
      dataframe: "dataframe",
      chartSpec: { xField: "channel", yField: "order_total", mark: "bar" },
    });
    await page.goto(`${base}/app/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.locator(".nb-vega-chart[data-chart-mark-type='bar']"),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.locator(".nb-vega-chart[data-chart-mark-type='bar']"),
    ).toContainText("marketplace");
    await expect(
      page.locator(".nb-vega-chart[data-chart-mark-type='bar']"),
    ).toContainText("partner");
  });
}

export async function checkDownloadCsv(page: Page, base: string) {
  await withProject(page, base, async () => {
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const query = cells(page).first();
    const picker = query.getByRole("button", { name: /^Data connection:/ });
    await picker.click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    const editor = query.getByRole("textbox", { name: /^Edit SQL/ });
    await editor.fill("SELECT 'Ada' AS name, 12 AS amount FROM orders LIMIT 1");
    await editor.press("ControlOrMeta+Enter");
    await expect(query.locator("tbody tr").first().locator("td")).toHaveText(
      ["Ada", "12"],
      { timeout: 30000 },
    );
    const downloadButton = query.getByRole("button", {
      name: /download.*csv/i,
    });
    await expect(
      downloadButton,
      "Query results must offer CSV download",
    ).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const path = await download.path();
    if (!path) throw new Error("CSV download did not produce a file");
    expect(
      (await readFile(path, "utf8")).replace(/\r\n/g, "\n").trimEnd(),
    ).toBe("name,amount\nAda,12");
  });
}

export async function checkParameterQuery(page: Page, base: string) {
  await withProject(page, base, async ({ id, read }) => {
    const response = await page.request.post(
      `${base}/_agent-native/actions/add-project-cell`,
      {
        headers,
        data: {
          projectId: id,
          kind: "input",
          inputType: "TEXT_INPUT",
          name: "region",
        },
      },
    );
    expect(response.ok()).toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    const input = page.getByRole("textbox", { name: "Value for region" });
    await input.fill("marketplace");
    await input.blur();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({
        kind: "input",
        name: "region",
        defaultValueString: "marketplace",
      });
    await page
      .getByRole("button", { name: "Query", exact: true })
      .last()
      .click();
    const query = cells(page).last();
    const picker = query.getByRole("button", { name: /^Data connection:/ });
    await picker.click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    const editor = query.getByRole("textbox", { name: /^Edit SQL/ });
    await editor.fill("SELECT {{ region }} AS selected FROM orders LIMIT 1");
    await editor.press("ControlOrMeta+Enter");
    await expect(
      query.locator("tbody tr").first().locator("td"),
      "SQL must evaluate the input parameter",
    ).toHaveText(["marketplace"], { timeout: 30000 });
    await input.fill("partner");
    await input.blur();
    await editor.press("ControlOrMeta+Enter");
    await expect(query.locator("tbody tr").first().locator("td")).toHaveText(
      ["partner"],
      { timeout: 30000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("textbox", { name: "Value for region" }),
    ).toHaveValue("partner");
    await expect(
      cells(page).last().locator("tbody tr").first().locator("td"),
    ).toHaveText(["partner"]);
  });
}

export async function checkBrowseDataCatalog(page: Page, base: string) {
  await page.goto(`${base}/home/data`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Warehouse", exact: true }).click();
  const response = await page.request.get(
    `${base}/_agent-native/actions/list-data-connections`,
    { headers },
  );
  expect(response.ok()).toBe(true);
  const inventory = z
    .object({
      connections: z.array(
        z.object({ type: z.string(), isDemo: z.boolean().optional() }),
      ),
    })
    .parse(await response.json());
  console.log(
    `CATALOG fixture connections=${inventory.connections.length} demo=${inventory.connections.filter((connection) => connection.isDemo === true).length}`,
  );
  if (inventory.connections.some((connection) => !connection.isDemo)) {
    await page.getByRole("button", { name: /^\[Demo\] Public Data/ }).click();
  } else {
    await page.getByRole("button", { name: /Explore demo data/ }).click();
  }
  const tree = page.locator(".data-page-tree-pane");
  await expect(
    page.getByRole("heading", { name: "[Demo] Public Data", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Collapse PUBLIC", exact: true }),
  ).toBeVisible();
  await tree.getByRole("button", { name: "customers", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "customers", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const preview = page
    .getByRole("tabpanel")
    .filter({ has: page.getByRole("columnheader", { name: "customer_id" }) });
  await expect(preview.locator("thead th")).toHaveText([
    "customer_id",
    "customer_name",
    "country",
    "segment",
    "created_at",
  ]);
  await expect(preview.locator("tbody tr")).toHaveCount(12);
  await expect(
    preview.locator("tbody tr").first().locator("td").nth(0),
  ).toHaveText("cus_001");
  await expect(
    preview.locator("tbody tr").first().locator("td").nth(1),
  ).toHaveText("Acme Supply 1");
  await tree.getByRole("button", { name: "PUBLIC", exact: true }).click();
  await expect(
    tree.getByRole("button", { name: "customers", exact: true }),
  ).toBeVisible();
}
