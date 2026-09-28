import { expect, test } from "@playwright/test";

import {
  geom,
  newDesign,
  node,
  openEditor,
  postAction,
  selectViaTree,
  scale,
  setBaseURL,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

for (const focus of ["host", "iframe"] as const) {
  test(`Escape after releasing a move keeps the committed position with ${focus} focus`, async ({
    page,
  }, testInfo) => {
    setBaseURL(testInfo);
    const designId = await newDesign(page);
    try {
      await openEditor(page, designId);
      await selectViaTree(page, "Box A");
      if (focus === "iframe") {
        await page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .focus();
        await expect
          .poll(() => page.evaluate(() => document.activeElement?.tagName))
          .toBe("IFRAME");
      }
      const before = await geom(page, designId, "box-a");
      const bounds = await node(page, "box-a").boundingBox();
      if (!bounds) throw new Error("Box A has no rendered bounds");
      const zoom = await scale(page);
      const start = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 120 * zoom, start.y + 60 * zoom, {
        steps: 16,
      });
      await expect
        .poll(async () => {
          const moved = await node(page, "box-a").boundingBox();
          if (!moved) throw new Error("Box A lost its rendered bounds");
          return Math.hypot(moved.x - bounds.x, moved.y - bounds.y);
        })
        .toBeGreaterThan(10);
      // e2e-harness-ignore let the host observe the held drag before release
      await page.waitForTimeout(350);
      await page.mouse.up();
      await page.keyboard.press("Escape");
      await expect
        .poll(async () => {
          const after = await geom(page, designId, "box-a");
          return Math.hypot(after.left - before.left, after.top - before.top);
        })
        .toBeGreaterThan(20);
      const moved = await geom(page, designId, "box-a");
      await page.reload();
      await expect
        .poll(async () => {
          const after = await geom(page, designId, "box-a");
          return [after.left, after.top];
        })
        .toEqual([moved.left, moved.top]);
    } finally {
      await postAction(page, "delete-design", { id: designId });
    }
  });
}
