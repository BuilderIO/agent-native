import { expect, type Locator, type Page } from "@playwright/test";

import enUS from "../../i18n/en-US";

export async function checkResultMenuHandoff(page: Page, cell: Locator) {
  const name = cell
    .getByRole("columnheader")
    .filter({ hasText: "order_id" })
    .getByRole("button");
  const number = cell
    .getByRole("columnheader")
    .filter({ hasText: "order_total" })
    .getByRole("button");
  const descending = page.getByRole("menuitem", {
    name: enUS.notebook.sortStringDesc,
    exact: true,
  });
  const firstValue = cell
    .locator(".nb-table tbody tr")
    .first()
    .locator("td")
    .first();

  await number.click();
  await page.keyboard.press("Escape");
  await name.click();
  await expect(descending).toBeVisible({ timeout: 400 });
  await descending.click();
  await expect(firstValue).toHaveText("ord_0010");
  await name.click();
  await expect(descending).toBeVisible({ timeout: 400 });
  await descending.click();
  await expect(firstValue).toHaveText("ord_0001");
  await name.click();
  await expect(descending).toBeVisible({ timeout: 400 });
  await cell.locator(".nb-table tbody tr").last().locator("td").last().click();
  await expect(descending).toBeHidden();
  console.log("PASS report B-RESULT-MENU-HANDOFF");
}
