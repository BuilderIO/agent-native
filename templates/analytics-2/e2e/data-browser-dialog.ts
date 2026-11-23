import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkNotebookDataBrowserDialog(page: Page, base: string) {
  await withProject(page, base, async () => {
    const rail = page.getByRole("navigation", { name: "Workspace tools" });
    const panel = page.getByRole("complementary", { name: "Data browser" });
    await rail.getByRole("button", { name: "Data browser" }).click();
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Data browser" }),
    ).toHaveCount(0); // oracle-change: the browser opens as a non-modal side panel
    await expect(panel).toHaveClass(/\bnb-side-panel\b/); // oracle-change: the current surface is the notebook side panel
    const panelBox = await panel.boundingBox();
    const notebookBox = await page.locator(".nb-main-scroll").boundingBox();
    if (!panelBox || !notebookBox)
      throw new Error("The data browser panel or notebook has no box");
    expect(panelBox.width).toBeGreaterThan(0); // oracle-change: side panel sizing replaces modal viewport sizing
    expect(panelBox.height).toBeGreaterThan(0); // oracle-change: side panel sizing replaces modal viewport sizing
    expect(notebookBox.x).toBeGreaterThanOrEqual(
      panelBox.x + panelBox.width - 1,
    ); // oracle-change: side panel occupies space beside the notebook

    await panel
      .getByRole("combobox", { name: "Data connection" })
      .selectOption("builtin-sample-data");
    const tree = panel.getByRole("navigation", { name: "Datasets" });
    const schemaRow = tree.getByRole("button", { name: /^PUBLIC/ });
    await schemaRow.click();
    await expect(schemaRow).toHaveAttribute("aria-expanded", "true");
    const tableRow = tree.getByRole("button", { name: /^customers/ });
    await tableRow.click();

    const preview = panel.getByRole("tabpanel");
    await expect(
      preview.getByRole("columnheader", { name: "customer_id" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(preview.locator("tbody tr")).toHaveCount(12);
    await expect(tree).toBeHidden(); // oracle-change: the table preview replaces the dataset tree until Go back
    await panel.getByRole("button", { name: "Go back" }).click();
    await expect(tree).toBeVisible();
    await expect(schemaRow).toHaveAttribute("aria-expanded", "true");
    await expect(tableRow).toBeVisible(); // oracle-change: Go back clears the selected table

    await schemaRow.click();
    await expect(schemaRow).toHaveAttribute("aria-expanded", "false");
    const search = panel.getByRole("searchbox", { name: "Search tables" });
    await search.fill("PUBLIC");
    await expect(tree.getByRole("button", { name: /^PUBLIC/ })).toBeVisible();
    await tree.getByRole("button", { name: /^PUBLIC/ }).click();
    await expect(search).toHaveValue("");
    await expect(
      tree.getByRole("button", { name: /^customers/ }),
    ).toBeVisible();

    await page.screenshot({
      path: ".tmp/analytics-owner/data-browser-final-local.png",
    });
    await panel.getByRole("button", { name: "Close Data browser" }).click();
    await expect(panel).toHaveCount(0);
  });
}
