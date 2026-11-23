import { mkdir } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

// Reports 1795071219 / 1795071321: a fresh input names its variable on screen
// (the settings open on creation) and that exact name reads in a SQL cell.
export async function checkInputQuery(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await page
      .getByRole("button", { name: "Inputs", exact: true })
      .last()
      .click();
    await page
      .getByRole("menu", { name: "Inputs" })
      .getByRole("menuitem", { name: "Text input", exact: true })
      .click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name, "settings open on creation").toHaveValue("input_1");
    await page.keyboard.press("Escape");
    const cell = page.locator("[data-notebook-cell]").first();
    const value = cell.getByRole("textbox", { name: "Value for Input 1" });
    await value.fill("Brooklyn");
    await value.blur();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ name: "input_1", defaultValueString: "Brooklyn" });
    await page
      .getByRole("button", { name: "Query", exact: true })
      .last()
      .click();
    const query = page.locator("[data-notebook-cell]").last();
    await query.getByRole("button", { name: /^Data connection:/ }).click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    const editor = query.getByRole("textbox", { name: /^Edit SQL/ });
    await editor.fill("SELECT {{ input_1 }} AS picked");
    await editor.press("ControlOrMeta+Enter");
    await expect(query.locator("tbody tr").first().locator("td")).toHaveText(
      ["Brooklyn"],
      { timeout: 30000 },
    );
    // Rename through the settings; the SQL follows the new name.
    await cell.getByRole("button", { name: "Configure cell" }).click();
    await name.fill("selected_borough");
    await name.press("Enter");
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ name: "selected_borough" });
    await editor.fill("SELECT {{ selected_borough }} AS picked");
    await editor.press("ControlOrMeta+Enter");
    await expect(query.locator("tbody tr").first().locator("td")).toHaveText(
      ["Brooklyn"],
      { timeout: 30000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("[data-notebook-cell]")
        .first()
        .getByRole("textbox", { name: /^Value for / }),
    ).toHaveValue("Brooklyn");
    expect((await read()).cells[0]?.contents).toMatchObject({
      name: "selected_borough",
    });
    await expect(
      page
        .locator("[data-notebook-cell]")
        .last()
        .locator("tbody tr")
        .first()
        .locator("td"),
    ).toHaveText(["Brooklyn"]);
    await mkdir(".tmp/analytics-owner", { recursive: true });
    await page.screenshot({
      path: ".tmp/analytics-owner/input-query-local.png",
    });
  });
}
