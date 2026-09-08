import { expect, test } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  indexHtml,
  layerRow,
  node,
  openEditor,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("reparenting and reordering", () => {
  test("dragging an element into a container nests it", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const box = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    const nested = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(nested, "dropping Box A onto Container did not reparent it").toBe(
      true,
    );
  });

  test("dragging within an auto-layout row reorders it", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const first = (await node(page, "chip-1").boundingBox())!;
    const third = (await node(page, "chip-3").boundingBox())!;
    // Select on the canvas, not via the tree: the bridge owns drag state and
    // a Layers-panel selection does not arm it.
    await page.mouse.click(
      first.x + first.width / 2,
      first.y + first.height / 2,
    );
    await page.waitForTimeout(1200); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    await page.mouse.move(
      first.x + first.width / 2,
      first.y + first.height / 2,
    );
    await page.mouse.down();
    // A short first move starts the native drag; jumping straight to the
    // target never leaves the source and no reorder is ever computed.
    await page.mouse.move(
      first.x + first.width / 2 + 12,
      first.y + first.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      third.x + third.width - 4,
      third.y + third.height / 2,
      {
        steps: 24,
      },
    );
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    const html = await indexHtml(page, id);
    expect(
      html.indexOf("chip-1"),
      "dragging Chip 1 past Chip 3 did not reorder the auto-layout row",
    ).toBeGreaterThan(html.indexOf("chip-3"));
  });

  test("dragging a layer row onto a container row reparents it", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await layerRow(page, "Box A").dragTo(layerRow(page, "Container"));
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    const nested = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(
      nested,
      "dragging the layer row onto Container did not reparent",
    ).toBe(true);
  });
});
