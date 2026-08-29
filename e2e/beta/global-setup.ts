import { chromium } from "@playwright/test";

import {
  authenticatableSites,
  chatSites,
  originFor,
  selectedSites,
} from "./lib/fleet";
import { warm } from "./lib/http";
import {
  installOpenAiKey,
  resolveOpenAiKey,
  validateOpenAiKey,
} from "./lib/provider-key";
import {
  authStatePath,
  bootstrapAppSession,
  clearAuthedLaneMarker,
  expectedEmail,
  hasSessionCredentials,
  markAuthedLaneReady,
  missingCredentialsMessage,
} from "./lib/session";
import {
  BETA_E2E_TEST_TRAFFIC_HEADERS,
  installBetaE2ETrafficMarker,
} from "./lib/test-traffic";

function providerKeyRequired(): boolean {
  return process.env.BETA_E2E_CLUSTER?.trim().toLowerCase() === "chat";
}

/**
 * Prepare the run.
 *
 * Two jobs: warm every host so a cold start does not read as a failure, and —
 * when the authenticated lane is in play — establish one signed-in session per
 * app and, for the chat cluster, install the dedicated OpenAI key against it.
 *
 * The authenticated lane either works or the run stops here. Degrading to an
 * anonymous session would leave every authed assertion passing against a
 * signed-out app, which is worse than no coverage because it reads as proof.
 */

export function authedLaneRequested(): boolean {
  const explicit = process.env.BETA_E2E_AUTHED?.trim().toLowerCase();
  if (explicit === "0" || explicit === "false") return false;
  if (explicit === "1" || explicit === "true") return true;
  // Unset: run the authed lane when a credential was supplied.
  return hasSessionCredentials();
}

async function globalSetup(): Promise<void> {
  // Clear first: a marker left by a previous run would let this run's specs
  // believe they are authenticated when they are not.
  clearAuthedLaneMarker();

  const sites = selectedSites();
  console.log(
    `[beta-e2e] fleet: ${sites.map((site) => site.id).join(", ")} (${sites.length} host(s))`,
  );

  console.log("[beta-e2e] warming hosts…");
  // Modest concurrency: a burst large enough to look like a flood gets
  // throttled at the edge, and a throttled probe is indistinguishable from a
  // down host unless we avoid causing it.
  const queue = [...sites];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let site = queue.shift(); site; site = queue.shift()) {
        await warm(originFor(site));
      }
    }),
  );

  if (!authedLaneRequested()) {
    console.log(
      "[beta-e2e] authenticated lane not requested — running the public sweep only.",
    );
    return;
  }

  if (!hasSessionCredentials()) throw new Error(missingCredentialsMessage());

  const email = expectedEmail();
  const needsProviderKey = providerKeyRequired();
  const resolvedKey = needsProviderKey ? resolveOpenAiKey() : undefined;
  if (needsProviderKey && !resolvedKey) {
    throw new Error(
      [
        "The authenticated lane was requested but no OpenAI credential was supplied.",
        "Agent turns would then bill whatever credential the e2e account happens to inherit, which is exactly what a dedicated key exists to prevent.",
        "Either set the BETA_E2E_OPENAI_API_KEY repository secret (a key created for this suite, with its own spend limit),",
        "or re-run the workflow with key_source=shared to bill the repository's shared OPENAI_API_KEY instead,",
        "or pass BETA_E2E_AUTHED=0 to run the public sweep only.",
      ].join("\n"),
    );
  }
  const apiKey = resolvedKey?.key;
  if (resolvedKey?.source === "shared") {
    console.warn(
      "[beta-e2e] billing the SHARED OPENAI_API_KEY. This run's agent-turn spend is pooled with every other consumer of that key and cannot be attributed to the suite. Create BETA_E2E_OPENAI_API_KEY to separate it.",
    );
  } else if (resolvedKey) {
    console.log("[beta-e2e] billing the dedicated BETA_E2E_OPENAI_API_KEY.");
  }

  if (apiKey) await validateOpenAiKey(apiKey);

  const targets = authenticatableSites();
  if (targets.length === 0) {
    throw new Error(
      `The authenticated lane was requested but the app selection (${selectedSites()
        .map((site) => site.id)
        .join(
          ", ",
        )}) contains no app this suite can sign in to. Google-only apps (mail, calendar) are excluded from authenticated runs; pick at least one other app or pass BETA_E2E_AUTHED=0.`,
    );
  }
  console.log(
    `[beta-e2e] establishing sessions as ${email} on: ${targets.map((site) => site.id).join(", ")}`,
  );

  // The key is written only where a turn will actually run. Every install is a
  // durable write to the e2e account's credential vault on that host — and for
  // most beta apps that vault lives in the production database — so writing it
  // to hosts this run will never prompt is avoidable damage.
  const needsKey = new Set(chatSites().map((site) => site.id));

  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    for (const site of targets) {
      const origin = originFor(site);
      try {
        const identity = await bootstrapAppSession(browser, site);

        if (needsProviderKey && needsKey.has(site.id)) {
          const context = await browser.newContext({
            storageState: authStatePath(site.id),
            extraHTTPHeaders: BETA_E2E_TEST_TRAFFIC_HEADERS,
          });
          await installBetaE2ETrafficMarker(context);
          try {
            if (!apiKey) {
              throw new Error("No validated OpenAI credential is available.");
            }
            const install = await installOpenAiKey(context, origin, apiKey);
            if (!install.installed) {
              failures.push(
                `${site.id}: signed in as ${identity.email} but the dedicated OpenAI key was rejected (HTTP ${install.status}). Turns here would bill an unintended credential.`,
              );
              continue;
            }
          } finally {
            await context.close();
          }
        }

        console.log(
          `[beta-e2e]   ${site.id}: session ok as ${identity.email}${needsProviderKey && needsKey.has(site.id) ? `, ${resolvedKey?.source} OpenAI key installed` : ""}`,
        );
      } catch (error) {
        failures.push(
          `${site.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    throw new Error(
      `[beta-e2e] authenticated setup failed for ${failures.length} of ${targets.length} host(s):\n${failures.join("\n\n")}`,
    );
  }

  markAuthedLaneReady();
}

export default globalSetup;
