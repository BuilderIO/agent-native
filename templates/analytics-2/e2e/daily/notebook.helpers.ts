import { expect, type Locator, type Page } from "@playwright/test";

import { required } from "../local/required";
import type { Daily } from "./fixtures";
import { uniqueName } from "./fixtures";

/** The bundled read-only sample connection every project can query. */
export const SAMPLE_CONNECTION = "builtin-sample-data";

export type SeedCell = {
  kind: "sql" | "code" | "markdown" | "text" | "display-table" | "chart";
  /** SQL/Python source, Markdown body or text body. */
  text?: string;
  /** SQL cells only: a connection id (default: none, the Dataframes scope). */
  connection?: string | null;
  label?: string;
};

type CellRecord = { id: string; contents: Record<string, unknown> };
type ProjectResult = { project: { id: string; cells: CellRecord[] } };

export type Notebook = { id: string; title: string; cellIds: string[] };

/** A fresh project with the given cells, created through actions (the creation is not the path under test). */
export async function seedNotebook(
  daily: Daily,
  seeds: SeedCell[] = [],
  title = uniqueName("Notebook"),
): Promise<Notebook> {
  const created = await daily.action<{ id: string }>("create-project", {
    title,
  });
  const cellIds: string[] = [];
  for (const seed of seeds) {
    const added = await daily.action<ProjectResult & { createdCellId: string }>(
      "add-project-cell",
      {
        projectId: created.id,
        kind: seed.kind,
      },
    );
    const cell = required(
      added.project.cells.find((c) => c.id === added.createdCellId),
    );
    const contents: Record<string, unknown> = { ...cell.contents };
    if (seed.text !== undefined) {
      if (seed.kind === "markdown") contents.markdown = seed.text;
      else if (seed.kind === "text") contents.text = seed.text;
      else contents.source = seed.text;
    }
    if (seed.connection !== undefined && seed.kind === "sql") {
      contents.dataConnectionId = seed.connection;
      if (seed.connection === null) contents.connectionMode = "dataframes";
      else delete contents.connectionMode;
    }
    if (seed.label !== undefined) contents.label = seed.label;
    if (
      seed.text !== undefined ||
      seed.connection !== undefined ||
      seed.label !== undefined
    )
      await daily.action("save-project-cell", {
        projectId: created.id,
        cellId: cell.id,
        contents,
      });
    cellIds.push(cell.id);
  }
  return { id: created.id, title, cellIds };
}

/** The cells the stored notebook holds, top to bottom, as the app would list them. */
export async function storedCells(daily: Daily, projectId: string) {
  const result = await daily.action<ProjectResult>(
    "get-project",
    { projectId },
    "GET",
  );
  return result.project.cells
    .map(
      (c) =>
        ({ id: c.id, ...c.contents }) as {
          id: string;
          kind: string;
          order: string;
          source?: string;
          markdown?: string;
          text?: string;
          label?: string | null;
          dataConnectionId?: string | null;
        },
    )
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

/** Open the notebook view of a project and wait until it has rendered (cells or the empty state). */
export async function openNotebook(
  daily: Daily,
  nb: Notebook,
  expectCells = nb.cellIds.length,
) {
  await daily.open(`/project/${nb.id}/latest`);
  if (expectCells > 0)
    await expect(cellLocator(daily.page)).toHaveCount(expectCells, {
      timeout: 30_000,
    });
  else
    await expect(
      daily.page.getByRole("button", { name: "Query", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
}

export const cellLocator = (page: Page) => page.locator("[data-notebook-cell]");
export const cellAt = (page: Page, index: number) =>
  cellLocator(page).nth(index);
export const editorOf = (cell: Locator) =>
  cell.locator(".nb-sql-editor .cm-content, textarea.nb-cell-source");

/** The cell's title text, in notebook order. */
export async function cellTitles(page: Page): Promise<string[]> {
  return cellLocator(page).evaluateAll((els) =>
    els.map((e) => e.querySelector(".nb-cell-title")?.textContent ?? ""),
  );
}

/** Which cell (index) is selected in command mode, or the one holding focus; -1 when none. */
export async function focusedCellIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-notebook-cell]")];
    return all.findIndex(
      (el) =>
        el === document.activeElement || el.contains(document.activeElement),
    );
  });
}

/** True when focus is on the cell itself (command mode), not inside its editor. */
export async function inCommandMode(
  page: Page,
  index: number,
): Promise<boolean> {
  return page.evaluate((i) => {
    const el = document.querySelectorAll("[data-notebook-cell]")[i];
    return el === document.activeElement;
  }, index);
}

/** Put cell `index` into command mode: focus its editor then press Escape, the way a keyboard user does. */
export async function enterCommandMode(daily: Daily, index: number) {
  const cell = cellAt(daily.page, index);
  const editor = editorOf(cell);
  if (await editor.count()) await editor.focus();
  else await cell.focus();
  if (await editor.count()) await daily.press("Escape");
  await expect(cell).toBeFocused();
}

/** Delay the run action so a test can see the running state. */
export async function delayRuns(page: Page, ms: number) {
  await page.route(
    "**/_agent-native/actions/run-project-cell",
    async (route) => {
      await new Promise((done) => setTimeout(done, ms));
      await route.continue();
    },
  );
}

export const MOD = "ControlOrMeta";

/** A query the bundled sample data answers without a connection: `limit` rows from the sample orders table. */
export const sampleSql = (limit: number) =>
  `select * from orders limit ${limit}`;

/** The cells that read as selected: the cell holding command-mode focus plus any cell marked selected. */
export async function selectedCellIndexes(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-notebook-cell]")]
      .map((el, i) =>
        el === document.activeElement ||
        el.getAttribute("aria-selected") === "true" ||
        el.dataset.selected === "true" ||
        el.classList.contains("is-selected")
          ? i
          : -1,
      )
      .filter((i) => i >= 0),
  );
}

/** The output summary a finished table run shows in its cell, e.g. "3 rows × 5 cols". */
export const rowsSummary = (rows: number) => new RegExp(`^${rows} rows? ×`);
