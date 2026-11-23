import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 780, height: 800 },
]) {
  test(`new thread keeps its heading clear of the composer at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/home`);
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await expect(page).toHaveURL(/\/ask$/);
    const heading = page.locator(".analytics-2-home-heading");
    const composer = page.locator(".agent-composer-root");
    await expect(heading).toBeVisible();
    await expect(composer).toHaveCount(1);
    await expect(composer).toBeVisible();
    await expect
      .poll(async () => {
        const titleBox = await heading.boundingBox();
        const composerBox = await composer.boundingBox();
        return titleBox && composerBox
          ? composerBox.y - (titleBox.y + titleBox.height)
          : -1;
      })
      .toBeGreaterThan(0);
    await expect(page.locator("[data-agent-page-chat-header]")).toBeVisible();
    await test.info().attach("new-thread", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.goto(`${BASE}/ask`);
    await expect(page.locator("[data-agent-page-chat-header]")).toBeVisible();
  });
}
