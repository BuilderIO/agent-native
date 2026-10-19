import { type Locator } from "@playwright/test";

import { expect, test } from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const COMMENT_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <section data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="width:480px;padding:24px;background:#eef2f7">
    <button data-agent-native-node-id="deep-button" data-agent-native-layer-name="Deep button" style="width:200px;height:48px">Deep Layer Button</button>
  </section>
  <p class="plain-copy" style="margin:24px 0 0;font-size:20px">Plain copy</p>
</body></html>`;

test("comment mode keeps pan, hover and popover focus off the design below", async ({
  app,
}) => {
  const page = app.page;
  await app.open(await app.seed(COMMENT_SCREEN));
  await app.zoomToFit();
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Pin comment"]')
    .click();

  const frame = page.locator("iframe").first();
  const surface = (await page
    .locator("[data-multi-screen-canvas-surface]")
    .first()
    .boundingBox())!;
  const frameTopBefore = (await frame.boundingBox())!.y;
  await page.mouse.move(
    surface.x + surface.width * 0.5,
    surface.y + surface.height * 0.92,
  );
  await page.mouse.wheel(0, 200);
  await expect
    .poll(async () => (await frame.boundingBox())!.y)
    .toBeLessThan(frameTopBefore);

  // A middle-button drag starts on the click plane and pans until it is released.
  const dragStartY = (await frame.boundingBox())!.y;
  await page.mouse.move(
    surface.x + surface.width * 0.5,
    surface.y + surface.height * 0.92,
  );
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    surface.x + surface.width * 0.5,
    surface.y + surface.height * 0.92 + 60,
    { steps: 6 },
  );
  await page.mouse.up({ button: "middle" });
  const dragEndY = (await frame.boundingBox())!.y;
  expect(dragEndY).toBeGreaterThan(dragStartY);
  await page.mouse.move(
    surface.x + surface.width * 0.5,
    surface.y + surface.height * 0.92 + 120,
    { steps: 4 },
  );
  expect((await frame.boundingBox())!.y).toBe(dragEndY);

  const liveFrame = page
    .frameLocator("iframe[data-design-preview-iframe]")
    .first();
  const highlight = page.locator("[data-review-hover-highlight]");
  const center = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // The highlight is drawn a frame after the pointer moves, so alignment is polled.
  const highlightAligned = async (target: Locator) => {
    const box = await target.boundingBox();
    const highlightBox = await highlight.boundingBox();
    if (!box || !highlightBox) return false;
    return [
      [highlightBox.x, box.x],
      [highlightBox.y, box.y],
      [highlightBox.width, box.width],
      [highlightBox.height, box.height],
    ].every(([actual, expected]) => Math.abs(actual - expected) < 3);
  };

  const button = liveFrame.locator('[data-agent-native-node-id="deep-button"]');
  const buttonCenter = await center(button);
  await page.mouse.move(buttonCenter.x, buttonCenter.y);
  await expect(highlight).toHaveCount(1);
  await expect.poll(() => highlightAligned(button)).toBe(true);
  expect(await app.selectedLayers()).toEqual([]);

  // Plain copy has no node id, so its hit comes back as a selector with the box the bridge reported.
  const copy = liveFrame.locator(".plain-copy");
  const copyCenter = await center(copy);
  await page.mouse.move(copyCenter.x, copyCenter.y);
  await expect(highlight).toHaveCount(1);
  await expect.poll(() => highlightAligned(copy)).toBe(true);

  await page.mouse.move(buttonCenter.x, buttonCenter.y);
  await expect.poll(() => highlightAligned(button)).toBe(true);
  await page.mouse.click(buttonCenter.x, buttonCenter.y);
  const composer = page.locator('textarea[placeholder="Leave feedback…"]');
  await expect(composer).toBeVisible();
  // The highlight stays on the element while its composer is open, including when the pointer moves onto it.
  const popover = page.locator("[data-review-popover]").last();
  const popoverBox = (await popover.boundingBox())!;
  await page.mouse.move(
    popoverBox.x + popoverBox.width / 2,
    popoverBox.y + popoverBox.height / 2,
  );
  await expect.poll(() => highlightAligned(button)).toBe(true);
  await page.mouse.click(
    popoverBox.x + popoverBox.width / 2,
    popoverBox.y + popoverBox.height / 2,
  );
  expect(await app.selectedLayers()).toEqual([]);
});
