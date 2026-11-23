import { expect, type Page, type Route } from "@playwright/test";
import { z } from "zod";

import { addText, withProject } from "./predicted-notebook-flows.js";
import { writeSqlEditor } from "./sql-editor.js";

const headers = { "x-agent-native-frontend": "1", "x-agent-native-csrf": "1" };
const cells = (page: Page) => page.locator("[data-notebook-cell]");

export async function checkSavedResultPaging(page: Page, base: string) {
  await withProject(page, base, async ({ id, read }) => {
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const cell = cells(page).first();
    const connection = cell.getByRole("button", { name: /^Data connection:/ });
    await connection.click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    await expect(connection).toHaveAccessibleName(
      "Data connection: [Demo] Public Data",
    );
    const editor = cell.getByRole("textbox", { name: /^Edit SQL/ });
    await writeSqlEditor(editor, "select * from orders limit 4");
    await editor.press("ControlOrMeta+Enter");
    const tableRows = cell.locator(".nb-table tbody tr");
    const ids = ["ord_0001", "ord_0002", "ord_0003", "ord_0004"];
    await expect(tableRows.locator("td:first-of-type")).toHaveText(ids, {
      timeout: 30_000,
    });
    const cellId = (await read()).cells[0]?.id;
    if (!cellId) throw new Error("Saved SQL cell is missing");
    const pageSchema = z.object({
      status: z.literal("complete"),
      totalRows: z.literal("4"),
      hasNextPage: z.literal(false),
      offset: z.number(),
      nextOffset: z.number().nullable(),
      output: z.object({
        type: z.literal("table"),
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        rows: z.array(z.array(z.unknown())),
        rowCount: z.literal(4),
        truncated: z.literal(true),
      }),
      preview: z.object({
        valuesTruncated: z.literal(false),
        columnsTruncated: z.literal(false),
      }),
    });
    const readPage = async (offset: number) => {
      const params = new URLSearchParams({
        projectId: id,
        cellId,
        offset: String(offset),
        limit: "2",
      });
      let body: unknown;
      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `${base}/_agent-native/actions/get-project-cell-results?${params}`,
              { headers },
            );
            if (!response.ok())
              throw new Error(
                `get-project-cell-results: HTTP ${response.status()}`,
              );
            body = await response.json();
            return (body as { status?: unknown } | null)?.status;
          },
          { timeout: 15_000, intervals: [200, 500, 1000] },
        )
        .toBe("complete");
      return pageSchema.parse(body);
    };
    const first = await readPage(0);
    const second = await readPage(2);
    expect(first.output.columns).toEqual([
      { name: "order_id", type: "string" },
      { name: "order_date", type: "date" },
      { name: "customer_id", type: "string" },
      { name: "product_id", type: "string" },
      { name: "quantity", type: "number" },
      { name: "unit_price", type: "number" },
      { name: "order_total", type: "number" },
      { name: "channel", type: "string" },
    ]);
    expect(second.output.columns).toEqual(first.output.columns);
    expect([
      first.offset,
      first.nextOffset,
      second.offset,
      second.nextOffset,
    ]).toEqual([0, 2, 2, null]);
    expect(first.output.rows.map((row) => row[0])).toEqual(ids.slice(0, 2));
    expect(second.output.rows.map((row) => row[0])).toEqual(ids.slice(2));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      cells(page).first().locator(".nb-table tbody tr td:first-of-type"),
    ).toHaveText(ids);
  });
}

export async function checkCellDeleteImmediate(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await addText(page, "first QA cell");
    await expect.poll(async () => (await read()).cells.length).toBe(1);
    await addText(page, "delete QA cell");
    await expect.poll(async () => (await read()).cells.length).toBe(2);
    await addText(page, "last QA cell");
    await expect.poll(async () => (await read()).cells.length).toBe(3);
    const before = (await read()).cells.map((cell) => cell.id);
    const deletedId = before[1];
    if (!deletedId) throw new Error("Cell to delete is missing");
    const target = cells(page).nth(1);
    await target.hover();
    await target.getByRole("button", { name: /^More actions for / }).click();
    const menuItem = page.getByRole("menuitem", {
      name: "Delete cell",
      exact: true,
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    let acknowledged = false;
    let routeError: unknown;
    const throwRouteError = () => {
      if (routeError !== undefined)
        throw new Error("Delete request interception failed", {
          cause: routeError,
        });
    };
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pattern = "**/_agent-native/actions/delete-project-cell";
    const handler = async (route: Route) => {
      try {
        held = true;
        await gate;
        await route.continue();
      } catch (error) {
        routeError = error;
      } finally {
        finish();
      }
    };
    await page.route(pattern, handler);
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response
            .url()
            .endsWith("/_agent-native/actions/delete-project-cell") &&
          response.request().method() === "POST",
        { timeout: 30_000 },
      )
      .then(
        (response) => {
          acknowledged = true;
          return { response };
        },
        (error: unknown) => ({ error }),
      );
    try {
      await menuItem.evaluate((button, id) => {
        const state = { start: 0, elapsed: null as number | null };
        (window as unknown as { deleteLatency: typeof state }).deleteLatency =
          state;
        button.addEventListener(
          "click",
          () => {
            state.start = performance.now();
            const observer = new MutationObserver(() => {
              if (
                !document.querySelector(
                  `[data-notebook-cell="${CSS.escape(id)}"]`,
                )
              ) {
                state.elapsed = performance.now() - state.start;
                observer.disconnect();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          },
          { once: true, capture: true },
        );
      }, deletedId);
      await menuItem.click();
      await expect(
        page.locator(`[data-notebook-cell="${deletedId}"]`),
      ).toHaveCount(0);
      await expect.poll(() => held || routeError !== undefined).toBe(true);
      throwRouteError();
      expect(acknowledged).toBe(false);
      const elapsed = await page.evaluate(
        () =>
          (window as unknown as { deleteLatency: { elapsed: number | null } })
            .deleteLatency.elapsed,
      );
      expect(elapsed).not.toBeNull();
      if (elapsed === null)
        throw new Error("Cell removal timing was not recorded");
      expect(elapsed).toBeLessThan(400);
      expect(
        await cells(page).evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-notebook-cell")),
        ),
      ).toEqual([before[0], before[2]]);
      release();
      await finished;
      throwRouteError();
      const result = await responsePromise;
      if ("error" in result) throw result.error;
      const { response } = result;
      expect(response.ok()).toBe(true);
      expect(acknowledged).toBe(true);
      await expect
        .poll(async () => (await read()).cells.map((cell) => cell.id))
        .toEqual([before[0], before[2]]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(cells(page)).toHaveCount(2);
      expect(
        await cells(page).evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-notebook-cell")),
        ),
      ).toEqual([before[0], before[2]]);
    } finally {
      release();
      await page.unroute(pattern, handler);
    }
  });
}
