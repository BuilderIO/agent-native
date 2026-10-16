import { expect, test, type Locator } from "@playwright/test";

import { enterInteract } from "./interact-helpers";

const cornerOf = (element: Locator) =>
  element.evaluate((node) => {
    const style = getComputedStyle(node);
    return { radius: style.borderTopLeftRadius, overflow: style.overflow };
  });

// oracle: none — the frame's computed corner at each device is the assertion.
test("the Interact frame is rounded for its device and clips the page to it", async ({
  page,
}) => {
  await enterInteract(page);
  const card = page.locator(
    '[data-screen-interact-mode="true"] [data-screen-card]',
  );
  const radius = async () => (await cornerOf(card)).radius;
  const device = page.locator(
    "[data-design-top-bar] [data-design-interact-device]",
  );
  const pick = async (name: RegExp) => {
    await device.click();
    await page.getByRole("option", { name }).click();
  };

  // A screen that matches no preset reads by its width: a desktop's slight corner.
  await expect.poll(radius).toBe("12px");

  await pick(/iPad Pro 11" Portrait/);
  await expect.poll(radius).toBe("24px");

  await pick(/iPhone 17\b(?! P)/);
  await expect.poll(radius).toBe("32px");

  // The page is cut to that corner, not painted over it.
  expect(await cornerOf(card.locator("[data-screen-content]"))).toEqual({
    radius: "32px",
    overflow: "clip",
  });
});
