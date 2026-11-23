import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

import { checkSettingsPreferences } from "./settings-preferences.js";

export async function checkSettingsSearch(
  page: Page,
  base: string,
): Promise<void> {
  await checkSettingsPreferences(page, base);
  const trigger = page.getByRole("button", {
    name: "Search settings",
    exact: true,
  });
  await expect(trigger).toBeVisible({ timeout: 30000 });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search settings" });
  const input = dialog.getByPlaceholder("Search...");
  await expect(input).toBeFocused();
  const screenshotDir = resolve(
    import.meta.dirname,
    "../../../.tmp/analytics-owner",
  );
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: resolve(screenshotDir, "report-settings-search.png"),
  });
  await input.fill("not-a-real-setting-93754");
  await expect(dialog.getByText("No settings found")).toBeVisible();
  await input.fill("user");
  await expect(
    dialog.getByRole("option", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  try {
    await expect(trigger).toBeFocused();
  } catch (error) {
    try {
      const state = await trigger.evaluate(
        (element) => ({
          activeTag: document.activeElement?.tagName ?? null,
          activeRole: document.activeElement?.getAttribute("role") ?? null,
          triggerConnected: element.isConnected,
          triggerFocused: document.activeElement === element,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
        }),
        undefined,
        { timeout: 2_000 },
      );
      console.error(`SETTINGS SEARCH escape focus ${JSON.stringify(state)}`);
      await page.screenshot({
        path: resolve(
          screenshotDir,
          "report-settings-search-focus-failure.png",
        ),
        timeout: 10_000,
      });
    } catch {
      console.error("SETTINGS SEARCH escape focus diagnostics unavailable");
    }
    throw error;
  }
  for (const chord of ["ControlOrMeta+p", "ControlOrMeta+k", "/"]) {
    try {
      console.log(`SETTINGS SEARCH shortcut=${chord} stage=press`);
      await page.keyboard.press(chord);
      await expect(dialog).toBeVisible();
      console.log(`SETTINGS SEARCH shortcut=${chord} stage=open`);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      console.log(`SETTINGS SEARCH shortcut=${chord} stage=closed`);
    } catch (error) {
      const state = await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName ?? null,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        menus: document.querySelectorAll('[role="menu"]').length,
      }));
      console.error(
        `SETTINGS SEARCH shortcut=${chord} failed state=${JSON.stringify(state)}`,
      );
      await page.screenshot({
        path: resolve(
          screenshotDir,
          "report-settings-search-shortcut-failure.png",
        ),
      });
      throw error;
    }
  }
  await trigger.click();
  await input.fill("users");
  await dialog.getByRole("option", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/users$/);
  await expect(dialog).toHaveCount(0);
  await page.goto(`${base}/settings/preferences`, {
    waitUntil: "domcontentloaded",
  });
  await expect(trigger).toBeVisible({ timeout: 30000 });
  await trigger.click();
  await input.fill("desktop notifications");
  await dialog
    .getByRole("option", {
      name: "Notifications > Desktop notifications",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await expect(
    page.locator(
      '[data-rid="settings.notifications.desktop-notifications"][data-part="settings.row"]',
    ),
  ).toBeInViewport();
  await page.screenshot({
    path: resolve(screenshotDir, "report-settings-search-section.png"),
  });
  await trigger.click();
  await input.fill("workspace name");
  await dialog
    .getByRole("option", { name: "General > Workspace name", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(
    page.locator("#settings-general-workspace-name"),
  ).toBeInViewport();
  await page.screenshot({
    path: resolve(screenshotDir, "report-settings-search-workspace-name.png"),
  });
  await page.goto(`${base}/settings/preferences`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const preferences = page.getByRole("textbox", {
    name: "Personal preferences",
  });
  await preferences.fill("");
  await page.keyboard.type("/");
  await expect(preferences).toHaveValue(/\/$/);
  await expect(dialog).toHaveCount(0);
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
}
