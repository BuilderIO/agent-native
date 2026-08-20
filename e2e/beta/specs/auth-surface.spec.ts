import { expect, test } from "@playwright/test";

import { settleAuthGate } from "../lib/app";
import { originFor, productionHostFor, selectedSites } from "../lib/fleet";
import { mustRespond, parseJson } from "../lib/http";

/**
 * The signed-out auth surface, in the shapes users actually hit it.
 *
 * Everything here is reachable without a credential, which is what makes it
 * worth running on every promotion: the most-reported beta failures were all
 * visible before anyone finished signing in.
 */

const sites = selectedSites();

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} auth surface`, () => {
    test("carries a continuation for the route the visitor asked for", async ({
      page,
    }) => {
      // Landing on the app root after signing in — instead of the page you
      // asked for — is the return-path regression this catches.
      const target = "/settings/general";
      await page.goto(`${origin}${target}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });

      const gate = await settleAuthGate(page);

      // Only meaningful if we were actually sent to sign-in; an app that
      // renders the route for anonymous visitors has nothing to continue to.
      test.skip(
        !gate.gated,
        `${site.id} served ${target} without a sign-in gate`,
      );

      const url = new URL(gate.url);
      const continuation = [...url.searchParams.entries()].find(([key]) =>
        ["c", "cb", "return", "returnTo", "redirect"].includes(key),
      );
      expect(
        continuation,
        `${site.host} sent an anonymous visitor from ${target} to ${gate.url} with no continuation, so signing in would drop them on the app root`,
      ).toBeTruthy();

      // The continuation is opaque (base64); it must still decode to the route
      // that was asked for, or the user lands somewhere they never requested.
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
    });

    test("holds still on sign-in and refuses an off-origin continuation", async ({
      page,
    }) => {
      // Two facts, one page load each previously. The hostile-continuation
      // visit has to be its own navigation (it carries a different URL), but
      // the plain visit and the settle check share one.
      await page.goto(`${origin}/sign-in`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await settleAuthGate(page);
      const settled = page.url();
      // A short confirmation window rather than a long sleep: a redirect loop
      // fires immediately, so waiting longer only adds dead time per host.
      await page.waitForTimeout(2_500);
      expect
        .soft(
          page.url(),
          `${site.host} moved a visitor off ${settled} after settling — the sign-in loop shape`,
        )
        .toBe(settled);

      // The continuation the app mints is opaque, so a raw URL here is not the
      // format it would normally consume. That is the point: whatever the app
      // does with an unrecognised value, it must not navigate off its own
      // origin.
      const hostile = "https://example.com/phish";
      await page.goto(`${origin}/sign-in?c=${encodeURIComponent(hostile)}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
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

    test("serves an impersonal, cacheable shell", async () => {
      // Every SSR response is one public shell shared by all visitors. A
      // Set-Cookie or a private cache directive here means the CDN is caching
      // per-visitor state, or refusing to cache at all.
      const outcome = await mustRespond(`${origin}/`, { redirect: "manual" });
      const cacheControl =
        outcome.headers["cache-control"] ??
        outcome.headers["cdn-cache-control"];
      // A missing header is its own failure, not a pass: without one the CDN
      // falls back to its default and the shell may not be shared at all.
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

test.describe("fleet-wide auth configuration", () => {
  test("every beta host uses a distinct Google callback", async () => {
    // Two hosts sharing one redirect_uri means one of them is misconfigured and
    // will fail OAuth for real users.
    const seen = new Map<string, string>();
    const problems: string[] = [];

    for (const site of sites) {
      const origin = originFor(site);
      const outcome = await mustRespond(
        `${origin}/_agent-native/google/auth-url`,
      );
      // Apps that do not offer Google sign-in have no callback to collide.
      if (outcome.status === 404) continue;
      if (outcome.status !== 200) {
        problems.push(
          `${site.id}: auth-url returned HTTP ${outcome.status}: ${outcome.body.slice(0, 160)}`,
        );
        continue;
      }
      const payload = parseJson<{ url?: string }>(outcome, "google auth-url");
      const redirectUri = payload.url
        ? new URL(payload.url).searchParams.get("redirect_uri")
        : null;
      if (!redirectUri) {
        problems.push(`${site.id}: auth-url carried no redirect_uri`);
        continue;
      }
      const owner = seen.get(redirectUri);
      if (owner) {
        problems.push(
          `${site.id} and ${owner} both claim redirect_uri ${redirectUri}`,
        );
      }
      seen.set(redirectUri, site.id);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
