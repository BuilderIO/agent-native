import { expect, test } from "./fixtures";
import {
  cellAt,
  cellLocator,
  openNotebook,
  seedNotebook,
  storedCells,
} from "./notebook.helpers";

test("report SAYA-1117-DELETE-LATENCY: fc4889036b591e08d139b1575237dcb117041bf96663b98b4272115b29a73fa3.js:2277 removes the selected cell before the delete response", async ({
  daily,
}, testInfo) => {
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: "select 1 as first" },
    { kind: "sql", text: "select 2 as deleted" },
    { kind: "sql", text: "select 3 as last" },
  ]);
  const before = await storedCells(daily, nb.id);
  const deletedId = nb.cellIds[1];
  if (!deletedId) throw new Error("Seeded notebook is missing its second cell");
  await openNotebook(daily, nb);
  const target = daily.page.locator(`[data-notebook-cell="${deletedId}"]`);
  await expect(target).toBeVisible();
  await cellAt(daily.page, 1).hover();
  await cellAt(daily.page, 1)
    .getByRole("button", { name: /^More actions for / })
    .click();
  const deleteItem = daily.page.getByRole("menuitem", {
    name: "Delete cell",
    exact: true,
  });
  await expect(deleteItem).toBeVisible();

  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let held = false;
  let acknowledged = false;
  let responseOk = false;
  let routeError: unknown;
  const pattern = "**/_agent-native/actions/delete-project-cell";
  const handler = async (route: import("@playwright/test").Route) => {
    try {
      const response = await route.fetch();
      responseOk = response.ok();
      held = true;
      await gate;
      await route.fulfill({ response });
      acknowledged = true;
    } catch (error) {
      routeError = error;
    } finally {
      finish();
    }
  };
  await daily.page.route(pattern, handler);
  try {
    await deleteItem.evaluate((button, id) => {
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
    await deleteItem.click();
    await expect(target).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(() => held || routeError !== undefined).toBe(true);
    if (routeError !== undefined) throw routeError;
    expect(acknowledged).toBe(false);
    const elapsed = await daily.page.evaluate(
      () =>
        (window as unknown as { deleteLatency: { elapsed: number | null } })
          .deleteLatency.elapsed,
    );
    await daily.page.screenshot({
      path: testInfo.outputPath("delete-before-ack.png"),
    });
    expect(elapsed).not.toBeNull();
    if (elapsed === null)
      throw new Error("Cell removal timing was not recorded");
    expect(elapsed).toBeLessThan(400);
    expect(
      await cellLocator(daily.page).evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-notebook-cell")),
      ),
    ).toEqual([nb.cellIds[0], nb.cellIds[2]]);

    release();
    await finished;
    if (routeError !== undefined) throw routeError;
    expect(responseOk).toBe(true);
    await expect
      .poll(() => storedCells(daily, nb.id))
      .toEqual(before.filter((cell) => cell.id !== deletedId));
    await daily.reload();
    await expect(cellLocator(daily.page)).toHaveCount(2);
    expect(
      await cellLocator(daily.page).evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-notebook-cell")),
      ),
    ).toEqual([nb.cellIds[0], nb.cellIds[2]]);
    await daily.check({ url: new RegExp(`/project/${nb.id}/latest$`) });
  } finally {
    release();
    await daily.page.unroute(pattern, handler);
  }
});
