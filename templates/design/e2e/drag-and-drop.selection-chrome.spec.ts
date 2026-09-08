import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  layersTree,
  node,
  openEditor,
  chromeBounds,
  activeOverlays,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("selection chrome", () => {
  test("handles wrap the selected element, not the screen", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");

    const target = await node(page, "box-a").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const chrome = await chromeBounds(page);
    expect(
      chrome,
      "no selection overlay appeared for a selected element",
    ).not.toBeNull();
    const width = chrome!.right - chrome!.left;
    const height = chrome!.bottom - chrome!.top;
    expect(
      [width, height],
      `Box A is ${Math.round(target.width)}x${Math.round(target.height)} at ` +
        `(${Math.round(target.x)},${Math.round(target.y)}), but the selection handles enclose ` +
        `${width}x${height} at (${chrome!.left},${chrome!.top}) — the whole screen. ` +
        `You cannot grab or resize what you selected.`,
    ).toEqual([
      expect.closeTo(target.width, -1.4),
      expect.closeTo(target.height, -1.4),
    ]);
  });

  test("selecting an element paints a selection overlay", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    expect(await activeOverlays(page)).toContain("selection");
  });

  test("a selected screen still lets you click an element inside it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await page.locator("[data-frame-label]").first().click();
    await page.waitForTimeout(1200); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    const target = (await node(page, "box-a").boundingBox())!;
    await page.mouse.click(
      target.x + target.width / 2,
      target.y + target.height / 2,
    );
    await page.waitForTimeout(1600); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    const selected = await layersTree(page)
      .getByRole("treeitem")
      .filter({ has: page.locator('[aria-selected="true"]') })
      .first()
      .textContent()
      .catch(() => null);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      `clicking into a selected screen selected "${selected}" instead of the element`,
    ).toHaveCount(1);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Box A");
  });

  test("a layer row selection leaves the screen frame unselected", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    expect(
      await page.locator("[data-frame-drag-surface]").count(),
      "the frame's full-bleed drag surface covers the layer you selected, so " +
        "the next drag moves the whole screen instead of the layer",
    ).toBe(0);
  });
});
