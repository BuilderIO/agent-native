import { existsSync } from "node:fs";

import { test, type Browser, type BrowserContext } from "@playwright/test";

import { seedModelSelection } from "./chat";
import { type BetaSite, originFor } from "./fleet";
import { authStatePath, authedLaneReady, expectedEmail } from "./session";

/**
 * Shared setup for the authenticated lane.
 *
 * Sessions are established once, in global setup, and stored per app. A spec
 * that finds no stored session must stop the run rather than continue signed
 * out: an authenticated assertion evaluated against an anonymous page is not a
 * weaker test, it is a false one.
 */

export function authedLaneEnabled(): boolean {
  return authedLaneReady();
}

/**
 * Skip the whole file when this run was never asked to authenticate.
 *
 * Deliberately narrow: it skips on "not requested", never on "requested but
 * broken" — global setup throws for that, before any spec runs.
 */
export function skipUnlessAuthed(): void {
  test.skip(
    !authedLaneEnabled(),
    "authenticated lane not requested (set BETA_E2E_SESSION_TOKENS and BETA_E2E_OPENAI_API_KEY, or BETA_E2E_AUTHED=1)",
  );
}

/** A browser context signed in as the e2e identity for one beta app. */
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
  const context = await browser.newContext({ storageState: statePath });
  if (seedModel) await seedModelSelection(context);
  return context;
}

/**
 * Confirm the page is signed in as the expected identity and is on the beta
 * build, before any assertion depends on either.
 *
 * The lane check matters because a Builder.io address on a production host is
 * redirected to beta automatically; without it a run could report on whichever
 * build it happened to land on.
 */
export async function assertSignedInOnBeta(
  context: BrowserContext,
  site: BetaSite,
): Promise<void> {
  const origin = originFor(site);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
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
        `${site.host} does not consider this context signed in (HTTP ${session.status}: ${session.body.slice(0, 200)}). The stored session has probably expired — re-run \`pnpm e2e:beta:capture\`.`,
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

/** A marker that ties fixtures created by this run back to it. */
export function runMarker(label: string): string {
  const run =
    process.env.GITHUB_RUN_ID ??
    `local-${Date.now().toString(36)}-${process.pid}`;
  return `beta-e2e ${label} ${run}`;
}
