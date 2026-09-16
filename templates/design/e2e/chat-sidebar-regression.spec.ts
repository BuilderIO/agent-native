import { expect, test } from "@playwright/test";

import { newDesign, setBaseURL } from "./drag-and-drop.shared";
import { appPath } from "./helpers";

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test("Design full-page chat keeps shared tabs and new-chat controls", async ({
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

  await newChat.click();
  // A fresh page may still be reconciling its first client-only tab into the
  // persisted open-tab list; let that tab become the stable predecessor.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((candidate) =>
          candidate.includes("agent-chat-open-tabs"),
        );
        if (!key) return 0;
        const value = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(value) ? value.length : -1;
      }),
    )
    .toBeGreaterThan(0);
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
