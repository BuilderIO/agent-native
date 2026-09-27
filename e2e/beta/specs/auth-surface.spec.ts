import { expect, test } from "@playwright/test";

import { renderedText, settleAuthGate } from "../lib/app";
import {
  isGoogleOnly,
  originFor,
  productionHostFor,
  selectedSites,
} from "../lib/fleet";
import { mustRespond, parseJson } from "../lib/http";
import { installBetaE2ETrafficMarker } from "../lib/test-traffic";

const sites = selectedSites();

test.beforeEach(async ({ page }) => {
  await installBetaE2ETrafficMarker(page.context());
});

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} auth surface`, () => {
    test("carries a continuation for the route the visitor asked for", async ({
      page,
    }) => {
      const target = "/settings/general";
      await page.goto(`${origin}${target}`, {
        waitUntil: "domcontentloaded",
      });

      const gate = await settleAuthGate(page);

      // A protected route that renders anonymously is an authorization
      // regression, not a reason to skip the test. The gate must also remain
      // on the app's own origin so a sign-in cannot be redirected elsewhere.
      expect(
        gate.gated,
        `${site.id} served ${target} without a sign-in surface`,
      ).toBe(true);
      expect(
        new URL(gate.url).origin,
        `${site.host} bounced an anonymous visitor off its own origin to ${gate.url}`,
      ).toBe(origin);

      const url = new URL(gate.url);
      const continuation = [...url.searchParams.entries()].find(([key]) =>
        ["c", "cb", "return", "returnTo", "redirect"].includes(key),
      );
      expect(
        continuation,
        `${site.host} sent an anonymous visitor from ${target} to ${gate.url} with no continuation, so signing in would drop them on the app root`,
      ).toBeTruthy();

      const decoded = (() => {
        const raw = decodeURIComponent(continuation![1]);
        try {
          return decodeURIComponent(
            Buffer.from(raw, "base64").toString("utf8"),
          );
        } catch {
          return raw;
        }
      })();
      expect(
        decoded,
        `${site.host} carried continuation "${continuation![1]}", which does not resolve to ${target}`,
      ).toContain(target);

      const settled = page.url();
      await page.waitForTimeout(2_500);
      expect(
        page.url(),
        `${site.host} kept redirecting after settling on ${settled} — this is the sign-in loop users reported`,
      ).toBe(settled);
    });

    test("holds still on sign-in and refuses an off-origin continuation", async ({
      page,
    }) => {
      await page.goto(`${origin}/sign-in`, {
        waitUntil: "domcontentloaded",
      });
      await settleAuthGate(page);
      const settled = page.url();
      await page.waitForTimeout(2_500);
      expect
        .soft(
          page.url(),
          `${site.host} moved a visitor off ${settled} after settling — the sign-in loop shape`,
        )
        .toBe(settled);

      const hostile = "https://example.com/phish";
      await page.goto(`${origin}/sign-in?c=${encodeURIComponent(hostile)}`, {
        waitUntil: "domcontentloaded",
      });
      await settleAuthGate(page);
      expect
        .soft(
          new URL(page.url()).origin,
          `${site.host} followed an off-origin continuation to ${page.url()}`,
        )
        .toBe(origin);
      expect
        .soft(
          await page.locator('a[href^="https://example.com"]').count(),
          `${site.host} rendered a link to the hostile continuation target on its sign-in page`,
        )
        .toBe(0);
    });

    test("renders the shared auth surface without a separate marketing layout", async ({
      page,
    }) => {
      await page.goto(`${origin}/sign-in?cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
      });
      await renderedText(page, `${site.host} auth layout`);

      await expect(page.locator(".auth-centered > .card")).toBeVisible();
      await expect(page.locator("#heading")).toBeVisible();
      await expect(page.locator("#google-btn")).toBeVisible();

      if (isGoogleOnly(site)) {
        await expect(page.locator("#auth-tabs")).toBeHidden();
        return;
      }

      const usePasswordLink = page.locator("#use-password-link");
      if (await usePasswordLink.isVisible()) await usePasswordLink.click();

      const tabs = page.locator("#auth-tabs");
      await expect(tabs).toBeVisible();
      await tabs.locator('[data-tab="signup"]').click();
      await expect(page.locator("#signup-form")).toBeVisible();
      await expect(page.locator("#s-email")).toBeVisible();
      await expect(page.locator("#login-form")).toBeHidden();

      await tabs.locator('[data-tab="login"]').click();
      await expect(page.locator("#login-form")).toBeVisible();
      await expect(page.locator("#l-email")).toBeVisible();
      await expect(page.locator("#signup-form")).toBeHidden();
    });

    test("serves an impersonal, cacheable shell", async () => {
      const outcome = await mustRespond(`${origin}/`, { redirect: "manual" });
      const cacheControl =
        outcome.headers["cache-control"] ??
        outcome.headers["cdn-cache-control"];
      expect(
        cacheControl,
        `${site.host} served its SSR shell with no cache-control or cdn-cache-control header`,
      ).toBeTruthy();
      expect(
        cacheControl ?? "",
        `${site.host} served its shell with cache-control "${cacheControl}", which prevents the shared public shell from being cached`,
      ).not.toMatch(/private|no-store/i);
      expect
        .soft(
          outcome.headers["set-cookie"] ?? "",
          `${site.host} set a cookie on its cacheable SSR shell`,
        )
        .not.toMatch(/session/i);
    });

    test("sends security headers", async () => {
      const outcome = await mustRespond(`${origin}/`, { redirect: "manual" });
      expect
        .soft(
          outcome.headers["x-content-type-options"],
          `${site.host} is missing X-Content-Type-Options`,
        )
        .toBe("nosniff");
      expect
        .soft(
          outcome.headers["strict-transport-security"],
          `${site.host} is missing Strict-Transport-Security`,
        )
        .toBeTruthy();
    });
  });
}
