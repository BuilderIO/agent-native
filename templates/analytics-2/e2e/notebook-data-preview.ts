import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

// report A2-NOTEBOOK-DATA-TABLE-DEAD
export async function checkNotebookTablePreview(page: Page, base: string) {
  await withProject(page, base, async () => {
    const rail = page.getByRole("navigation", { name: "Workspace tools" });
    const panel = page.getByRole("complementary", { name: "Data browser" });
    const open = async () => {
      await rail.getByRole("button", { name: "Data browser" }).click();
      await expect(panel).toBeVisible();
      await panel
        .getByRole("combobox", { name: "Data connection" })
        .selectOption("builtin-sample-data");
      await panel.getByRole("button", { name: /^PUBLIC/ }).click();
      await panel.getByRole("button", { name: /^customers/ }).click();
      const table = panel.getByRole("tabpanel");
      await expect(
        table.getByRole("columnheader", { name: "customer_id" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(table.locator("tbody tr")).toHaveCount(12);
      await expect(
        table.locator("tbody tr").first().locator("td").first(),
      ).toHaveText("cus_001");
    };
    await open();
    await panel.getByRole("button", { name: "Close Data browser" }).click();
    await expect(panel).toHaveCount(0);
    await open();
  });
}
