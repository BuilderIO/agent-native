import { expect, test, type Page } from "@playwright/test";

import { isQaTestEmail } from "../../../packages/core/src/shared/qa-test-email";
import { collectAppPageErrors, renderedText } from "../../beta/lib/app";
import {
  createQaEmail,
  verificationLinkFor,
  waitForVerificationEmail,
} from "../lib/mailosaur";
import { selectedSignupTargets } from "../lib/targets";

interface SessionResult {
  status: number;
  body: unknown;
}

/**
 * Read a session endpoint from inside the page.
 *
 * The verification link lands through redirects and some apps then navigate
 * again client-side - clips goes "/" to "/library". An evaluate that starts
 * before that settles dies with "Execution context was destroyed", which is
 * this harness losing its footing, not the app failing to sign the user in.
 * Retrying only that error keeps a real signed-out session a failure.
 */
async function readJson(page: Page, path: string): Promise<SessionResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("domcontentloaded");
    try {
      return await page.evaluate(async (target): Promise<SessionResult> => {
        const response = await fetch(target, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const raw = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        return { status: response.status, body };
      }, path);
    } catch (error) {
      if (!/Execution context was destroyed/i.test(String(error))) throw error;
      lastError = error;
      await page.waitForTimeout(1_000);
    }
  }
  throw new Error(
    `${path} could not be read: the page kept navigating across 3 attempts. Last error: ${String(lastError)}`,
  );
}

async function readSession(page: Page) {
  return readJson(page, "/_agent-native/auth/session");
}

async function readBetterAuthSession(page: Page) {
  return readJson(page, "/_agent-native/auth/ba/get-session");
}

function assertSession(session: SessionResult, email: string, label: string) {
  expect(session.status, `${label} returned HTTP ${session.status}`).toBe(200);
  expect(
    (session.body as { email?: unknown }).email,
    `${label} did not identify the canary account`,
  ).toBe(email);
}

function assertBetterAuthSession(
  session: SessionResult,
  email: string,
  label: string,
) {
  expect(session.status, `${label} returned HTTP ${session.status}`).toBe(200);
  expect(
    (session.body as { user?: { email?: unknown } }).user?.email,
    `${label} did not identify the canary account`,
  ).toBe(email);
}

const targets = selectedSignupTargets();

for (const target of targets) {
  test(`${target.environment} ${target.app} completes email signup without a refresh`, async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const { errors, thirdParty } = collectAppPageErrors(page, target.origin);
    const failedRequests: string[] = [];
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "unknown";
      if (
        /aborted/i.test(failure) ||
        !request.url().startsWith(target.origin)
      ) {
        return;
      }
      failedRequests.push(`${request.url()} (${failure})`);
    });

    const email = createQaEmail(target.app, target.environment);
    expect(
      isQaTestEmail(email),
      `${email} must be suppressed by tracking`,
    ).toBe(true);
    const signInUrl = `${target.origin}/sign-in?signup_e2e=${Date.now()}`;
    const emailRequestedAt = Date.now() - 5_000;
    const magicLinkStatuses: number[] = [];
    page.on("response", (response) => {
      const request = response.request();
      if (
        request.method() === "POST" &&
        new URL(response.url()).pathname === "/_agent-native/auth/magic-link"
      ) {
        magicLinkStatuses.push(response.status());
      }
    });

    await test.step("open the real sign-in page", async () => {
      const response = await page.goto(signInUrl, {
        waitUntil: "domcontentloaded",
      });
      expect(response, `${signInUrl} produced no response`).toBeTruthy();
      expect(response!.status(), `${signInUrl} returned an error`).toBeLessThan(
        400,
      );
      await renderedText(page, signInUrl);
      await expect(page.locator("#magic-link-form")).toBeVisible();
    });

    await test.step("request a fresh magic link", async () => {
      const emailPromise = waitForVerificationEmail(email, emailRequestedAt);
      await page.locator("#m-email").fill(email);
      await page.locator("#magic-link-submit").click({ noWaitAfter: true });
      await expect(page.locator("#magic-link-success")).toBeVisible();
      await expect(page.locator("#magic-link-success-email")).toHaveText(email);
      expect(
        magicLinkStatuses,
        "magic-link request was not observed",
      ).not.toEqual([]);
      expect(magicLinkStatuses.at(-1)).toBe(200);
      const message = await emailPromise;

      await test.step("use the secure same-origin link from the inbox", async () => {
        const verificationLink = verificationLinkFor(message, target.origin);
        const response = await page.goto(verificationLink, {
          waitUntil: "domcontentloaded",
        });
        expect(
          response,
          `${target.app} verification produced no response`,
        ).toBeTruthy();
        expect(
          response!.status(),
          `${target.app} verification returned an error`,
        ).toBeLessThan(400);
        expect(new URL(page.url()).origin).toBe(target.origin);
        expect(new URL(page.url()).pathname).not.toMatch(/sign-in|login/i);
      });
    });

    await test.step("prove the session works before any refresh", async () => {
      assertSession(
        await readSession(page),
        email,
        `${target.app} immediate session`,
      );
      assertBetterAuthSession(
        await readBetterAuthSession(page),
        email,
        `${target.app} immediate Better Auth session`,
      );
    });

    await test.step("prove the session survives a browser refresh", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(() => new URL(page.url()).pathname)
        .not.toMatch(/sign-in|login/i);
      assertSession(
        await readSession(page),
        email,
        `${target.app} refreshed session`,
      );
      assertBetterAuthSession(
        await readBetterAuthSession(page),
        email,
        `${target.app} refreshed Better Auth session`,
      );
    });

    if (thirdParty.length > 0) {
      test.info().annotations.push({
        type: "third-party-noise",
        description: [...new Set(thirdParty)].join("; "),
      });
    }
    expect(
      errors,
      `${target.origin} threw an uncaught error during signup`,
    ).toEqual([]);
    expect(
      failedRequests,
      `${target.origin} had failed same-origin requests during signup`,
    ).toEqual([]);
  });
}
