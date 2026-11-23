import { expect, type Page } from "@playwright/test";

export async function checkCollectionDialog(page: Page, base: string) {
  await page.goto(`${base}/home/collections`, { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: "New collection", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  const name = dialog.locator("#analytics-collection-name");
  await expect(name).toBeFocused();
  await name.fill("QA 日本語 🧪");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await expect(name).not.toHaveValue("QA 日本語 🧪");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}
