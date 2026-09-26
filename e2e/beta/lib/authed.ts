import { existsSync } from "node:fs";

import { test, type Browser, type BrowserContext } from "@playwright/test";

import { seedModelSelection } from "./chat";
import { authenticatedEntryPath, type BetaSite, originFor } from "./fleet";
import {
  authStatePath,
  authedLaneReady,
  expectedEmail,
  sessionFailureReason,
} from "./session";
import {
  BETA_E2E_TEST_TRAFFIC_HEADERS,
  installBetaE2ETrafficMarker,
} from "./test-traffic";

export function authedLaneEnabled(): boolean {
  return authedLaneReady();
}

export function skipUnlessAuthed(): void {
  test.skip(
    !authedLaneEnabled(),
    "authenticated lane not requested (set session credentials; chat also needs BETA_E2E_OPENAI_API_KEY, or BETA_E2E_AUTHED=1)",
  );
}

export async function signedInContext(
  browser: Browser,
  site: BetaSite,
  { seedModel = true }: { seedModel?: boolean } = {},
): Promise<BrowserContext> {
  const statePath = authStatePath(site.id);
  if (!existsSync(statePath)) {
    throw new Error(
      `No stored session for ${site.id} at ${statePath}. Global setup should have created it; running this spec signed out would assert nothing.`,
    );
  }
  const context = await browser.newContext({
    storageState: statePath,
    extraHTTPHeaders: BETA_E2E_TEST_TRAFFIC_HEADERS,
  });
  await installBetaE2ETrafficMarker(context);
  if (seedModel) {
    const namespaces =
      site.id === "chat" || site.id === "analytics" || site.id === "dispatch"
        ? [site.id]
        : [];
    await seedModelSelection(context, undefined, namespaces);
  }
  return context;
}

export async function assertSignedInOnBeta(
  context: BrowserContext,
  site: BetaSite,
): Promise<void> {
  const origin = originFor(site);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}${authenticatedEntryPath(site)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const session = await page.evaluate(async () => {
      const response = await fetch("/_agent-native/auth/session", {
        headers: { accept: "application/json" },
      });
      return { status: response.status, body: await response.text() };
    });

    let email: string | undefined;
    try {
      email = (JSON.parse(session.body) as { email?: string }).email;
    } catch {
      email = undefined;
    }

    if (!email) {
      throw new Error(
        `${site.host} does not consider this context signed in (HTTP ${session.status}: ${session.body.slice(0, 200)}). ${sessionFailureReason({ status: session.status, body: session.body, tokenProvided: false })}`,
      );
    }
    const expected = expectedEmail();
    if (email.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${site.host} resolved this session to ${email}, not ${expected}.`,
      );
    }

    if (new URL(page.url()).hostname !== site.host) {
      throw new Error(
        `Expected to be on ${site.host} but landed on ${page.url()}. A @builder.io identity on a production host is redirected to beta automatically; this run must stay on beta deliberately, not by accident.`,
      );
    }
  } finally {
    await page.close();
  }
}

export function runMarker(label: string): string {
  const run =
    process.env.GITHUB_RUN_ID ??
    `local-${Date.now().toString(36)}-${process.pid}`;
  return `beta-e2e ${label} ${run}`;
}
