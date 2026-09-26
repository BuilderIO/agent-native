import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  geom,
  node,
  openEditor,
  chromeBounds,
  selectViaTree,
  dragBy,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("selection chrome", () => {
  test("dragging a layer-row selection moves the layer, not the screen", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const cardBefore = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;
    const before = await geom(page, id, "box-a");
    await dragBy(page, (await node(page, "box-a").boundingBox())!, 120, 60);
    const after = await geom(page, id, "box-a");
    const cardAfter = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;
    expect(
      [after.left - before.left > 60, after.top - before.top > 30],
      `the layer did not move: (${before.left},${before.top}) → (${after.left},${after.top})`,
    ).toEqual([true, true]);
    expect(
      [Math.round(cardAfter.x), Math.round(cardAfter.y)],
      "the screen frame moved with the drag",
    ).toEqual([Math.round(cardBefore.x), Math.round(cardBefore.y)]);
  });

  test("selecting a different element moves the chrome to it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const first = await chromeBounds(page);
    await selectViaTree(page, "Box B");
    const second = await chromeBounds(page);
    expect(
      second,
      `chrome stayed at the same rect after selecting a different layer`,
    ).not.toEqual(first);
  });

  test("hovering an element outlines that element", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const target = await node(page, "box-a").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const onScreen = (await node(page, "box-a").boundingBox())!;
    await page.mouse.move(
      onScreen.x + onScreen.width / 2,
      onScreen.y + onScreen.height / 2,
    );
    await page.waitForTimeout(1200); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    // The hover indicator is painted inside the iframe, not the host document.
    const highlight = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const el = document.querySelector(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
    expect(
      highlight,
      "hovering an element painted no highlight overlay",
    ).not.toBeNull();
    expect(
      [highlight!.w, highlight!.h],
      `hovering a ${Math.round(target.width)}x${Math.round(target.height)} box ` +
        `highlighted ${highlight!.w}x${highlight!.h}`,
    ).toEqual([
      expect.closeTo(target.width, -1),
      expect.closeTo(target.height, -1),
    ]);
  });
});
