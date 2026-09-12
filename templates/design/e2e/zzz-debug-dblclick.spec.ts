import { expect, test } from "@playwright/test";
import { createFixtureDesign, gotoEditor, installBridge } from "./helpers";

test("instrument dblclick 3", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.text().includes("[DEBUG]")) console.log("PAGE:", msg.text());
  });
  const id = await createFixtureDesign(page, "Debug dblclick 3");
  await gotoEditor(page, id);
  await installBridge(page);

  const searchButton = page.getByRole("button", { name: "Search layers...", exact: true });
  const searchInput = page.getByPlaceholder("Search layers...");
  if (!(await searchInput.isVisible().catch(() => false))) {
    await searchButton.click();
  }
  await searchInput.fill("Alpha Button");
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator('span[title="Alpha Button"]') })
    .first();
  await expect(row).toBeVisible();

  await row.click({ force: true });
  await page.waitForTimeout(300);
  await row.dblclick({ force: true });
  await page.waitForTimeout(300);

  const input = row.locator("input");
  console.log("input count after locator.dblclick", await input.count());
});
