import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkPublishDialogOpenState(page: Page, base: string) {
  await withProject(page, base, async () => {
    await page
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Publish app" });
    await expect(dialog.getByLabel("Version details")).toBeFocused();
    await expect(page).toHaveURL(/[?&]dialog=publish(&|$)/);
    await expect(
      dialog.getByRole("button", { name: "Request review", exact: true }),
    ).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("dialog", { name: "Publish app" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/dialog=publish/);
  });
}
