import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

import { isQaTestEmail } from "../../../packages/core/src/shared/qa-test-email";
import { collectAppPageErrors, renderedText } from "../../beta/lib/app";
import {
  BETA_E2E_TEST_TRAFFIC_HEADERS,
  installBetaE2ETrafficMarker,
} from "../../beta/lib/test-traffic";
import {
  createQaEmail,
  isMailosaurInconclusiveError,
  verificationLinkFor,
  waitForVerificationEmail,
} from "../lib/mailosaur";
import { selectedSignupTargets } from "../lib/targets";

interface SessionResult {
  status: number;
  body: unknown;
}

async function readJson(page: Page, path: string): Promise<SessionResult> {
  const response = await page
    .context()
    .request.get(new URL(path, page.url()).toString(), {
      headers: { Accept: "application/json" },
      timeout: 60_000,
    });
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: response.status(), body };
}

async function readSession(page: Page) {
  return readJson(page, "/_agent-native/auth/session");
}

async function readBetterAuthSession(page: Page) {
  return readJson(page, "/_agent-native/auth/ba/get-session");
}

function assertSession(session: SessionResult, email: string, label: string) {
  expect(
    session.status,
    `${label} returned HTTP ${session.status}: ${JSON.stringify(session.body).slice(0, 500)}`,
  ).toBe(200);
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
  expect(
    session.status,
    `${label} returned HTTP ${session.status}: ${JSON.stringify(session.body).slice(0, 500)}`,
  ).toBe(200);
  expect(
    (session.body as { user?: { email?: unknown } }).user?.email,
    `${label} did not identify the canary account`,
  ).toBe(email);
}

