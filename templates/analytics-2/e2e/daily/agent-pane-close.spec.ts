import { expect, test, uniqueName } from "./fixtures";
import { seedNotebook } from "./notebook.helpers";

test("report M5-MOBILE-B2: close the notebook Agent pane on a phone and reload", async ({
  daily,
}) => {
  const page = daily.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const notebook = await seedNotebook(
    daily,
    [{ kind: "sql", text: "select 1 as n" }],
    uniqueName("Phone pane"),
  );
  try {
    await daily.open(`/project/${notebook.id}/latest/logic`);
    const pane = page.getByRole("complementary", {
      name: "Agent",
      exact: true,
    });
    await expect(pane).toBeVisible();
    await page
      .getByRole("button", { name: "Close agent", exact: true })
      .click();
    await expect(pane).toHaveCount(0);
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(1);
    await daily.reload();
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(1);
    await expect(pane).toHaveCount(0);
    await page.screenshot({
      path: ".tmp/analytics-owner/turn-0047/mobile-closed.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Agent", exact: true }).click();
    await expect(pane).toBeVisible();
    await expect(page.locator(".nb-main-card")).toBeHidden();
    await page.getByRole("tab", { name: "Notebook", exact: true }).click();
    await expect(page.locator(".nb-main-card")).toBeVisible();
    await expect(pane).toBeVisible();
    await daily.check();
  } finally {
    await daily.cleanupProject(notebook.id);
  }
});
