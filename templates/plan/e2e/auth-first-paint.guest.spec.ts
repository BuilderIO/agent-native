import { test, expect } from "@playwright/test";

/*
 * AUTH FIRST PAINT
 *
 * Regression coverage for the reviewer report that clicking signup initially
 * showed a raw `true` message. These entrypoints should always render the
 * framework auth page, never a bare boolean response.
 */

const AUTH_ENTRYPOINTS = [
  { path: "/signup", label: "signup" },
  { path: "/login", label: "login" },
  { path: "/_agent-native/sign-in?return=%2Fplans", label: "sign-in" },
];

for (const entrypoint of AUTH_ENTRYPOINTS) {
  test(`auth entrypoint ${entrypoint.label} renders a real page, not raw true`, async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(entrypoint.path, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Create account|Sign in/i).first()).toBeVisible(
      { timeout: 15_000 },
    );

    const body = await page.locator("body").innerText();
    expect(
      body.trim(),
      `${entrypoint.path} must not render only a raw boolean`,
    ).not.toBe("true");
    expect(
      body,
      `${entrypoint.path} must not include a standalone raw true line`,
    ).not.toMatch(/(^|\n)\s*true\s*(\n|$)/i);
  });
}
