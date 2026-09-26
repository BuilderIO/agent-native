import { test, expect } from "@playwright/test";

/*
 * EDITION READER (signed out).
 *
 * A signed-out viewer gets 401 from the edition actions. That is an auth state,
 * not a broken read: telling them the archive "could not be loaded" sends them
 * looking for an outage, and it buries every real failure under the same words.
 */

test("the archive asks a signed-out reader to sign in, not to retry", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/editions", { waitUntil: "domcontentloaded" });

  await expect(page.getByText(/Sign in to read the newspaper/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: /^Sign in$/ }).first(),
  ).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/could not be loaded/i);
});

test("an issue asks a signed-out reader to sign in", async ({ page }) => {
  await page.context().clearCookies();
  // Any id: the action refuses on the session before it ever resolves one.
  await page.goto("/editions/edition-does-not-exist", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByText(/Sign in to read the newspaper/i)).toBeVisible({
    timeout: 20_000,
  });
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/could not be loaded|not available/i);
});
