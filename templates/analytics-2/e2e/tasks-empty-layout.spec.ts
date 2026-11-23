import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 780, height: 720 },
]) {
  test(`tasks empty state fills the available panel at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/tasks`);
    const login = page.getByRole("button", {
      name: "Continue as local dev",
      exact: true,
    });
    const title = page.getByRole("heading", { name: "Tasks", exact: true });
    await expect(title.or(login)).toBeVisible();
    if (await login.isVisible()) await login.click();
    await expect(page.getByText("No tasks yet", { exact: true })).toBeVisible();
    const content = page.locator(
      '[data-list-page="tasks"] > .analytics-workspace-list-content',
    );
    const illustration = page.getByTestId("workspace-list-empty-illustration");
    const actions = page.locator(".analytics-workspace-list-empty-actions");
    const panel = await content.boundingBox();
    const visual = await illustration.boundingBox();
    const buttons = await actions.boundingBox();
    expect(panel).not.toBeNull();
    expect(visual).not.toBeNull();
    expect(buttons).not.toBeNull();
    if (!panel || !visual || !buttons)
      throw new Error("Missing empty-state geometry");
    const contentCenter = (visual.y + buttons.y + buttons.height) / 2;
    const panelCenter = panel.y + panel.height / 2;
    expect(Math.abs(contentCenter - panelCenter)).toBeLessThanOrEqual(2);
    expect(visual.width).toBe(240);
    expect(visual.height).toBe(240);
    expect(visual.y).toBeGreaterThanOrEqual(panel.y);
    expect(buttons.y + buttons.height).toBeLessThanOrEqual(
      panel.y + panel.height,
    );
    await page
      .getByRole("button", { name: "Create from scratch", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("No tasks yet", { exact: true })).toBeVisible();
  });
}
