import { expect, test } from "@playwright/test";

import { renderedText } from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  authenticatableSites,
  authenticatedEntryPath,
  originFor,
} from "../../lib/fleet";
import {
  probeFromPage,
  visibleText,
  waitForComposer,
  type ApiProbe,
} from "../../lib/journey-browser";
import { diagnoseCredentialState } from "../../lib/journey-checks";

/**
 * Credential and credits state: the UI must tell the same story as the
 * server about whether this account can run AI.
 *
 * "Builder credits are used up / Upgrade plan" shown to an organization whose
 * Builder connection is healthy, "no keys connected", and "Connect Builder"
 * loops were reported on 9/27, 9/29, 9/30 and 10/1 (Slack
 * #product-agent-native-feedback; Tim's false "credits used up" traced to an
 * activation flow replacing the org's connection). The same fact is derived in
 * four places, so any one can disagree with the rest. This reads all of them
 * on each app's entry page and fails on a contradiction.
 *
 * No model turn, and read-only: nothing here writes app data.
 */

skipUnlessAuthed();

/** Apps where the chat lane has installed an AI provider for the e2e account. */
const COMPOSER_REQUIRED = new Set([
  "chat",
  "slides",
  "analytics",
  "content",
  "dispatch",
]);

const sites = authenticatableSites();

test.describe.configure({ mode: "parallel" });

function jsonRecord(probe: ApiProbe): Record<string, unknown> | null {
  return probe.parsed && probe.json && typeof probe.json === "object"
    ? (probe.json as Record<string, unknown>)
    : null;
}

for (const site of sites) {
  test(`[journey] [credentials] ${site.id} shows no false credits or connect blocker beside a usable composer`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      await page.goto(
        `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
        { waitUntil: "domcontentloaded", timeout: 90_000 },
      );
      await renderedText(page, `${site.host} entry page`);

      // Apps that should have a composer get time for it to enable; the rest
      // only need the time it takes to show that they have none.
      const composer = await waitForComposer(
        page,
        COMPOSER_REQUIRED.has(site.id) ? 45_000 : 12_000,
      );
      const [builder, engine, credit] = await probeFromPage(page, [
        "/_agent-native/connection-status/builder",
        "/_agent-native/agent-engine/status",
        "/_agent-native/actions/get-builder-credit-status",
      ]);
      const text = await visibleText(page);

      const apiProblems: string[] = [];
      for (const probe of [builder, engine]) {
        if (probe.status !== 200) {
          apiProblems.push(
            `${probe.path} answered HTTP ${probe.status}: ${probe.text.slice(0, 200)}`,
          );
        }
      }
      if (credit.status !== 200 && credit.status !== 404) {
        apiProblems.push(
          `${credit.path} answered HTTP ${credit.status}: ${credit.text.slice(0, 200)}`,
        );
      }

      const engineBody = engine.status === 200 ? jsonRecord(engine) : null;
      const engineConfigured =
        typeof engineBody?.configured === "boolean"
          ? engineBody.configured
          : null;
      // The action answers `null` when no Builder connection reports credits.
      const creditBody =
        credit.status === 200 && credit.parsed
          ? credit.json === null
            ? { exhausted: false }
            : jsonRecord(credit)
          : null;
      const creditExhausted =
        typeof creditBody?.exhausted === "boolean"
          ? creditBody.exhausted
          : null;
      const builderBody = builder.status === 200 ? jsonRecord(builder) : null;

      const summary = {
        app: site.id,
        url: page.url(),
        composer: composer.state,
        composerDetail: composer.detail,
        builderConfigured: builderBody?.configured ?? null,
        builderEffective: builderBody?.effective ?? null,
        engineConfigured,
        engine: engineBody?.engine ?? null,
        creditExhausted,
        creditState: creditBody?.state ?? null,
      };
      test.info().annotations.push({
        type: "credential-state",
        description: JSON.stringify(summary),
      });

      const problems = [
        ...apiProblems,
        ...diagnoseCredentialState({
          app: site.id,
          composer: composer.state,
          visibleText: text,
          engineConfigured,
          creditExhausted,
          composerRequired: COMPOSER_REQUIRED.has(site.id),
        }),
      ];
      expect(
        problems,
        `${site.host} (${page.url()}) tells contradictory stories about whether the e2e account can run AI:\n- ${problems.join("\n- ")}\nEvidence: ${JSON.stringify(summary)}`,
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
