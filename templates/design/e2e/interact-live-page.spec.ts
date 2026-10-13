import { expect, test } from "@playwright/test";

import { centerOf, enterInteract } from "./interact-helpers";

// Interact is the page running, not a picture of it: the editor adds nothing
// above the frame and takes no wheel, pinch, drag or key from it.

// oracle: none — drives the real pointer, wheel and keyboard against the running page.
test("the Interact preview is a live page: it hovers, clicks, scrolls and takes Space", async ({
  page,
}) => {
  const { frame, inner } = await enterInteract(page);
  const go = inner.locator("#go");
  const point = centerOf((await go.boundingBox())!);

  await page.mouse.move(point.x, point.y);
  await expect(go).toHaveCSS("background-color", "rgb(239, 68, 68)");

  await page.mouse.click(point.x, point.y);
  await expect(inner.locator("#out")).toHaveText("clicked");

  // Space presses a focused button, as it does in any page.
  await inner.locator("#space").focus();
  await page.keyboard.press("Space");
  await expect(inner.locator("#out2")).toHaveText("activated");

  const frameBox = (await frame.boundingBox())!;
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + 200);
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => inner.locator("html").evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});
