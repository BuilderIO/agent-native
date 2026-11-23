import { expect, test } from "@playwright/test";

import { AUTH_DISABLED, E2E_BASE_URL } from "./e2e-env";
const BASE = E2E_BASE_URL;
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname) ||
  process.env.DATABASE_URL !== "pglite:memory" ||
  !AUTH_DISABLED
)
  throw new Error(
    "Delete checks require local isolated memory storage and development authentication.",
  );
test("deleting an open empty collection returns to its list and reads back absence", async ({
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
  const name = `Synthetic delete ${Date.now()}`;
  await page.locator("#analytics-collection-name").fill(name);
  const share = page.getByRole("checkbox");
  if (await share.count()) await share.first().uncheck();
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText(name, { exact: true }).click();
  const header = page.locator('[data-list-page="collections"] > header');
  await expect(
    header.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  const collectionUrl = page.url();
  await header.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Delete collection", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page).toHaveURL(collectionUrl);
  await expect(
    header.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await header.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Delete collection", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete collection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(`${BASE}/collections`);
  await expect(
    page.getByRole("heading", { name: "Collections", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Collections", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});
