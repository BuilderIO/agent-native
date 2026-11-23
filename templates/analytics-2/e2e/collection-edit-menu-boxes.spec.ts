import { expect, test } from "@playwright/test";

import { AUTH_DISABLED, E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname) ||
  process.env.DATABASE_URL !== "pglite:memory" ||
  !AUTH_DISABLED
) {
  throw new Error(
    "Collection edit checks require loopback with isolated memory storage and local development auth.",
  );
}

for (const width of [1440, 780]) {
  test(`collection Edit menu matches measured item boxes and opens metadata at ${width}px`, async ({
    page,
  }) => {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(BASE).origin
        ? route.continue()
        : route.abort(),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${BASE}/collections`);
    await page
      .getByRole("button", { name: "New collection", exact: true })
      .click();
    const name = `Synthetic collection ${width} ${Date.now()}`;
    await page.locator("#analytics-collection-name").fill(name);
    const share = page.getByRole("checkbox");
    if (await share.count()) await share.first().uncheck();
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByText(name, { exact: true }).click();
    const header = page.locator('[data-list-page="collections"] > header');
    const edit = header.getByRole("button", { name: "Edit", exact: true });
    await expect(edit).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await edit.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveText([
      "Add to favorites",
      "Edit collection",
      "Delete collection",
    ]);
    await expect(items.locator("svg")).toHaveCount(3);
    await expect(menu).toHaveCSS("padding", "5px");
    await expect(menu).toHaveCSS("border-top-width", "0px");
    await expect(menu).toHaveCSS("border-radius", "3px");
    await expect(menu).toHaveCSS("min-width", "80px");
    await expect.poll(async () => (await menu.boundingBox())?.height).toBe(94);
    for (const item of await items.all()) {
      await expect(item).toHaveCSS("border-radius", "3px");
      await expect(item).toHaveCSS("line-height", "20px");
      await expect(item.locator("svg")).toHaveCSS("width", "16px");
      expect((await item.boundingBox())?.height).toBe(28);
    }
    await page.screenshot({
      path: test.info().outputPath("collection-edit-menu.png"),
    });
    await page
      .getByRole("menuitem", { name: "Edit collection", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit collection settings" }),
    ).toBeVisible();
    await expect(dialog.locator("input")).toHaveValue(name);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  });
}
