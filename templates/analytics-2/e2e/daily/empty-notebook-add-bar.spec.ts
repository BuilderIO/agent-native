import { expect, test, uniqueName } from "./fixtures";
import { seedNotebook } from "./notebook.helpers";

test("expected behavior: the add-cell bar of an empty notebook is on screen without scrolling", async ({
  daily,
}) => {
  const page = daily.page;
  const notebook = await seedNotebook(daily, [], uniqueName("Empty bar"));
  try {
    for (const size of [
      { width: 1300, height: 900 },
      { width: 1300, height: 700 },
      { width: 600, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await daily.open(`/project/${notebook.id}/latest/logic`);
      const bar = page.locator(".nb-add-wrap");
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    }
    await daily.check();
  } finally {
    await daily.cleanupProject(notebook.id);
  }
});
