import { expect, test } from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const COMMENT_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <section data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="width:480px;padding:24px;background:#eef2f7">
    <button data-agent-native-node-id="deep-button" data-agent-native-layer-name="Deep button" style="width:200px;height:48px">Deep Layer Button</button>
  </section>
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

  const button = await app.designRect("deep-button");
  const buttonPoint = await app.pagePoint(
    button.x + button.width / 2,
    button.y + button.height / 2,
  );
  const highlight = page.locator("[data-review-hover-highlight]");
  await page.mouse.move(buttonPoint.x, buttonPoint.y);
  await expect(highlight).toHaveCount(1);
  expect(await app.selectedLayers()).toEqual([]);

  await page.mouse.click(buttonPoint.x, buttonPoint.y);
  const composer = page.locator('textarea[placeholder="Leave feedback…"]');
  await expect(composer).toBeVisible();
  // The highlight stays on the element while its composer is open, including when the pointer moves onto it.
  const popover = page.locator("[data-review-popover]").last();
  const popoverBox = (await popover.boundingBox())!;
  await page.mouse.move(
    popoverBox.x + popoverBox.width / 2,
    popoverBox.y + popoverBox.height / 2,
  );
  await expect(highlight).toHaveCount(1);
  await page.mouse.click(
    popoverBox.x + popoverBox.width / 2,
    popoverBox.y + popoverBox.height / 2,
  );
  expect(await app.selectedLayers()).toEqual([]);
});
