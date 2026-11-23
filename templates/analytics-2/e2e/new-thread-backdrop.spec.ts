import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 780, height: 800 },
]) {
  test(`empty thread has a decorative canvas below its header at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/home`);
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await expect(page).toHaveURL(/\/ask$/);
    const panel = page.locator(".analytics-2-new-thread .agent-panel-root");
    const composer = page.locator(".agentkit-composer-stack");
    await expect(composer).toHaveCount(1);
    await expect(composer).toBeVisible();
    await expect
      .poll(() =>
        panel.evaluate(
          (element) => getComputedStyle(element, "::before").backgroundImage,
        ),
      )
      .not.toBe("none");
    const decoration = await panel.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return {
        pointerEvents: style.pointerEvents,
        position: style.position,
        top: Number.parseFloat(style.top),
      };
    });
    expect(decoration.pointerEvents).toBe("none");
    expect(decoration.position).toBe("absolute");
    const header = await page
      .locator("[data-agent-page-chat-header]")
      .boundingBox();
    expect(header).not.toBeNull();
    if (!header) throw new Error("Thread header has no visible bounds");
    expect(decoration.top).toBeGreaterThanOrEqual(header.height);
    await test.info().attach("thread-canvas", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.reload();
    await expect
      .poll(() =>
        panel.evaluate(
          (element) => getComputedStyle(element, "::before").backgroundImage,
        ),
      )
      .not.toBe("none");
    await page.goto(`${BASE}/home`);
    await expect(
      page.getByRole("button", { name: "Thread", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".analytics-2-new-thread")).toHaveCount(0);
  });
}
