import { expect, type Locator, type Page } from "@playwright/test";

import { required } from "../local/required";
import type { Daily } from "./fixtures";
import { uniqueName } from "./fixtures";
import {
  cellAt,
  cellLocator,
  editorOf,
  type Notebook,
  type SeedCell,
} from "./notebook.helpers";
import {
  createConnection,
  deleteConnections,
  connections,
} from "./setup.helpers";

const SLOW = 60_000;

/** Call an app action as the signed-in user with a timeout that survives a loaded machine (setup and cleanup only). */
export async function slowAction<T = unknown>(
  daily: Daily,
  name: string,
  body: Record<string, unknown> = {},
  method: "GET" | "POST" = "POST",
): Promise<T> {
  return daily.action<T>(name, body, method);
}

type CellRecord = { id: string; contents: Record<string, unknown> };

/** A fresh project with the given cells, created through actions (the creation is not the path under test). */
export async function seed(
  daily: Daily,
  seeds: SeedCell[] = [],
  title = uniqueName("Notebook"),
): Promise<Notebook> {
  const created = await slowAction<{ id: string }>(daily, "create-project", {
    title,
  });
  const cellIds: string[] = [];
  for (const one of seeds) {
    const added = await slowAction<{
      project: { cells: CellRecord[] };
      createdCellId: string;
    }>(daily, "add-project-cell", { projectId: created.id, kind: one.kind });
    const cell = required(
      added.project.cells.find((c) => c.id === added.createdCellId),
    );
    const contents: Record<string, unknown> = { ...cell.contents };
    if (one.text !== undefined) {
      if (one.kind === "markdown") contents.markdown = one.text;
      else if (one.kind === "text") contents.text = one.text;
      else contents.source = one.text;
    }
    if (one.connection !== undefined && one.kind === "sql")
      contents.dataConnectionId = one.connection;
    if (one.text !== undefined || one.connection !== undefined)
      await slowAction(daily, "save-project-cell", {
        projectId: created.id,
        cellId: cell.id,
        contents,
      });
    cellIds.push(cell.id);
  }
  return { id: created.id, title, cellIds };
}

/** Open the notebook view and wait until its cells have rendered (or the add-cell bar, when empty). */
export async function open(
  daily: Daily,
  nb: Notebook,
  expectCells = nb.cellIds.length,
) {
  await daily.open(`/project/${nb.id}/latest`);
  if (expectCells > 0)
    await expect(cellLocator(daily.page)).toHaveCount(expectCells, {
      timeout: SLOW,
    });
  else
    await expect(
      daily.page.getByRole("button", { name: "Query", exact: true }),
    ).toBeVisible({ timeout: SLOW });
}

/**
 * A workspace BigQuery connection on the local fake. The create action only accepts requests
 * from the signed-in app UI, so it is sent from the loaded page the way the connection form does.
 */
export async function createBigQueryConnection(
  daily: Daily,
  name = uniqueName("Daily BigQuery"),
): Promise<{ id: string; name: string }> {
  return { id: await createConnection(daily, name), name };
}

export async function deleteConnection(daily: Daily, id: string) {
  const connection = (await connections(daily)).find(
    (candidate) => candidate.id === id,
  );
  if (connection) await deleteConnections(daily, [connection.name]);
}

export async function trashProject(daily: Daily, id: string) {
  await daily.cleanupProject(id);
}

/** The run button of a cell. */
export const runButton = (cell: Locator) => cell.locator(".nb-run-button");
/** The output section of a cell. */
export const outputOf = (cell: Locator) => cell.locator(".nb-output-section");

/** Focus a cell's editor and run it with mod+Enter, the way a keyboard user does. */
export async function runWithKeyboard(daily: Daily, index: number) {
  const editor = editorOf(cellAt(daily.page, index));
  await editor.focus();
  await daily.press("ControlOrMeta+Enter");
}

/** Wait until cell `index` has a finished output (a summary that is not the running label). */
export async function waitForOutput(
  page: Page,
  index: number,
  timeout = 30_000,
) {
  const cell = cellAt(page, index);
  const title = cell.locator(".nb-output-title");
  await expect(
    cell.locator(".nb-output-title, [role=alert]").first(),
  ).toBeVisible({ timeout });
  await expect(cell.getByText(/^Running/).first()).not.toBeVisible({ timeout });
  await expect(
    title,
    "a successful run renders its output summary",
  ).toBeVisible({ timeout: 400 });
}

export function projectUrl(nb: Pick<Notebook, "id">, view: "" | "/app" = "") {
  return new RegExp(`/project/${nb.id}/latest${view.replace("/", "\\/")}$`);
}

/** The stored cells of a project, top to bottom. */
export async function stored(daily: Daily, projectId: string) {
  const result = await slowAction<{ project: { cells: CellRecord[] } }>(
    daily,
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
          dataConnectionId?: string | null;
        },
    )
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}
