import { expect, type Page } from "@playwright/test";

async function checkMenu(page: Page, name: string, selector: string) {
  const trigger = page.locator(`${selector}:visible`);
  await trigger.click();
  const menu = page.locator('.ws-popover[role="menu"]');
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate((element) => {
    const { top, bottom } = element.getBoundingClientRect();
    return { top, bottom, viewportHeight: window.innerHeight };
  });
  console.log(`MENU_VIEWPORT ${name} ${JSON.stringify(bounds)}`);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);

  const items = menu.locator('[data-menu-item="true"]:not(:disabled)');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  const last = items.last();
  await expect(last).toBeFocused();
  await expect
    .poll(() =>
      last.evaluate((element) => {
        const item = element.getBoundingClientRect();
        const panel = element.closest(".ws-popover")!.getBoundingClientRect();
        return item.top >= panel.top && item.bottom <= panel.bottom;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  console.log(`MENU_VIEWPORT ${name} last action visible and focus restored`);
}

export async function checkMenuViewport(page: Page, base: string) {
  const originalViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 1280, height: 115 });
    await page.goto(`${base}/home/all`);
    await checkMenu(page, "Create new", ".ws-quick-plus");
    await checkMenu(page, "Workspace", ".ws-workspace-trigger");
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
