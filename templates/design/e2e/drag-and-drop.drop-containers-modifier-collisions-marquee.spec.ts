import { expect, test, type Page } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  indexHtml,
  node,
  openEditor,
  scale,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("drop containers", () => {
  const dropFixture = (
    primitive: string,
  ) => `<!doctype html><html><head><meta charset="utf-8"><title>Drop</title></head>
<body style="margin:0;min-height:900px;background:#0f1115">
<div data-agent-native-node-id="mover" data-agent-native-layer-name="Mover"
     style="position:absolute;left:20px;top:300px;width:100px;height:60px;background:#a855f7"></div>
<div data-agent-native-node-id="target" data-agent-native-layer-name="Target" data-an-primitive="${primitive}"
     style="position:absolute;left:170px;top:300px;width:120px;height:120px;background:#ec4899"></div>
</body></html>`;

  const dragMoverOntoTarget = async (page: Page, primitive: string) => {
    const id = await newDesign(page, dropFixture(primitive));
    await openEditor(page, id);
    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const mover = (await preview
      .locator('[data-agent-native-node-id="mover"]')
      .boundingBox())!;
    const target = (await preview
      .locator('[data-agent-native-node-id="target"]')
      .boundingBox())!;
    await page.mouse.move(
      mover.x + mover.width / 2,
      mover.y + mover.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      mover.x + mover.width / 2 + 10,
      mover.y + mover.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    return preview
      .locator("body")
      .evaluate(
        () =>
          document
            .querySelector('[data-agent-native-node-id="mover"]')
            ?.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
      );
  };

  test("a frame adopts an element dragged into it", async ({ page }) => {
    expect(
      await dragMoverOntoTarget(page, "frame"),
      "frames are the container primitive and must adopt a dropped element",
    ).toBe("target");
  });

  // A canvas rectangle IS a drop target, but a free-placement one: the bridge
  // calls it an "absolute-primitive-container" and returns dropMode
  // "absolute-container" so onUp skips the auto-layout conversion. The Figma
  // parity worth asserting is therefore "adopts without becoming a layout
  // parent", not "never adopts".
  test("a rectangle adopts as a free-placement container, not a layout parent", async ({
    page,
  }) => {
    expect(
      await dragMoverOntoTarget(page, "rectangle"),
      "editor-chrome.bridge.ts treats a canvas rectangle as an " +
        "absolute-primitive-container, so the drop re-parents into it",
    ).toBe("target");

    const placement = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const read = (id: string) => {
          const el = document.querySelector<HTMLElement>(
            `[data-agent-native-node-id="${id}"]`,
          );
          return el ? window.getComputedStyle(el) : null;
        };
        return {
          moverPosition: read("mover")?.position ?? null,
          targetDisplay: read("target")?.display ?? null,
        };
      });

    expect(
      placement.moverPosition,
      "a rectangle is a vector shape, so adopting must keep the dropped " +
        "element absolutely placed rather than converting to flow",
    ).toBe("absolute");
    expect(
      placement.targetDisplay,
      "the rectangle must not become an auto-layout parent",
    ).not.toBe("flex");
  });
});

test.describe("modifier collisions", () => {
  /** Synthetic input under-travels (the first move starts the drag and rAF
   *  coalesces the rest), so compare the two drags rather than absolutes. */
  const dragUp = async (page: Page, withModifier: boolean) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    await page.waitForTimeout(1200); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    const read = async () =>
      Number(
        /box-a"[\s\S]{0,200}?top:\s*(-?\d+(?:\.\d+)?)px/.exec(
          await indexHtml(page, id),
        )?.[1] ?? NaN,
      );
    const before = await read();
    const box = (await node(page, "box-a").boundingBox())!;
    const s = box.height / 80;
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    if (withModifier) await page.keyboard.down(mod);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2 - 100 * s,
      {
        steps: 40,
      },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();
    if (withModifier) await page.keyboard.up(mod);
    await page.waitForTimeout(2200); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    return before - (await read());
  };

  test("the primary modifier does not hijack a drag", async ({ page }) => {
    const plain = await dragUp(page, false);
    const modified = await dragUp(page, true);
    expect(
      plain,
      `an unmodified 100px drag should travel most of the way; moved ${plain}`,
    ).toBeGreaterThan(85);
    expect(
      Math.abs(plain - modified),
      `the primary modifier is Figma's snap bypass, not a selection change — ` +
        `plain drag moved ${plain}, modified moved ${modified}. A large gap ` +
        `means the chord (additive-select / deep-select) consumed the gesture.`,
    ).toBeLessThanOrEqual(8);
  });
});

test.describe("marquee", () => {
  test("dragging from empty canvas marquee-selects the elements it covers", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    // Starting outside the screen marquees the BOARD (screens), not the
    // elements — the drag has to begin on empty space inside the screen.
    const a = (await node(page, "box-a").boundingBox())!;
    const scale = a.width / 120;
    const originX = a.x - 30 * scale;
    const originY = a.y - 280 * scale;
    const at = (sx: number, sy: number) => ({
      x: originX + sx * scale,
      y: originY + sy * scale,
    });
    const from = at(180, 240);
    const to = at(15, 545);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(1800); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      "a marquee across Box A and Box B should select both",
    ).toHaveCount(2);
  });
});
