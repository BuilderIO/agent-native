import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import { authenticatableSites, originFor } from "../lib/fleet";

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
          timeout: 45_000,
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
          timeout: 45_000,
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

        const lanes = agents.map(
          (agent) => `${agent.id ?? agent.name ?? "?"} -> ${agent.url ?? "?"}`,
        );
        test.info().annotations.push({
          type: "a2a-peers",
          description: `${site.id}: ${lanes.join(", ")}`,
        });

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