async function waitForApplicationReady(page: Page, app: string) {
  await expect
    .poll(
      async () => {
        const appIsInert =
          (await page.locator('[data-first-run-app-inert="true"]').count()) > 0;
        const onboardingIsVisible =
          (await page
            .locator("[data-onboarding-screen], [data-onboarding-loading]")
            .count()) > 0;
        return !appIsInert || onboardingIsVisible;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  if (app === "chat") {
    const composer = page.getByRole("textbox", { name: "Message agent" });
    await expect(composer).toBeVisible();
    await expect(composer).toBeEditable();
  }
}

const targets = selectedSignupTargets();

function recordMailosaurInconclusive(
  testInfo: TestInfo,
  message: string,
): void {
  const marker = testInfo.outputPath("mailosaur-inconclusive.txt");
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${message}\n`, "utf8");
}

for (const target of targets) {
  test(`${target.environment} ${target.app} completes email signup without a refresh`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(360_000);
    await page.context().setExtraHTTPHeaders(BETA_E2E_TEST_TRAFFIC_HEADERS);
    await installBetaE2ETrafficMarker(page.context());
    const failedRequests: string[] = [];
    const observePage = (observedPage: Page) => {
      const diagnostics = collectAppPageErrors(observedPage, target.origin);
      observedPage.on("requestfailed", (request) => {
        const failure = request.failure()?.errorText ?? "unknown";
        if (
          /aborted/i.test(failure) ||
          !request.url().startsWith(target.origin)
        ) {
          return;
        }
        failedRequests.push(`${request.url()} (${failure})`);
      });
      return diagnostics;
    };
    const initialPageDiagnostics = observePage(page);

    const email = createQaEmail(target.app, target.environment);
    expect(
      isQaTestEmail(email),
      `${email} must be suppressed by tracking`,
    ).toBe(true);
    // Use the same browser cookie jar as signup: observe the real assignment
    // without forcing treatment or creating extra accounts to change the split.
    let automaticBuilderSignup = false;
    if (["design", "clips", "slides"].includes(target.app)) {
      const assignment = await readJson(
        page,
        `${target.origin}/_agent-native/auth/builder-signup-experiment`,
      );
      const body = assignment.body as {
        status?: string;
        variant?: string;
      };
      expect(
        assignment.status,
        "Builder signup assignment request failed",
      ).toBe(200);
      expect(["assigned", "disabled"]).toContain(body.status);
      if (body.status === "assigned") {
        expect(["control", "automatic"]).toContain(body.variant);
      }
      automaticBuilderSignup =
        body.status === "assigned" && body.variant === "automatic";
      testInfo.annotations.push({
        type: "builder-signup-variant",
        description: automaticBuilderSignup
          ? "automatic"
          : "control-or-disabled",
      });
    }

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
      const authData = await page
        .locator("#agent-native-auth-data")
        .textContent();
      const authMode = authData
        ? (JSON.parse(authData) as { authMode?: string }).authMode
        : undefined;
      expect(
        authMode,
        `${signInUrl} rendered authMode=${authMode ?? "unknown"}. Magic-link ` +
          "signup is unavailable because this deployment has no RESEND_API_KEY " +
          "or SENDGRID_API_KEY (+EMAIL_FROM) configured — fix the site's email " +
          "provider env, not this assertion.",
      ).toBe("magic-link");
      await expect(page.locator("#magic-link-form")).toBeVisible();
    });

    const message = await test.step("request a fresh magic link", async () => {
      const emailResult = waitForVerificationEmail(
        email,
        emailRequestedAt,
      ).then(
        (message) => ({ status: "fulfilled" as const, message }),
        (error) => ({ status: "rejected" as const, error }),
      );
      await page.locator("#m-email").fill(email);
      await page.locator("#magic-link-submit").click({ noWaitAfter: true });
      await expect(page.locator("#magic-link-success")).toBeVisible();
      await expect(page.locator("#magic-link-success-email")).toHaveText(email);
      expect(
        magicLinkStatuses,
        "magic-link request was not observed",
      ).not.toEqual([]);
      expect(magicLinkStatuses.at(-1)).toBe(200);

      const result = await emailResult;
      if (result.status === "rejected") {
        if (isMailosaurInconclusiveError(result.error)) {
          recordMailosaurInconclusive(testInfo, result.error.message);
          testInfo.skip(true, `INCONCLUSIVE: ${result.error.message}`);
          return null;
        }
        throw result.error;
      }
      return result.message;
    });
    if (!message) return;

    const verificationStartedAt = Date.now();
    const verificationPage = await page.context().newPage();
    const verificationPageDiagnostics = observePage(verificationPage);
    await test.step("use the secure same-origin link from the inbox", async () => {
      const verificationLink = verificationLinkFor(message, target.origin);
      const response = await verificationPage.goto(verificationLink, {
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
      expect(new URL(verificationPage.url()).origin).toBe(target.origin);
      const continueButton = verificationPage.locator(
        'form button[type="submit"]',
      );
      await expect(
        continueButton,
        `${target.app} emailed link did not stop at the scanner-safe confirmation page`,
      ).toBeVisible();
      await continueButton.click();
      await expect
        .poll(() => new URL(verificationPage.url()).pathname)
        .not.toContain("/_agent-native/auth/email-link/landing");
      expect(new URL(verificationPage.url()).pathname).not.toMatch(
        /sign-in|login/i,
      );
    });

    if (automaticBuilderSignup) {
      await test.step("confirm automatic Builder connection after verified signup", async () => {
        await expect
          .poll(
            async () => {
              const connection = await readJson(
                verificationPage,
                "/_agent-native/connection-status/builder",
              );
              // Never attach the full response: it may contain a provisioning token.
              const status = connection.body as {
                configured?: boolean;
                credentialSource?: string;
              };
              return (
                connection.status === 200 &&
                status.configured === true &&
                (status.credentialSource === "user" ||
                  status.credentialSource === "org")
              );
            },
            {
              timeout: 90_000,
              message: `${target.app} automatic signup must connect Builder`,
            },
          )
          .toBe(true);
        writeFileSync(
          testInfo.outputPath("automatic-builder-connection.json"),
          `${JSON.stringify({ app: target.app, environment: target.environment, connected: true, verificationToConnectionMs: Date.now() - verificationStartedAt })}\n`,
          "utf8",
        );
      });
    }

    if (target.app === "design" && target.environment === "beta") {
      await test.step("capture fresh-user first-run readiness", async () => {
        await expect(
          verificationPage.getByTestId("first-run-role"),
        ).toBeVisible({
          timeout: 30_000,
        });
        const elapsedMs = Date.now() - verificationStartedAt;
        await verificationPage.screenshot({
          path: testInfo.outputPath("design-first-run-onboarding.png"),
          fullPage: true,
        });
        writeFileSync(
          testInfo.outputPath("design-first-run-timing.json"),
          `${JSON.stringify(
            {
              measurement: "verification-link-open-to-first-run-role-visible",
              elapsedMs,
              app: target.app,
              environment: target.environment,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        testInfo.annotations.push({
          type: "design-first-run-ready-ms",
          description: String(elapsedMs),
        });
      });
    }

    if (target.app === "chat" && target.environment === "beta") {
      await test.step("confirm Chat's Get started landing", async () => {
        await expect
          .poll(() => new URL(verificationPage.url()).pathname)
          .toBe("/home");
      });
    }

    await test.step("wait for the application to become usable", async () => {
      await waitForApplicationReady(verificationPage, target.app);
    });

    await test.step("prove the session works before any refresh", async () => {
      assertSession(
        await readSession(verificationPage),
        email,
        `${target.app} immediate session`,
      );
      assertBetterAuthSession(
        await readBetterAuthSession(verificationPage),
        email,
        `${target.app} immediate Better Auth session`,
      );
    });

    await test.step("prove the session survives a browser refresh", async () => {
      await waitForApplicationReady(verificationPage, target.app);
      await verificationPage.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(() => new URL(verificationPage.url()).pathname)
        .not.toMatch(/sign-in|login/i);
      await waitForApplicationReady(verificationPage, target.app);
      assertSession(
        await readSession(verificationPage),
        email,
        `${target.app} refreshed session`,
      );
      assertBetterAuthSession(
        await readBetterAuthSession(verificationPage),
        email,
        `${target.app} refreshed Better Auth session`,
      );
    });

    const errors = [
      ...initialPageDiagnostics.errors,
      ...verificationPageDiagnostics.errors,
    ];
    const thirdParty = [
      ...initialPageDiagnostics.thirdParty,
      ...verificationPageDiagnostics.thirdParty,
    ];
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
