import { expect, type Page } from "@playwright/test";

export const signedInLandingPaths = [
  "/welcome",
  "/onboarding",
  "/onboarding/prompt",
  "/org-selector",
  "/workspace-picker/choose",
  "/verify-org-domain",
  "/sent",
  "/createUser",
  "/link",
  "/link/example/logged-in",
  "/link/example/wrong-user",
  "/app/redirected",
] as const;

export async function checkSignedInLandingRoutes(page: Page, base: string) {
  const origin = new URL(base);
  const home = `${origin.pathname.replace(/\/$/, "")}/home`;
  for (const path of signedInLandingPaths) {
    await page.goto(`${base}${path}?from=qa`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page, path).toHaveURL(
      (url) => url.pathname === home && url.searchParams.get("from") === "qa",
    );
    await expect(page.locator(".ws-sidebar"), path).toBeVisible();
    await expect(page, path).toHaveTitle("Home");
  }
}
