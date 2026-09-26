import { expect, test } from "@playwright/test";

import { renderedText, settleAuthGate } from "../lib/app";
import { originFor, productionHostFor, selectedSites } from "../lib/fleet";
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

    test("centers the AuthPage card in each rendered layout variant", async ({
      page,
    }) => {
      await page.goto(`${origin}/sign-in?cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
      });
      await renderedText(page, `${site.host} auth layout`);

      const geometry = await page.evaluate(() => {
        const home = document.querySelector<HTMLElement>(
          '[data-agent-native-marketing-home="true"]',
        );
        const panel = home?.querySelector<HTMLElement>(".form-panel");
        const card = panel?.querySelector<HTMLElement>(":scope > .card");
        if (!home || !panel || !card) return null;

        const panelRect = panel.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return {
          cardCenterX: cardRect.left + cardRect.width / 2,
          cardCenterY: cardRect.top + cardRect.height / 2,
          panelCenterX: panelRect.left + panelRect.width / 2,
          panelCenterY: panelRect.top + panelRect.height / 2,
          viewportCenterX: window.innerWidth / 2,
          viewportCenterY: window.innerHeight / 2,
          hasProductScreenshot: home.classList.contains(
            "has-product-screenshot",
          ),
        };
      });

      expect(
        geometry,
        `${site.host} did not render the AuthPage marketing/form layout`,
      ).not.toBeNull();
      expect(
        Math.abs(geometry!.cardCenterX - geometry!.panelCenterX),
        `${site.host} AuthPage card is not centered in its form panel`,
      ).toBeLessThan(8);
      expect(
        Math.abs(geometry!.cardCenterY - geometry!.panelCenterY),
        `${site.host} AuthPage card is not centered vertically in its form panel`,
      ).toBeLessThan(8);

      if (geometry!.hasProductScreenshot) {
        expect(
          Math.abs(geometry!.cardCenterX - geometry!.viewportCenterX),
          `${site.host} screenshot AuthPage variant is not centered in the viewport`,
        ).toBeLessThan(8);
        expect(
          Math.abs(geometry!.cardCenterY - geometry!.viewportCenterY),
          `${site.host} screenshot AuthPage variant is not vertically centered in the viewport`,
        ).toBeLessThan(8);
      }
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
