import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkProjectHeaderMenu(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await page
      .getByRole("button", { name: "Project options", exact: true })
      .click();
    const menu = page.getByRole("menu", {
      name: "Project options",
      exact: true,
    });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Rename",
      "Favorite this project",
      "Duplicate",
      "Export as",
      "Clear outputs",
      "Transfer project owner",
      "Add to collection",
      "Move to...",
      "Archive",
      "Move to trash",
      "New project",
    ]);
    const exportItem = menu.getByRole("menuitem", {
      name: "Export as",
      exact: true,
    });
    await expect(exportItem).toHaveAttribute("aria-haspopup", "menu");
    await expect(
      page.getByRole("menuitem", {
        name: "Analytics project (.yaml)",
        exact: true,
      }),
    ).toHaveCount(0);
    await exportItem.focus();
    await page.keyboard.press("ArrowRight");
    const exports = page.getByRole("menu", { name: "Export as", exact: true });
    await expect(exports.getByRole("menuitem")).toHaveText([
      "Analytics project (.yaml)",
      "Jupyter notebook (.ipynb)",
    ]);
    await page.screenshot({ path: ".tmp/analytics-owner/header-menu.png" });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await page
      .getByRole("button", { name: "Project options", exact: true })
      .click();
    await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const title = page.getByRole("textbox", {
      name: "Project title",
      exact: true,
    });
    await expect(title).toBeFocused();
    const renamed = `${(await read()).title} renamed from menu`;
    await title.fill(renamed);
    await title.press("Enter");
    await expect.poll(async () => (await read()).title).toBe(renamed);
    await page.reload({ waitUntil: "domcontentloaded" });
    const headerTitle = page
      .locator(".nb-header")
      .getByRole("button", { name: renamed, exact: true });
    await expect(headerTitle).toBeVisible();
    expect((await read()).title).toBe(renamed);
    await headerTitle.click();
    await expect(title).toBeFocused();
    await title.fill("Should not persist on escape");
    await title.press("Escape");
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toBeFocused();
    expect((await read()).title).toBe(renamed);
    await headerTitle.click();
    await title.fill("   ");
    await title.press("Enter");
    await expect(headerTitle).toBeVisible();
    expect((await read()).title).toBe(renamed);
    const unicodeTitle = `${renamed} 📊 Café`;
    await headerTitle.click();
    await title.fill(unicodeTitle);
    await title.evaluate((el) => (el as HTMLInputElement).blur());
    await expect.poll(async () => (await read()).title).toBe(unicodeTitle);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator(".nb-header").getByRole("button", {
        name: unicodeTitle,
        exact: true,
      }),
    ).toBeVisible();
  });
}
