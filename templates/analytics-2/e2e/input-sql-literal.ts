import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

const headers = {
  "x-agent-native-frontend": "1",
  "x-agent-native-csrf": "1",
};

async function rethrowWithShot(page: Page, error: unknown): Promise<never> {
  const primary = error instanceof Error ? error.message : String(error);
  const path = `.tmp/analytics-owner/input-dependencies-failure-${randomUUID()}.png`;
  try {
    await page.screenshot({ path });
  } catch (shotError) {
    const reason =
      shotError instanceof Error ? shotError.message : String(shotError);
    throw new Error(`${primary}\nfailure screenshot not captured: ${reason}`, {
      cause: error,
    });
  }
  throw new Error(`${primary}\nfailure screenshot: ${path}`, { cause: error });
}

export async function checkInputSqlLiteral(page: Page, base: string) {
  await withProject(page, base, async ({ id, read }) => {
    const added = await page.request.post(
      `${base}/_agent-native/actions/add-project-cell`,
      {
        headers,
        data: {
          projectId: id,
          kind: "input",
          inputType: "TEXT_INPUT",
          name: "selected_borough",
        },
      },
    );
    expect(added.ok()).toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    const input = page.getByRole("textbox", {
      name: "Value for selected_borough",
    });
    await input.fill("Brooklyn");
    await input.blur();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({
        kind: "input",
        name: "selected_borough",
        defaultValueString: "Brooklyn",
      });

    await page
      .getByRole("button", { name: "Query", exact: true })
      .last()
      .click();
    const cells = page.locator("[data-notebook-cell]");
    const query = cells.last();
    await query.getByRole("button", { name: /^Data connection:/ }).click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    const editor = query.getByRole("textbox", { name: /^Edit SQL/ });
    await editor.fill("SELECT {{ selected_borough | sql_literal }} AS picked");
    await editor.press("ControlOrMeta+Enter");
    try {
      await expect(
        query.locator("tbody tr").first().locator("td"),
        "SQL must bind the input through sql_literal",
      ).toHaveText(["Brooklyn"], { timeout: 30000 });
    } catch (error) {
      console.error(
        "INPUT SQL failure state",
        JSON.stringify({
          rows: await query.locator("tbody tr").count(),
          alerts: await query.getByRole("alert").count(),
          running: await query
            .getByRole("button", { name: /cancel|stop/i })
            .count(),
        }),
      );
      await rethrowWithShot(page, error);
    }

    const marked = () =>
      cells.evaluateAll((nodes) =>
        nodes
          .filter((node) => node.classList.contains("is-selected"))
          .map((node) => (node as HTMLElement).dataset.notebookCell),
      );
    const choose = async (
      cell: ReturnType<typeof cells.nth>,
      label: string,
    ) => {
      try {
        await cell.getByRole("button", { name: /^More actions for/ }).click();
        await page
          .getByRole("menuitem", { name: "Select cell and...", exact: true })
          .click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
      } catch (error) {
        await rethrowWithShot(page, error);
      }
      await expect(
        page.getByRole("menu"),
        "the cell menu must close after a choice",
      ).toHaveCount(0);
    };
    const [inputId, queryId] = (await read()).cells
      .map((cell) => ({ id: cell.id, order: cell.contents.order }))
      .sort((a, b) => (a.order < b.order ? -1 : 1))
      .map((cell) => cell.id);

    await choose(query, "all upstream");
    await expect.poll(marked).toEqual([inputId, queryId]);
    await page.screenshot({
      path: ".tmp/analytics-owner/input-dependencies-local.png",
    });
    await page.keyboard.press("Escape");
    await expect.poll(marked).toEqual([]);
    await choose(cells.first(), "all downstream");
    await expect.poll(marked).toEqual([inputId, queryId]);
    await page.keyboard.press("Escape");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("textbox", { name: "Value for selected_borough" }),
    ).toHaveValue("Brooklyn");
    await expect(
      cells.last().locator("tbody tr").first().locator("td"),
    ).toHaveText(["Brooklyn"]);
    await page.screenshot({
      path: ".tmp/analytics-owner/input-dependencies-reloaded.png",
    });
  });
}
