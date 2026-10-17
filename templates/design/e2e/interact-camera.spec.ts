import { expect, test } from "@playwright/test";

import { enterInteract } from "./interact-helpers";

// oracle: none — the frame's rect before and after each gesture is the assertion.
test("the wheel, a pinch, a middle or Space drag and the zoom keys leave the Interact frame where it is", async ({
  page,
}) => {
  const { frame, inner } = await enterInteract(page);
  const before = (await frame.boundingBox())!;
  const onPage = { x: before.x + before.width / 2, y: before.y + 150 };
  const onMargin = { x: before.x - 80, y: before.y + before.height / 2 };

  const frameIsUnmoved = async (gesture: string) => {
    const after = (await frame.boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(after[key], `${gesture}: ${key}`).toBeCloseTo(before[key], 1);
    }
  };

  for (const at of [onPage, onMargin]) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 240);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await page.keyboard.down("Meta");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Meta");
  }
  await page.waitForTimeout(300);
  await frameIsUnmoved("wheel and pinch");

  for (const at of [onPage, onMargin]) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(at.x + 120, at.y + 90, { steps: 4 });
    await page.mouse.up({ button: "middle" });
  }
  await page.keyboard.down("Space");
  await page.mouse.move(onPage.x, onPage.y);
  await page.mouse.down();
  await page.mouse.move(onPage.x + 120, onPage.y + 90, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await frameIsUnmoved("middle and Space drag");

  await inner.locator("#go").focus();
  for (const chord of [
    "Control+Equal",
    "Control+Minus",
    "Control+Digit0",
    "Meta+Equal",
    "Meta+Minus",
    "Meta+Digit0",
    "Shift+Digit1",
    "Shift+Digit2",
    "Equal",
    "Minus",
  ]) {
    await page.keyboard.press(chord);
  }
  await page.waitForTimeout(300);
  await frameIsUnmoved("zoom keys");
  // Still in Interact: the gestures did not leave it either.
  await expect(
    page.locator('[data-design-top-bar] [data-design-mode="interact"]'),
  ).toHaveAttribute("aria-pressed", "true");
});

const ZOOM = "[data-design-top-bar] [data-design-interact-zoom]";

// oracle: none — the preview's rendered width at each zoom is the assertion.
test("the zoom control scales the preview, keeps its choice across devices and resets on exit", async ({
  page,
}) => {
  const { frame } = await enterInteract(page);
  const zoom = page.locator(ZOOM);
  const widthNow = async () => (await frame.boundingBox())!.width;
  const choose = async (name: string) => {
    await zoom.click();
    await page.getByRole("option", { name, exact: true }).click();
  };

  const fitWidth = await widthNow();
  expect(await zoom.innerText()).toMatch(/^\d+%$/);

  await choose("100%");
  await expect(zoom).toHaveText("100%");
  const fullWidth = await widthNow();
  expect(fullWidth).toBeGreaterThan(fitWidth);

  await choose("50%");
  await expect(zoom).toHaveText("50%");
  await expect.poll(widthNow).toBeCloseTo(fullWidth / 2, 0);

  await choose("200%");
  await expect(zoom).toHaveText("200%");
  await expect.poll(widthNow).toBeCloseTo(fullWidth * 2, 0);

  // The device picks the viewport and the zoom scales it: 402 CSS px at 100%.
  await choose("100%");
  await page
    .locator("[data-design-top-bar] [data-design-interact-device]")
    .click();
  await page.getByRole("option", { name: /iPhone 17\b(?! P)/ }).click();
  await expect(zoom).toHaveText("100%");
  await expect.poll(widthNow).toBeCloseTo(402, 0);

  await choose("Fit");
  await expect(zoom).not.toHaveText("100%");
  expect(await widthNow()).toBeLessThan(402);

  // Leaving Interact forgets the choice: the next visit starts at Fit.
  await choose("150%");
  await page.locator('[data-design-top-bar] [data-design-mode="edit"]').click();
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(frame).toBeVisible();
  await expect(zoom).not.toHaveText("150%");
  await expect(zoom).not.toHaveText("100%");
});
