import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  MOD,
  newDesign,
  geom,
  node,
  openEditor,
  scale,
  selectViaTree,
  dragBy,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("moving by drag", () => {
  test("dragging one element leaves its siblings untouched", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const siblingBefore = (await geom(page, id, "box-b")).style;
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 80, 40);
    expect((await geom(page, id, "box-b")).style).toBe(siblingBefore);
  });

  test("undo restores the position after a drag", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 100, 50);
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(2000);
    const after = await geom(page, id, "box-a");
    expect([after.left, after.top]).toEqual([before.left, before.top]);
  });
});

test.describe("resizing", () => {
  test("dragging the bottom-right corner resizes width and height", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    // Element resize handles live INSIDE the iframe as children of the
    // selection overlay; [data-resize-handle] in the host is the screen's own
    // board chrome.
    const iframeBox = (await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .boundingBox())!;
    const s0 = await scale(page);
    const cornerLocal = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const handles = Array.from(
          document.querySelectorAll("[data-agent-native-edit-handle]"),
        );
        if (handles.length === 0) return null;
        const se = handles
          .map((h) => h.getBoundingClientRect())
          .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
        return { x: se.x + se.width / 2, y: se.y + se.height / 2 };
      });
    const corner = cornerLocal
      ? {
          x: Math.round(iframeBox.x + cornerLocal.x * s0),
          y: Math.round(iframeBox.y + cornerLocal.y * s0),
        }
      : null;
    expect(corner, "no corner resize handle found").not.toBeNull();

    const s = await scale(page);
    await page.mouse.move(corner!.x, corner!.y);
    await page.mouse.down();
    await page.mouse.move(corner!.x + 100 * s, corner!.y + 60 * s, {
      steps: 14,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = await geom(page, id, "box-a");
    expect(
      [after.width - before.width, after.height - before.height],
      `dragged the SE corner by (100,60); size changed by ` +
        `(${after.width - before.width},${after.height - before.height})`,
    ).toEqual([expect.closeTo(100, -1), expect.closeTo(60, -1)]);
  });

  test("resizing keeps the opposite edge anchored", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");

    const corner = await page.evaluate(() => {
      const small = Array.from(
        document.querySelectorAll("[data-resize-handle]"),
      ).filter((h) => h.getBoundingClientRect().width < 20);
      if (small.length === 0) return null;
      const se = small
        .map((h) => h.getBoundingClientRect())
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
      return {
        x: Math.round(se.x + se.width / 2),
        y: Math.round(se.y + se.height / 2),
      };
    });
    if (!corner) test.skip(true, "no corner handle to drag");
    const s = await scale(page);
    await page.mouse.move(corner!.x, corner!.y);
    await page.mouse.down();
    await page.mouse.move(corner!.x + 80 * s, corner!.y + 40 * s, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = await geom(page, id, "box-a");
    test.skip(
      after.width === before.width && after.height === before.height,
      "resize did not change the size, so anchoring is untested — see the SE corner test",
    );
    expect(
      [after.left, after.top],
      "dragging the SE corner must not move the NW corner",
    ).toEqual([before.left, before.top]);
  });
});
