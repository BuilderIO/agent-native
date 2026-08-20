import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import { authenticatableSites, originFor } from "../lib/fleet";

/**
 * Signed-in checks that spend no model tokens.
 *
 * This is where a cross-app problem shows up cheaply. "Slides isn't connected
 * to Analytics anymore" is a discovery-and-reachability failure, and reading
 * the registry answers it in a second — whereas finding out through a real
 * delegated turn costs a minute and a few thousand tokens.
 */

skipUnlessAuthed();

const sites = authenticatableSites();

test.describe.configure({ mode: "parallel" });

interface DiscoveredAgent {
  id?: string;
  name?: string;
  url?: string;
}

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} registry`, () => {
    test("is signed in as the e2e identity on the beta build", async ({
      browser,
    }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
      } finally {
        await context.close();
      }
    });

    test("can reach its own authenticated surfaces", async ({ browser }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}/`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const results = await page.evaluate(async () => {
          const paths = [
            "/_agent-native/poll",
            "/_agent-native/agent-engine/status",
          ];
          const out: { path: string; status: number }[] = [];
          for (const path of paths) {
            const response = await fetch(path, {
              headers: { accept: "application/json" },
            });
            out.push({ path, status: response.status });
          }
          return out;
        });

        // Assert on what success looks like, not on the absence of one status:
        // filtering for 401 alone made a 500 or a 404 indistinguishable from a
        // working surface.
        const bad = results.filter((r) => r.status < 200 || r.status >= 400);
        expect(
          bad.map((r) => `${r.path} -> HTTP ${r.status}`),
          `${site.host} did not serve a signed-in caller. A 401 means the session is not honoured by the action surface; a 5xx means the surface itself is failing.`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test("discovers peer agents and reports where they point", async ({
      browser,
    }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}/`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const discovery = await page.evaluate(async (appId) => {
          const response = await fetch(
            `/_agent-native/agents?selfAppId=${encodeURIComponent(appId)}`,
            { headers: { accept: "application/json" } },
          );
          return { status: response.status, body: await response.text() };
        }, site.id);

        expect(
          discovery.status,
          `${site.host} agent discovery returned HTTP ${discovery.status}: ${discovery.body.slice(0, 200)}`,
        ).toBe(200);

        const parsed = JSON.parse(discovery.body) as
          | DiscoveredAgent[]
          | { agents?: DiscoveredAgent[] };
        const agents = Array.isArray(parsed) ? parsed : (parsed.agents ?? []);

        expect(
          agents.length,
          `${site.host} discovered no peer agents at all, so every cross-app request from this app would fail`,
        ).toBeGreaterThan(0);

        // Peers resolve through the first-party template registry, which is
        // hardcoded to production URLs — a beta app delegates to production
        // peers. Record it per run so the A2A results are read correctly, and
        // so the day it changes is visible.
        const lanes = agents.map(
          (agent) => `${agent.id ?? agent.name ?? "?"} -> ${agent.url ?? "?"}`,
        );
        test.info().annotations.push({
          type: "a2a-peers",
          description: `${site.id}: ${lanes.join(", ")}`,
        });

        // A peer pointing at localhost can never be reached from a deployed
        // host; the call fails instantly with a transport error.
        const localhostPeers = agents.filter((agent) =>
          /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(
            agent.url ?? "",
          ),
        );
        expect(
          localhostPeers.map((agent) => `${agent.id}: ${agent.url}`),
          `${site.host} has peer agents registered at localhost, which a deployed host can never reach`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}
