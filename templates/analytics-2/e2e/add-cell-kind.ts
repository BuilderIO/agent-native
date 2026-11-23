import type { Page } from "@playwright/test";

export async function addCellKind(page: Page, name: string) {
  const tile = page.getByRole("button", { name, exact: true }).last();
  if (await tile.isVisible()) {
    await tile.click();
    return;
  }
  if (name === "Markdown" || name === "Text") {
    await page
      .getByRole("button", { name: "Text options", exact: true })
      .last()
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: "More", exact: true }).last().click();
  await page
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem", { name, exact: true })
    .click();
}
