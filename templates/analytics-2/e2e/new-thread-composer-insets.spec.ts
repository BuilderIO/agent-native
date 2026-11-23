import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const width of [1440, 780]) {
  test(`empty thread composer is centered with its own gutters at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${BASE}/home`);
    const thread = page.getByRole("button", { name: "Thread", exact: true });
    const localLogin = page.getByRole("button", {
      name: "Continue as local dev",
      exact: true,
    });
    await expect(thread.or(localLogin)).toBeVisible();
    if (await localLogin.isVisible()) await localLogin.click();
    await thread.click();
    await expect(page).toHaveURL(/\/ask$/);
    const composer = page.locator(".agentkit-composer-stack");
    await expect(composer).toHaveCount(1);
    const expectedInset = (width - Math.min(737, width - 48)) / 2;
    await expect
      .poll(async () => (await composer.boundingBox())?.x)
      .toBe(expectedInset);
    await page.goto(`${BASE}/ask`);
    await expect
      .poll(async () => (await composer.boundingBox())?.x)
      .toBe(expectedInset);
  });
}
