import { expect, test } from "@playwright/test";

import { renderedText, settleAuthGate } from "../lib/app";
import { originFor, productionHostFor, selectedSites } from "../lib/fleet";
import { mustRespond, parseJson } from "../lib/http";
import { installBetaE2ETrafficMarker } from "../lib/test-traffic";

/**
 * The signed-out auth surface, in the shapes users actually hit it.
 *
 * Everything here is reachable without a credential, which is what makes it
 * worth running on every promotion: the most-reported beta failures were all
 * visible before anyone finished signing in.
 */

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
      // Landing on the app root after signing in — instead of the page you
      // asked for — is the return-path regression this catches.
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

      // Same visit, second fact: having settled on sign-in it must stay there.
      // Checked here rather than in its own test because the page load is the
      // expensive part — against these hosts from CI it dominates everything
      // else the assertion does.
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
      // Two facts, one page load each previously. The hostile-continuation
      // visit has to be its own navigation (it carries a different URL), but
      // the plain visit and the settle check share one.
      await page.goto(`${origin}/sign-in`, {
        waitUntil: "domcontentloaded",
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

    test("keeps OAuth popups navigable from every document that opens them", async ({
      page,
    }) => {
      // Sign-in, in-app connect buttons, and the MCP sign-in form all open
      // their popup on the inert waiting page, then send it to the provider.
      // If the opener document's COOP is incompatible with the waiting page's,
      // the browser severs the popup: it stays blank and the opener reports it
      // closed ("allow popups"). The documents below carry different header
      // sets, which is how fixing one of them has twice broken the others.
      // Scripts are blocked so the anonymous shell cannot redirect to sign-in;
      // every visitor, signed in or not, receives these same cached headers.
      await page.route(
        (url) => /\.m?js$/.test(url.pathname),
        (route) => route.abort(),
      );
      for (const path of ["/", "/settings/general", "/mcp/connect"]) {
        const response = await page.goto(`${origin}${path}`, {
          waitUntil: "domcontentloaded",
        });
        // Only an app that does not mount MCP may lack /mcp/connect; any other
        // failure would silently drop that opener from coverage.
        if (path === "/mcp/connect" && response?.status() === 404) continue;
        expect(
          response?.ok(),
          `${site.host}${path} returned ${response?.status()}, so its popup behaviour went untested`,
        ).toBe(true);
        if (!response) continue;
        const [popup, opened] = await Promise.all([
          page.context().waitForEvent("page"),
          page.evaluate(() => {
            const handle = window.open(
              new URL("/_agent-native/oauth/popup", location.origin).href,
              "_blank",
              "width=640,height=760",
            );
            (window as { __oauthPopup?: Window | null }).__oauthPopup = handle;
            return handle !== null;
          }),
        ]);
        expect(opened, `${site.host}${path} could not open a popup`).toBe(true);
        // The waiting page's COOP only applies once it has committed, so the
        // opener must not navigate it before then or the check proves nothing.
        await popup.waitForURL("**/_agent-native/oauth/popup");
        await popup.waitForLoadState("domcontentloaded");
        const target = `${origin}/_agent-native/ping`;
        await page.evaluate((url) => {
          const handle = (window as { __oauthPopup?: Window | null })
            .__oauthPopup;
          if (handle && !handle.closed) handle.location.href = url;
        }, target);
        const navigated = await popup
          .waitForURL(target, { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        const closed = await page.evaluate(
          () =>
            (window as { __oauthPopup?: Window | null }).__oauthPopup?.closed ??
            true,
        );
        const coop = response.headers()["cross-origin-opener-policy"] ?? "none";
        expect
          .soft(
            closed,
            `${site.host}${path} (COOP ${coop}) lost its handle to the OAuth popup`,
          )
          .toBe(false);
        expect
          .soft(
            navigated,
            `${site.host}${path} (COOP ${coop}) could not send the OAuth popup on from the waiting page`,
          )
          .toBe(true);
        await popup.close();
      }
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
