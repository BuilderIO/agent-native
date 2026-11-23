import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

test("new thread title survives native entry and a fresh page load", async ({
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
  const heading = page.locator("[data-agent-page-chat-header] h1");
  await expect(heading).toHaveText("New thread");
  const fresh = await page.context().newPage();
  try {
    await fresh.goto(`${BASE}/ask`);
    await expect(fresh.locator("[data-agent-page-chat-header] h1")).toHaveText(
      "New thread",
    );
    await expect(fresh.locator(".analytics-2-ask-mode-tabs")).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});
