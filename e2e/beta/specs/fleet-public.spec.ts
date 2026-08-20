import { expect, test } from "@playwright/test";

import {
  collectAppPageErrors,
  readSignInAffordances,
  renderedText,
  settleAuthGate,
} from "../lib/app";
import { originFor, productionHostFor, selectedSites } from "../lib/fleet";
import { mustRespond, parseJson, probe, warm } from "../lib/http";

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

/** Samples per lane. Enough to see a flap, few enough to stay in budget. */
const SAMPLE_COUNT = 4;

const sites = selectedSites();

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} (${site.host})`, () => {
    test.beforeAll(async () => {
      // Serverless hosts idle out. A cold start belongs in setup, not in the
      // timing of the first assertion.
      await warm(origin);
    });

    test("serves its landing document over valid TLS", async ({ page }) => {
      const response = await page.goto(`${origin}/`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      expect(response, `${origin}/ produced no response`).toBeTruthy();
      expect.soft(response!.status(), `${origin}/ status`).toBeLessThan(400);
      // "connection isn't private" was a real report; Playwright surfaces a
      // certificate problem as a navigation failure only while
      // `ignoreHTTPSErrors` stays off, so it is deliberately never set.
      await expect(page.locator("body")).toBeVisible();
    });

    test("serves a sign-in page on every request", async ({ page }) => {
      // Repeated with a cache buster: a sign-in 404 that "fixes itself on
      // refresh" was reported, which a single request cannot see.
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const outcome = await mustRespond(
          `${origin}/sign-in?cb=${Date.now()}-${attempt}`,
          { redirect: "follow" },
        );
        expect(
          outcome.status,
          `${origin}/sign-in attempt ${attempt} returned HTTP ${outcome.status}`,
        ).toBe(200);
      }

      // A 200 that renders no way to sign in is the same outage to a user.
      const affordances = await readSignInAffordances(page, origin);
      expect(
        affordances.anySignIn,
        `${site.host} served /sign-in with no Google button, no password form, and no sign-in copy — nobody can get in. Page text: ${affordances.bodyText.slice(0, 200)}`,
      ).toBe(true);
    });

    test("offers a Google sign-in that Google will accept", async ({
      page,
    }) => {
      // redirect_uri_mismatch was the single most-reported beta failure.
      //
      // Scoped to apps that actually show a Google button: the shared login
      // document ships Google markup for every app and hides it when the
      // provider is not configured, so asserting unconditionally would fail
      // apps that legitimately offer only password or Supabase sign-in.
      const affordances = await readSignInAffordances(page, origin);
      test.skip(
        !affordances.google,
        `${site.id} does not offer Google sign-in`,
      );

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
      const redirectUri = authUrl.searchParams.get("redirect_uri");
      expect(
        redirectUri,
        `${site.host} would send users to Google with redirect_uri ${redirectUri} instead of its own callback — this is what produces redirect_uri_mismatch`,
      ).toBe(`${origin}/_agent-native/google/callback`);
      expect(
        authUrl.searchParams.get("client_id"),
        `${site.host} built a Google auth URL with no client_id`,
      ).toBeTruthy();

      // Loading Google's own page is the only check that catches a console
      // registration that has drifted from the deployed host.
      await page.goto(payload.url!, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      // Confirm Google actually rendered something first: an empty body would
      // satisfy the "no error" assertion below without proving anything.
      const body = await renderedText(page, "Google consent screen");
      expect(
        body,
        `Google rejected ${site.host}'s OAuth configuration. Add ${origin}/_agent-native/google/callback to the authorised redirect URIs for client ${authUrl.searchParams.get("client_id")}.`,
      ).not.toMatch(/redirect_uri_mismatch|Access blocked|Error 400/i);
    });

    test("reaches its database", async () => {
      // Set above the true worst case, not above the typical one. Eight
      // samples (four beta, four production) at up to two 15s attempts plus
      // backoff is ~256s against an unreachable host; a timeout below that
      // would replace the verdict this test exists to produce with a generic
      // Playwright timeout in exactly the situation it matters.
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

      // `ok` is deliberately not the signal: this endpoint returns ok:true
      // alongside db:false, so a host with no database reads as healthy.
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

      // A strict majority. At exactly half, one in two sign-ins or first loads
      // fails — that is the intermittent outage this gate exists to catch, not
      // a wobble to annotate and wave through.
      if (healthy * 2 > SAMPLE_COUNT) return;

      // Under the threshold. Before blocking a promotion, check whether the
      // same database is failing for production too — several beta hosts share
      // one with their production twin, and promoting this build changes
      // nothing about a database both lanes already sit on.
      const production = productionHostFor(site);
      const prodSamples: HealthSample[] = [];
      for (let attempt = 1; attempt <= SAMPLE_COUNT; attempt += 1) {
        prodSamples.push(await sample(production));
        if (attempt < SAMPLE_COUNT) {
          await new Promise((r) => setTimeout(r, 1_500));
        }
      }
      const prodHealthy = prodSamples.filter(isHealthy).length;

      // The waiver requires both halves: the two lanes must actually be on the
      // same database, and production must be degraded at least as badly.
      // Without the first, an isolated beta database could be waived by an
      // unrelated production wobble; without the second, a total beta outage
      // could be waived by a single bad production sample.
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
      // 401 means the endpoint is configured and closed. 503 means no
      // A2A_SECRET is set, so the app cannot receive delegated work at all —
      // a silent loss of every cross-app journey into this host.
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

      // Not 401. Before failing the promotion gate, check whether production
      // is in the same state: this suite answers "would promoting make things
      // worse", and a condition production already has is not a reason to hold
      // the release. It is still reported, as an annotation and in the
      // advisory lane.
      const production = productionHostFor(site);
      const prodResult = await a2aProbe(production);
      const prodStatus =
        prodResult.kind === "responded" ? prodResult.status : undefined;

      // Status alone is not the same failure: a 503 for "no A2A_SECRET
      // configured" and a 503 from an overloaded host read identically. The
      // JSON-RPC error code and message are what say *why*, so the waiver
      // compares those.
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
        timeout: 90_000,
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

      // The reported loop: land on sign-in, then get thrown around again.
      const settled = page.url();
      await page.waitForTimeout(6_000);
      expect(
        page.url(),
        `${site.host} kept redirecting after settling on ${settled} — this is the sign-in loop users reported`,
      ).toBe(settled);
    });

    test("loads its landing page without uncaught client errors", async ({
      page,
    }) => {
      const { errors, thirdParty } = collectAppPageErrors(page, origin);
      const failedRequests: string[] = [];
      page.on("requestfailed", (request) => {
        const failure = request.failure()?.errorText ?? "unknown";
        // Analytics/telemetry beacons blocked in CI are not app failures.
        if (/aborted/i.test(failure)) return;
        if (!request.url().startsWith(origin)) return;
        failedRequests.push(`${request.url()} (${failure})`);
      });

      await page.goto(`${origin}/`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await page.waitForTimeout(5_000);

      if (thirdParty.length > 0) {
        test.info().annotations.push({
          type: "third-party-noise",
          description: `${site.host}: ${[...new Set(thirdParty)].join("; ")}`,
        });
      }
      expect(
        errors,
        `${site.host} threw uncaught errors from its own code while rendering its landing page`,
      ).toEqual([]);
      expect(
        failedRequests,
        `${site.host} landing page had failed same-origin subresource requests`,
      ).toEqual([]);
    });
  });
}
