import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkHistorySaveVersionKeyboard(
  page: Page,
  base: string,
) {
  await withProject(page, base, async () => {
    await page
      .getByRole("button", { name: "History & versions", exact: true })
      .click();
    const history = page.getByRole("complementary", {
      name: "History & versions",
    });
    await expect(history).toBeVisible();

    await page.locator("body").click({ position: { x: 900, y: 700 } });
    await page.keyboard.press("Control+s");
    const dialog = page.getByRole("dialog", { name: "Save a version" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name of version (required)")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save version" }),
    ).toBeDisabled();
    await dialog.getByRole("textbox").fill("QA2 keyboard 😀");
    await dialog.getByRole("textbox").press("Enter");
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    const entry = history.getByText(/saved a version/);
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("(QA2 keyboard 😀)");
    await expect(history.getByText(/secs? ago/).first()).toBeVisible();

    await history.getByRole("button", { name: "Compare to draft" }).click();
    const compare = page.getByRole("dialog", { name: "Compare version" });
    await expect(compare).toBeVisible();
    await expect(compare).toContainText(/ago QA2 keyboard/);
    await page.keyboard.press("Escape");
    await expect(compare).not.toBeVisible();
  });
}
