import { expect, type Page } from "@playwright/test";

export async function sharePanelStagesInvitesWithoutSending(
  page: Page,
  base: string,
) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.waitForURL(/\/project\//);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Share / })).toBeVisible();
  await expect(page.getByText("Invite only")).toBeVisible();
  const invite = page
    .getByRole("dialog")
    .locator("input[placeholder='Users...'], input:not([type='checkbox'])")
    .first();
  await invite.fill("person@example.invalid");
  await invite.press("Enter");
  await expect(page.getByText("person@example.invalid")).toBeVisible();
  await expect(invite).toHaveValue("");
  await page
    .getByRole("button", { name: "Remove person@example.invalid" })
    .click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByText("Link to project copied to clipboard."),
  ).toBeVisible();
}
