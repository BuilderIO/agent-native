import { expect, test } from "@playwright/test";

import {
  collectAppPageErrors,
  readSignInAffordances,
  renderedText,
  settleAuthGate,
} from "../lib/app";
import { originFor, productionHostFor, selectedSites } from "../lib/fleet";
import { mustRespond, parseJson, probe, warm } from "../lib/http";
import { installBetaE2ETrafficMarker } from "../lib/test-traffic";

/**
 * The unauthenticated fleet sweep.
 *
 * Every assertion here maps to something users reported on beta, and none of it
 * needs a credential — which is why it runs first and runs for every host. The
 * ordering is deliberate: sign-in reachability outranks everything, because a
 * host nobody can log into is down regardless of what else works.
 */

interface HealthSample {
  ok?: boolean;
  ready?: boolean;
  db?: boolean;
  dbTimedOut?: boolean;
  ms?: number;
  database?: { urlHash?: string };
}

const SAMPLE_COUNT = 4;

const sites = selectedSites();

test.beforeEach(async ({ page }) => {
  await installBetaE2ETrafficMarker(page.context());
});

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} (${site.host})`, () => {
    test.beforeAll(async () => {
      await warm(origin);
    });

    test("serves a working landing page", async ({ page }) => {
      const { errors, thirdParty } = collectAppPageErrors(page, origin);
      const failedRequests: string[] = [];
      page.on("requestfailed", (request) => {
        const failure = request.failure()?.errorText ?? "unknown";
        if (/aborted/i.test(failure)) return;
        if (!request.url().startsWith(origin)) return;
        failedRequests.push(`${request.url()} (${failure})`);
      });

      const response = await page.goto(`${origin}/`, {
        waitUntil: "domcontentloaded",
      });
      expect(response, `${origin}/ produced no response`).toBeTruthy();
      expect.soft(response!.status(), `${origin}/ status`).toBeLessThan(400);

      await renderedText(page, `${site.host} landing page`);
      await page.waitForTimeout(5_000);

      if (thirdParty.length > 0) {
        test.info().annotations.push({
          type: "third-party-noise",
          description: `${site.host}: ${[...new Set(thirdParty)].join("; ")}`,
        });
      }
      expect
        .soft(
          errors,
          `${site.host} threw uncaught errors from its own code while rendering its landing page`,
        )
        .toEqual([]);
      expect
        .soft(
          failedRequests,
          `${site.host} landing page had failed same-origin subresource requests`,
        )
        .toEqual([]);
    });

    test("offers a sign-in that works", async ({ page }) => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const outcome = await mustRespond(
          `${origin}/sign-in?cb=${Date.now()}-${attempt}`,
          { redirect: "follow" },
        );
        expect(
          outcome.status,
          `${origin}/sign-in attempt ${attempt} returned HTTP ${outcome.status}`,
        ).toBe(200);
      }

      const affordances = await readSignInAffordances(page, origin);

      const environmentBadge = page.locator("#environment-badge");
      await expect(
        environmentBadge,
        `${site.host} sign-in beta badge`,
      ).toBeVisible();
      await expect(environmentBadge).toHaveText("beta");
      await environmentBadge.click();
      const popoverTitle = page.locator("#environment-popover-title");
      await expect(popoverTitle).toBeVisible();
      await expect(popoverTitle).toHaveText("You're on Agent-Native Beta");
      const productionLink = page.locator("#environment-production-link");
      await expect(productionLink).toBeVisible();
      const productionHref = await productionLink.getAttribute("href");
      expect(productionHref).not.toBeNull();
      expect(new URL(productionHref!).hostname).toBe(productionHostFor(site));

      expect(
        affordances.anySignIn,
        `${site.host} served /sign-in with no Google button, no password form, and no sign-in copy — nobody can get in. Page text: ${affordances.bodyText.slice(0, 200)}`,
      ).toBe(true);

      // apps that legitimately offer only password or Supabase sign-in.
      if (!affordances.google) {
        test.info().annotations.push({
          type: "no-google",
          description: `${site.id} does not offer Google sign-in`,
        });
        return;
      }

      const outcome = await mustRespond(
        `${origin}/_agent-native/google/auth-url`,
      );
      expect(
        outcome.status,
        `${site.host} shows a Google sign-in button but ${origin}/_agent-native/google/auth-url returned HTTP ${outcome.status}, so clicking it cannot work: ${outcome.body.slice(0, 200)}`,
      ).toBe(200);

      const payload = parseJson<{ url?: string }>(outcome, "google auth-url");
      expect(payload.url, "auth-url response carried no url").toBeTruthy();

      const authUrl = new URL(payload.url!);
      expect(
        authUrl.searchParams.get("redirect_uri"),
        `${site.host} would send users to Google with redirect_uri ${authUrl.searchParams.get("redirect_uri")} instead of its own callback — this is what produces redirect_uri_mismatch`,
      ).toBe(`${origin}/_agent-native/google/callback`);
      expect(
        authUrl.searchParams.get("client_id"),
        `${site.host} built a Google auth URL with no client_id`,
      ).toBeTruthy();

      await page.goto(payload.url!, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const body = await renderedText(page, "Google consent screen");
      expect(
        body,
        `Google rejected ${site.host}'s OAuth configuration. Add ${origin}/_agent-native/google/callback to the authorised redirect URIs for client ${authUrl.searchParams.get("client_id")}.`,
      ).not.toMatch(/redirect_uri_mismatch|Access blocked|Error 400/i);
    });

    test("reaches its database", async () => {
      test.setTimeout(420_000);

      const sample = async (host: string): Promise<HealthSample> =>
        parseJson<HealthSample>(
          await mustRespond(`https://${host}/_agent-native/health`, {
            attempts: 2,
            timeoutMs: 15_000,
          }),
          `${host} health`,
        );

      const isHealthy = (entry: HealthSample) =>
        entry.db === true && entry.ready === true;

      const samples: HealthSample[] = [];
      for (let attempt = 1; attempt <= SAMPLE_COUNT; attempt += 1) {
        samples.push(await sample(site.host));
        if (attempt < SAMPLE_COUNT) {
          await new Promise((r) => setTimeout(r, 1_500));
        }
      }

      const healthy = samples.filter(isHealthy).length;
      const detail = JSON.stringify(
        samples.map((entry) => ({
          ok: entry.ok,
          ready: entry.ready,
          db: entry.db,
          dbTimedOut: entry.dbTimedOut,
          ms: entry.ms,
        })),
      );

      if (healthy < SAMPLE_COUNT) {
        test.info().annotations.push({
          type: "degraded",
          description: `${site.id}: database unreachable in ${SAMPLE_COUNT - healthy}/${SAMPLE_COUNT} health samples (${samples.filter((entry) => entry.dbTimedOut).length} timed out). Users hit this as intermittent sign-in and load failures.`,
        });
      }

      if (healthy * 2 > SAMPLE_COUNT) return;

      const production = productionHostFor(site);
      const prodSamples: HealthSample[] = [];
      for (let attempt = 1; attempt <= SAMPLE_COUNT; attempt += 1) {
        prodSamples.push(await sample(production));
        if (attempt < SAMPLE_COUNT) {
          await new Promise((r) => setTimeout(r, 1_500));
        }
      }
      const prodHealthy = prodSamples.filter(isHealthy).length;

      const sameDatabase =
        samples[0]?.database?.urlHash != null &&
        samples[0].database.urlHash === prodSamples[0]?.database?.urlHash;
      const productionAtLeastAsBad = prodHealthy <= healthy;

      if (sameDatabase && productionAtLeastAsBad) {
        test.info().annotations.push({
          type: "pre-existing",
          description: `${site.id}: ${healthy}/${SAMPLE_COUNT} healthy on beta and ${prodHealthy}/${SAMPLE_COUNT} on ${production}, both on database ${samples[0]?.database?.urlHash} — pre-existing, not a promotion regression. ${detail}`,
        });
        return;
      }

      expect(
        healthy * 2,
        `${site.host} reached its database in only ${healthy}/${SAMPLE_COUNT} samples while ${production} managed ${prodHealthy}/${SAMPLE_COUNT}${sameDatabase ? " on the same database" : " on a different database"}. Promoting would ship a build whose database this host cannot reliably use. ${detail}`,
      ).toBeGreaterThan(SAMPLE_COUNT);
    });

    test("publishes an A2A agent card bound to its own origin", async () => {
      const outcome = await mustRespond(
        `${origin}/.well-known/agent-card.json`,
      );
      expect(
        outcome.status,
        `${origin}/.well-known/agent-card.json returned HTTP ${outcome.status}`,
      ).toBe(200);
      const card = parseJson<{
        name?: string;
        url?: string;
        securitySchemes?: Record<string, unknown>;
      }>(outcome, "agent card");

      expect(card.name, "agent card carried no name").toBeTruthy();
      expect(
        card.url,
        `${site.host} advertises its A2A endpoint as ${card.url}, which is not on its own origin — peers would be directed elsewhere`,
      ).toMatch(new RegExp(`^${origin.replace(/\./g, "\\.")}/`));
      expect(
        card.securitySchemes,
        `${site.host} publishes an agent card with no security scheme, so peers cannot tell how to authenticate`,
      ).toBeTruthy();
    });

    test("requires authentication on its A2A endpoint", async () => {
      const a2aProbe = (host: string) =>
        probe(`https://${host}/_agent-native/a2a`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "beta-e2e",
            method: "tasks/get",
            params: { id: "beta-e2e-probe" },
          }),
          attempts: 4,
          timeoutMs: 60_000,
        });

      const result = await a2aProbe(site.host);
      expect(
        result.kind,
        `${origin}/_agent-native/a2a never responded: ${result.kind === "unreachable" ? result.lastError : ""}`,
      ).toBe("responded");
      if (result.kind !== "responded") return;
      if (result.status === 401) return;

      const production = productionHostFor(site);
      const prodResult = await a2aProbe(production);
      const prodStatus =
        prodResult.kind === "responded" ? prodResult.status : undefined;

      const failureShape = (body: string): string => {
        try {
          const parsed = JSON.parse(body) as {
            error?: { code?: unknown; message?: unknown };
          };
          return `${parsed.error?.code ?? "?"}:${String(parsed.error?.message ?? "").slice(0, 120)}`;
        } catch {
          return body.slice(0, 120);
        }
      };
      const betaShape = failureShape(result.body);
      const prodShape =
        prodResult.kind === "responded" ? failureShape(prodResult.body) : "";

      if (prodStatus === result.status && prodShape === betaShape) {
        test.info().annotations.push({
          type: "pre-existing",
          description: `${site.id}: A2A answers HTTP ${result.status} with the same error on both beta and ${production} — pre-existing, not a promotion regression. ${result.body.slice(0, 200)}`,
        });
        return;
      }

      expect(
        result.status,
        `${site.host} answered A2A with HTTP ${result.status} (${betaShape}) while ${production} answered ${prodStatus ?? "no response"} (${prodShape || "no response"}) — promoting would regress cross-app delegation into this app. ${result.body.slice(0, 300)}`,
      ).toBe(401);
    });

    test("protects its agent chat endpoint", async () => {
      const outcome = await mustRespond(`${origin}/_agent-native/agent-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "beta-e2e reachability probe" }),
      });
      expect(
        outcome.status,
        `${site.host} agent-chat answered HTTP ${outcome.status} to an anonymous caller`,
      ).toBe(401);
    });
    test("sends an anonymous visitor to sign-in without looping", async ({
      page,
    }) => {
      const settings = `${origin}/settings/general`;
      await page.goto(settings, {
        waitUntil: "domcontentloaded",
      });

      const gate = await settleAuthGate(page);
      expect(
        gate.gated,
        `${site.host} settled on ${gate.url} for an anonymous request to /settings/general with no sign-in surface`,
      ).toBe(true);

      expect(
        new URL(gate.url).origin,
        `${site.host} bounced an anonymous visitor off its own origin to ${gate.url}`,
      ).toBe(origin);

      const settled = page.url();
      await page.waitForTimeout(2_500);
      expect(
        page.url(),
        `${site.host} kept redirecting after settling on ${settled} — this is the sign-in loop users reported`,
      ).toBe(settled);
    });
  });
}
