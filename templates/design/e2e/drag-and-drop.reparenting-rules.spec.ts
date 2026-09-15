import { expect, test, type Page } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  node,
  openEditor,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("reparenting rules", () => {
  test("an object smaller than a frame becomes its child when dropped in", async ({
    page,
  }) => {
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
    expect(
      nested,
      'Figma: "If an object is smaller than a frame, we will make it a child of the frame."',
    ).toBe(true);
  });

  test("holding Space while dragging keeps the object in its current parent", async ({
    page,
  }) => {
    const inRow = (target: Page) =>
      target
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const row = document.querySelector(
            '[data-agent-native-node-id="row"]',
          );
          const chip = document.querySelector(
            '[data-agent-native-node-id="chip-1"]',
          );
          return !!row && !!chip && row.contains(chip);
        });

    // The control drag mutates the document, so the Space drag needs its own
    // pristine design rather than the one the control already reparented.
    const controlId = await newDesign(page);
    await openEditor(page, controlId);
    await selectViaTree(page, "Chip 1");
    let chip = (await node(page, "chip-1").boundingBox())!;
    let outside = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 18 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2200); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    test.skip(
      await inRow(page),
      "an unmodified drag does not reparent either, so the Space modifier is untestable",
    );

    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Chip 1");
    chip = (await node(page, "chip-1").boundingBox())!;
    outside = (await node(page, "frame-a").boundingBox())!;

    // The retain-parent flag is set by a keydown listener on the IFRAME
    // document; page.keyboard sends to the host, where it only pans.
    const previewBody = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body");
    const spaceKey = (type: "keydown" | "keyup") =>
      previewBody.evaluate((_b, t) => {
        document.dispatchEvent(
          new KeyboardEvent(t, {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
          }),
        );
      }, type);

    await spaceKey("keydown");
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await spaceKey("keyup");
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    expect(
      await inRow(page),
      "Figma: \"When moving an object out of a frame's bounds, hold the Space bar to keep " +
        'an object within the current parent."',
    ).toBe(true);
  });
});
