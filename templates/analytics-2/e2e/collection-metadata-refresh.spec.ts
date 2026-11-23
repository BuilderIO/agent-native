import { expect, test } from "@playwright/test";

import { AUTH_DISABLED, E2E_BASE_URL } from "./e2e-env";
const BASE = E2E_BASE_URL;
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname) ||
  process.env.DATABASE_URL !== "pglite:memory" ||
  !AUTH_DISABLED
) {
  throw new Error(
    "Collection checks require isolated memory storage, loopback and development auth.",
  );
}

test("collection metadata save refreshes details and survives the original bookmarked URL", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(BASE).origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${BASE}/collections`);
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  const original = `Synthetic metadata ${Date.now()}`;
  const renamed = `${original} renamed`;
  const description = "Updated synthetic collection description";
  await page.locator("#analytics-collection-name").fill(original);
  const share = page.getByRole("checkbox");
  if (await share.count()) await share.first().uncheck();
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText(original, { exact: true }).click();
  const bookmarked = page.url();
  const header = page.locator('[data-list-page="collections"] > header');
  await expect(
    header.getByRole("heading", { name: original, exact: true }),
  ).toBeVisible();
  await header.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Edit collection", exact: true })
    .click();
  await page.locator("#analytics-edit-collection-name").fill(renamed);
  await page
    .locator("#analytics-edit-collection-description")
    .fill(description);
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .soft(header.getByRole("heading", { name: renamed, exact: true }))
    .toBeVisible();
  await expect
    .soft(header.getByText(description, { exact: true }))
    .toBeVisible();
  await page.goto(bookmarked);
  await expect(
    header.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect
    .soft(header.getByRole("heading", { name: renamed, exact: true }))
    .toBeVisible();
  await expect(header.getByText(description, { exact: true })).toBeVisible();
  await header.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Edit collection", exact: true })
    .click();
  await expect(page.locator("#analytics-edit-collection-name")).toHaveValue(
    renamed,
  );
  await expect(
    page.locator("#analytics-edit-collection-description"),
  ).toHaveValue(description);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.screenshot({ path: test.info().outputPath("metadata-saved.png") });
});
