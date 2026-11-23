import { expect, type Page } from "@playwright/test";

const LONG_TITLE_FILTER = "x".repeat(250);
const LONG_SEARCH_QUERY = "a".repeat(600);

export async function checkFilterLimits(page: Page, base: string) {
  await page.goto(`${base}/home/all`, { waitUntil: "domcontentloaded" });
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.click();
  await page.getByLabel("Title", { exact: true }).fill(LONG_TITLE_FILTER);
  await expect(page.getByText("No projects match that filter")).toBeVisible();
  await expect(page.getByText("Error loading projects")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");

  await page.goto(`${base}/home/search?q=${LONG_SEARCH_QUERY}`, {
    waitUntil: "domcontentloaded",
  });
  const dialog = page.getByRole("dialog", { name: "Search your workspace" });
  await expect(dialog.getByText("No results found")).toBeVisible();
  await expect(dialog.getByText("Something went wrong")).toHaveCount(0);

  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByRole("button", { name: /^Date/ }).click();
  await dialog.locator('[data-rid^="search.date.day."]').first().click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".ws-calendar")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}
