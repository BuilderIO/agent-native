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
  test(`collection Edit uses compact source geometry and cancels at ${width}px`, async ({
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
    await expect(edit).toHaveCSS("height", "28px");
    await expect(edit).toHaveCSS("padding-left", "9px");
    await expect(edit).toHaveCSS("padding-right", "9px");
    await expect(edit).toHaveCSS("gap", "5px");
    await expect(edit.locator("svg")).toHaveCSS("width", "16px");
    await expect(edit.locator("svg")).toHaveCSS("height", "16px");
    const group = header.locator(".analytics-workspace-list-create-group");
    const groupBox = await group.boundingBox();
    const editBox = await edit.boundingBox();
    expect(groupBox).not.toBeNull();
    expect(editBox).not.toBeNull();
    if (!groupBox || !editBox)
      throw new Error("Collection action layout missing");
    expect(editBox.x - groupBox.x - groupBox.width).toBe(8);
    await edit.click();
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
