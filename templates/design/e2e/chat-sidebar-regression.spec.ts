import { expect, test } from "@playwright/test";

import { newDesign, setBaseURL } from "./drag-and-drop.shared";
import { appPath } from "./helpers";

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test("Design full-page chat keeps shared tabs, new-chat, and clear controls", async ({
  page,
}) => {
  const designId = await newDesign(page);
  await page.goto(appPath(`/chat?designId=${encodeURIComponent(designId)}`), {
    waitUntil: "domcontentloaded",
  });

  const header = page.locator(".agent-sidebar-chat-header").first();
  await expect(header).toBeVisible({ timeout: 30_000 });
  const newChat = header.locator('button[aria-label="New chat"]');
  await expect(newChat).toBeVisible();
  await expect(
    header.getByRole("button", { name: "Agent panel options", exact: true }),
  ).toBeVisible();
  await header
    .getByRole("button", { name: "Agent panel options", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Clear chat", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const readOpenTabCount = () =>
    page.evaluate(() => {
      const counts = Object.keys(localStorage)
        .filter((candidate) => candidate.includes("agent-chat-open-tabs"))
        .map((key) => {
          try {
            const value = JSON.parse(localStorage.getItem(key) ?? "[]");
            return Array.isArray(value) ? value.length : 0;
          } catch {
            return 0;
          }
        });
      return Math.max(0, ...counts);
    });
  const initialOpenTabCount = await readOpenTabCount();
  await newChat.click();
  // Wait for this click's new thread, not merely the initial tab persisted by
  // mount-time reconciliation. Legacy and browser-tab-scoped keys can coexist,
  // so read the largest valid list rather than relying on key order.
  await expect.poll(readOpenTabCount).toBeGreaterThan(initialOpenTabCount);
  await newChat.click();
  await expect
    .poll(() => header.locator(".agent-tab").count())
    .toBeGreaterThan(1);

  const chatUrl = new URL(page.url());
  expect(chatUrl.searchParams.get("designId")).toBe(designId);
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible({
    timeout: 30_000,
  });
});
