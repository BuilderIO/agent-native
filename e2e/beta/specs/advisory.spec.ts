import { expect, test } from "@playwright/test";

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

  test.describe(`${site.id} advisory`, () => {
    test("keeps beta out of search results", async () => {
      const headers = await mustRespond(`${origin}/`, { redirect: "manual" });
      const robots = await mustRespond(`${origin}/robots.txt`, {
        redirect: "follow",
      });
      const headerBlocks = /noindex/i.test(
        headers.headers["x-robots-tag"] ?? "",
      );
      const robotsBlocks =
        robots.status === 200 && /Disallow:\s*\/\s*$/m.test(robots.body);

      expect(
        headerBlocks || robotsBlocks,
        `${site.host} is indexable: no noindex X-Robots-Tag on / and robots.txt allows crawling. Beta pages can rank against ${productionHostFor(site)}.`,
      ).toBe(true);
    });

    test("does not run third-party pixels that reject this host", async ({
      page,
    }) => {
      const rejected: string[] = [];
      page.on("pageerror", (error) => {
        if (/domain not allowed|not allowed/i.test(error.message)) {
          rejected.push(error.message);
        }
      });
      const blocked: string[] = [];
      page.on("response", (response) => {
        if (response.status() < 400) return;
        if (response.url().startsWith(origin)) return;
        blocked.push(`${response.status()} ${response.url().slice(0, 120)}`);
      });

      await page.goto(`${origin}/`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(5_000);

      expect(
        [...rejected, ...blocked],
        `${site.host} loads third-party scripts that reject this origin`,
      ).toEqual([]);
    });

    test("does not report ok while its database is unreachable", async () => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const outcome = await mustRespond(`${origin}/_agent-native/health`, {
          attempts: 3,
          timeoutMs: 60_000,
        });
        const health = parseJson<{
          ok?: boolean;
          db?: boolean;
          dbTimedOut?: boolean;
        }>(outcome, "health");

        if (health.db === false || health.dbTimedOut === true) {
          expect(
            health.ok,
            `${site.host} reported ok=${health.ok} while db=${health.db} dbTimedOut=${health.dbTimedOut}. "Reachable" and "usable" must not be the same value.`,
          ).not.toBe(true);
        }
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1_500));
      }
    });

    test("does not share a database with its production twin", async () => {
      // Beta is meant to absorb risk before production sees it. A shared
      // database means a bad migration or a destructive agent turn on beta
      // lands directly in production data, and it is why this suite's
      // authenticated specs must clean up after themselves.
      const production = productionHostFor(site);
      const betaHealth = parseJson<{ database?: { urlHash?: string } }>(
        await mustRespond(`${origin}/_agent-native/health`, {
          attempts: 4,
          timeoutMs: 60_000,
        }),
        "beta health",
      );
      const prodHealth = parseJson<{ database?: { urlHash?: string } }>(
        await mustRespond(`https://${production}/_agent-native/health`, {
          attempts: 4,
          timeoutMs: 60_000,
        }),
        "production health",
      );

      const betaHash = betaHealth.database?.urlHash;
      const prodHash = prodHealth.database?.urlHash;
      expect(
        betaHash,
        `${site.host} health carried no database hash`,
      ).toBeTruthy();
      expect(
        prodHash,
        `${production} health carried no database hash`,
      ).toBeTruthy();
      expect(
        betaHash,
        `${site.host} and ${production} both use database ${betaHash}. Writes on beta — including anything this suite or an agent does — land in production data.`,
      ).not.toBe(prodHash);
    });
  });
}
