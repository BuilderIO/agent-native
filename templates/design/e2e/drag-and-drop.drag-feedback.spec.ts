import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  toolbar,
  layerRow,
  node,
  openEditor,
  activeOverlays,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("drag feedback", () => {
  test("snap guides appear when an edge aligns with a sibling", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const a = (await node(page, "box-a").boundingBox())!;
    const b = (await node(page, "box-b").boundingBox())!;

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, b.y - a.height, { steps: 18 });
    await page.waitForTimeout(900);
    const guides = (await activeOverlays(page)).filter((k) =>
      /snap-guide|measurement|transform-badge/.test(k),
    ).length;
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect(
      guides,
      `Figma: "when using snap to settings ... a red guide appears on the canvas as a visual ` +
        `indicator", and snap-to-objects "aligns the centers and outermost points of ` +
        `different objects". No guide appeared.`,
    ).toBeGreaterThan(0);
  });

  test("a container highlights as a drop target while dragging over it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const a = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 18 },
    );
    await page.waitForTimeout(900);
    const highlights = (await activeOverlays(page)).filter((k) =>
      /insertion-guide|drop/.test(k),
    ).length;
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect(
      highlights,
      `UNVERIFIED for a plain frame: Figma documents a blue indicator only for auto layout ` +
        `containers, and says nothing about highlighting a plain frame. Treat as a usability ` +
        `claim. No feedback of any kind appeared.`,
    ).toBeGreaterThan(0);
  });

  test("the layers panel shows an insertion line while dragging a row", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const src = (await layerRow(page, "Box A").boundingBox())!;
    const dst = (await layerRow(page, "Box B").boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    // A short first move starts the native drag; jumping straight to the
    // target never leaves the source row and no dragover fires.
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 8, {
      steps: 4,
    });
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height - 3, {
      steps: 14,
    });
    await page.waitForTimeout(600);
    const indicators = await page
      .locator("[data-layer-drop-indicator]")
      .count();
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(
      indicators,
      "Figma shows an insertion line while reordering layers",
    ).toBeGreaterThan(0);
  });

  test("the cursor differs between the Move and Hand tools", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const read = () =>
      page.evaluate(() => {
        const world = document.querySelector(
          "[data-multi-screen-canvas-world]",
        );
        const surface = world?.parentElement ?? null;
        return surface ? getComputedStyle(surface).cursor : null;
      });
    const move = await read();
    await toolbar(page).locator('button[aria-label="Move options"]').click();
    await page.getByRole("menuitem", { name: /Hand/i }).first().click();
    await page.waitForTimeout(1200);
    const hand = await read();
    expect(hand, `Move and Hand both show cursor "${move}"`).not.toBe(move);
  });
});
