import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

test("empty thread header omits the existing-thread mode navigation", async ({
  page,
}) => {
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
  const header = page.locator("[data-agent-page-chat-header]");
  await expect(header).toBeVisible();
  await expect(header.locator(".analytics-2-ask-mode-tabs")).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "Primary navigation", exact: true }),
  ).toBeVisible();
  await page.goto(`${BASE}/ask`);
  await expect(header).toBeVisible();
  await expect(header.locator(".analytics-2-ask-mode-tabs")).toHaveCount(0);
});
