import { randomUUID } from "node:crypto";

import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { z } from "zod";

// M5-T2-F-26 / F-10: this fixture has no configured agent engine, so it
// exercises refusal and retry without claiming successful message persistence.
export async function checkSearchStartThread(
  page: Page,
  context: BrowserContext,
  base: string,
): Promise<void> {
  const prompt = `QA search ${randomUUID()}`;
  const createdIds: string[] = [];
  const popupNavigations: string[] = [];
  const popups: Page[] = [];
  const onPopup = (popup: Page) => {
    popups.push(popup);
    popup.on("framenavigated", (frame) => {
      if (frame === popup.mainFrame()) popupNavigations.push(frame.url());
    });
  };
  const onResponse = async (response: Response) => {
    if (
      response.request().method() !== "POST" ||
      !response.url().endsWith("/_agent-native/actions/create-thread") ||
      !response.ok()
    )
      return;
    const result = z
      .object({ id: z.string().min(1) })
      .safeParse(await response.json());
    if (result.success) createdIds.push(result.data.id);
  };
  page.on("response", onResponse);
  page.on("popup", onPopup);
  await page.route("**/_agent-native/actions/start-analytics-thread", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Provider unavailable",
        errorCode: "ai_provider_unavailable",
      }),
    }),
  );
  try {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Search your workspace" });
    const input = dialog.getByRole("textbox", {
      name: "Search your workspace",
    });
    await input.fill(prompt);
    const row = dialog.getByRole("menuitem", { name: /Start a new thread/ });
    await expect(row).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      row.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expect.poll(() => popup.isClosed(), { timeout: 60_000 }).toBe(true);
    const refusal = dialog.getByText("Connect an AI provider to continue.");
    await expect(refusal).toBeVisible({ timeout: 60_000 });
    await expect(input).toHaveValue(prompt);
    await row.click();
    await expect(refusal).toBeVisible({ timeout: 60_000 });
    await expect(input).toHaveValue(prompt);
    expect(new URL(page.url()).pathname).toBe("/home");
    expect(
      popupNavigations.every(
        (url) =>
          !url.includes(encodeURIComponent(prompt)) &&
          !new URL(url).search &&
          !new URL(url).hash,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".tmp/analytics-owner/report-search-refusal.png",
      fullPage: true,
    });
  } finally {
    await page.unroute("**/_agent-native/actions/start-analytics-thread");
    page.off("response", onResponse);
    page.off("popup", onPopup);
    for (const popup of popups) if (!popup.isClosed()) await popup.close();
    for (const threadId of createdIds) {
      const response = await context.request.post(
        `${base}/_agent-native/actions/delete-thread`,
        {
          headers: {
            "x-agent-native-frontend": "1",
            "x-agent-native-csrf": "1",
          },
          data: { threadId },
        },
      );
      if (!response.ok())
        throw new Error(`Could not clean search thread (${response.status()})`);
    }
  }
}
