import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkInputMenu(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    const button = page
      .getByRole("button", { name: "Inputs", exact: true })
      .last();
    // The modal menu hides the trigger from the accessibility tree.
    const buttonBox = await button.boundingBox();
    await button.click();
    const menu = page.getByRole("menu", { name: "Inputs" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Checkbox",
      "Date",
      "Dropdown",
      "Multiselect",
      "Number input",
      "Slider",
      "Text input",
    ]);
    const menuBox = await menu.boundingBox();
    if (!buttonBox || !menuBox)
      throw new Error("Input button or menu has no geometry");
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(buttonBox.y + 1);
    expect(
      Math.abs(
        menuBox.x + menuBox.width / 2 - (buttonBox.x + buttonBox.width / 2),
      ),
    ).toBeLessThanOrEqual(2);
    await mkdir(resolve(".tmp/analytics-owner"), { recursive: true });
    await page.screenshot({
      path: ".tmp/analytics-owner/input-menu-local.png",
    });
    await menu
      .getByRole("menuitem", { name: "Text input", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).cells.map((cell) => cell.contents))
      .toMatchObject([{ kind: "input", inputType: "TEXT_INPUT" }]);
    const cell = page.locator("[data-notebook-cell]").first();
    await expect(cell).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(1);
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ kind: "input", inputType: "TEXT_INPUT" });
    await expect(
      page
        .locator("[data-notebook-cell]")
        .first()
        .locator('input[type="text"]'),
    ).toBeVisible();
  });
}
