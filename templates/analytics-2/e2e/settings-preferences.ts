import { expect, type Page } from "@playwright/test";

export async function checkSettingsPreferences(page: Page, base: string) {
  await page.goto(`${base}/settings/preferences`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveTitle("Settings");
  await expect(page.locator(".settings-shell")).toBeVisible();
  await expect(page.locator(".ws-sidebar")).toHaveCount(0);
  const rail = page.locator(".settings-nav");
  for (const name of ["Notifications", "Connected apps", "API keys"]) {
    await expect(rail.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByText("Manage your user preferences.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent personalization", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Personal preferences", exact: true }),
  ).toBeVisible();
}
