#!/usr/bin/env node
/**
 * One-time session capture for the beta E2E suite.
 *
 * CI cannot sign in: beta hosts accept Google OAuth only, and an automated run
 * must never drive a credential form. So a human signs in once, here, in a
 * visible browser, and this prints the secret CI replays.
 *
 * Usage:
 *   pnpm e2e:beta:capture                 # every authenticatable beta app
 *   pnpm e2e:beta:capture slides,chat     # just these
 *
 * For each app it opens the real sign-in page, waits for you to complete
 * Google sign-in, then reads back the framework session cookie that host
 * issued. The result is a JSON map to paste into the BETA_E2E_SESSION_TOKENS
 * repository secret.
 *
 * These tokens are framework sessions for whichever account you sign in with.
 * They last 30 days, they are as powerful as being logged in as that account,
 * and they belong in a secret store, never in the repo. Prefer a dedicated
 * e2e account over a personal one — then `BETA_E2E_EMAIL` is that account and
 * every authenticated spec asserts it is running as exactly that identity.
 */
import { chromium } from "@playwright/test";

import { authenticatableSites, originFor, siteById } from "./lib/fleet";

const SESSION_COOKIE = /^an_session/;

/**
 * Pull the email out of a session response.
 *
 * Returns the reason it could not, rather than `undefined` for both "the host
 * said not-authenticated" and "the host answered something unparseable" — the
 * operator needs to tell those apart to know whether to sign in again or look
 * at the host.
 */
function parseSessionEmail(
  body: string,
): { email: string } | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      reason: `the host answered with a non-JSON body: ${body.slice(0, 160)}`,
    };
  }
  const email = (parsed as { email?: unknown } | null)?.email;
  if (typeof email === "string" && email.trim()) return { email: email.trim() };
  return {
    reason: `the host did not resolve the session: ${body.slice(0, 160)}`,
  };
}

function requestedSites() {
  const arg = process.argv[2]?.trim();
  if (!arg || arg === "all") return authenticatableSites();
  return arg
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map(siteById);
}

async function capture(): Promise<void> {
  const sites = requestedSites();
  const browser = await chromium.launch({ headless: false });
  const tokens: Record<string, string> = {};
  let email: string | undefined;

  console.log(
    `\nCapturing beta sessions for: ${sites.map((s) => s.id).join(", ")}\n` +
      "A browser window will open for each app. Sign in with the account this\n" +
      "suite should run as, then leave the window alone — capture is automatic.\n",
  );

  try {
    for (const site of sites) {
      const origin = originFor(site);
      // A fresh context per app: these are host-scoped sessions, and reusing
      // one jar would make it impossible to tell which host actually issued
      // a cookie.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${origin}/sign-in`, { waitUntil: "domcontentloaded" });

      console.log(`[${site.id}] waiting for sign-in at ${origin} …`);

      const deadline = Date.now() + 5 * 60_000;
      let token: string | undefined;
      while (Date.now() < deadline && !token) {
        await page.waitForTimeout(2_000);
        const cookie = (await context.cookies()).find(
          (candidate) =>
            SESSION_COOKIE.test(candidate.name) && candidate.value.length > 10,
        );
        if (cookie) token = cookie.value;
      }

      if (!token) {
        console.error(
          `[${site.id}] no session cookie appeared within 5 minutes — skipped.`,
        );
        await context.close();
        continue;
      }

      const session = await page.evaluate(async () => {
        const response = await fetch("/_agent-native/auth/session", {
          headers: { accept: "application/json" },
        });
        return response.text();
      });
      const resolved = parseSessionEmail(session);

      if ("reason" in resolved) {
        console.error(
          `[${site.id}] a session cookie was set but ${resolved.reason} — skipped.`,
        );
        await context.close();
        continue;
      }

      if (email && email !== resolved.email) {
        console.error(
          `[${site.id}] signed in as ${resolved.email} but a previous app captured ${email}. Use one account for the whole suite.`,
        );
      }
      email ??= resolved.email;
      tokens[site.id] = token;
      console.log(`[${site.id}] captured session for ${resolved.email}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const captured = Object.keys(tokens);
  if (captured.length === 0) {
    console.error("\nNo sessions captured. Nothing to write.");
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      "",
      "─".repeat(72),
      `Captured ${captured.length} session(s): ${captured.join(", ")}`,
      "",
      "Set these as repository secrets (Settings → Secrets and variables → Actions):",
      "",
      `  BETA_E2E_EMAIL`,
      `    ${email}`,
      "",
      `  BETA_E2E_SESSION_TOKENS`,
      `    ${JSON.stringify(tokens)}`,
      "",
      "These expire after 30 days. Re-run this command to refresh them.",
      "─".repeat(72),
      "",
    ].join("\n"),
  );
}

capture().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
