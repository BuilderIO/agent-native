import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { collectAppPageErrors, renderedText } from "../../beta/lib/app";
import {
  renderReviewMarkdown,
  reviewSignupJourney,
  type JourneyStep,
} from "../lib/agent-review";
import {
  createQaEmail,
  verificationLinkFor,
  waitForVerificationEmail,
} from "../lib/mailosaur";
import { selectedSignupTargets, type SignupTarget } from "../lib/targets";

const FINDINGS_PATH = join(
  process.cwd(),
  "e2e/signup/test-results/signup-agent/findings.md",
);
const REVIEW_SURFACE_TIMEOUT_MS = 15_000;
const REVIEW_SURFACE_LOADING_SELECTOR =
  "[data-first-run-startup-loading]:visible, [aria-busy='true']:visible, .skeleton-shimmer:visible";

async function waitForReviewSurface(page: Page): Promise<void> {
  const deadline = Date.now() + REVIEW_SURFACE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText();
    const loadingSurface = page.locator(REVIEW_SURFACE_LOADING_SELECTOR);
    if (text.trim().length >= 40 && (await loadingSurface.count()) === 0) {
      return;
    }
    await page.waitForTimeout(500);
  }
}

/**
 * One app per run by default. The deterministic canary already covers every
 * app every day; this lane spends model tokens, so it walks the fleet on a
 * rotation instead of paying for all of it daily. The index comes from the UTC
 * day so consecutive runs land on different apps without storing any state.
 */
function agentTargets(): SignupTarget[] {
  const all = selectedSignupTargets();
  if (all.length === 0) {
    throw new Error("Signup agent lane resolved no targets.");
  }
  const requested = process.env.SIGNUP_AGENT_APPS?.trim();
  if (requested) {
    const wanted = new Set(
      requested
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (wanted.has("all")) return all;
    const picked = all.filter((target) => wanted.has(target.app));
    if (picked.length === 0) {
      throw new Error(
        `SIGNUP_AGENT_APPS=${requested} matched none of the eligible targets.`,
      );
    }
    return picked;
  }
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return [all[dayIndex % all.length]!];
}

async function capture(
  page: Page,
  label: string,
  consoleErrors: string[],
  networkEvents: string[],
  pendingRequests: Map<string, number>,
): Promise<JourneyStep> {
  const domDiagnostics = await page
    .evaluate(() => {
      const describe = (selector: string) =>
        [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            selector,
            tag: element.tagName.toLowerCase(),
            id: element.id || undefined,
            className:
              typeof element.className === "string"
                ? element.className.slice(0, 180)
                : undefined,
            textLength: element.innerText.trim().length,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });

      return JSON.stringify(
        {
          readyState: document.readyState,
          title: document.title,
          bodyTextLength: document.body?.innerText.trim().length ?? 0,
          bodyChildren: [...(document.body?.children ?? [])].map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id || undefined,
            className:
              typeof element.className === "string"
                ? element.className.slice(0, 180)
                : undefined,
          })),
          surfaces: [
            "#root",
            "main",
            ".analytics-ask-page",
            ".analytics-chat-panel",
            ".agent-panel-root",
            "[data-agent-empty-state]",
            "[data-first-run-startup-loading]",
          ].flatMap(describe),
        },
        null,
        2,
      );
    })
    .catch((error) => `<DOM diagnostics unreadable: ${String(error)}>`);
  const pending = [...pendingRequests.entries()].map(
    ([url, startedAt]) =>
      `PENDING ${new URL(url).pathname} ${Date.now() - startedAt}ms`,
  );
  const requestDiagnostics = [...networkEvents.slice(-30), ...pending];
  console.log(
    `[signup-agent] ${label} network: ${requestDiagnostics.join(" | ") || "none"}`,
  );
  const visibleText = await page
    .locator("body")
    .innerText()
    .then(
      (text) =>
        `${text.slice(0, 6_000)}\n\nDOM diagnostics:\n${domDiagnostics}\n\nNetwork diagnostics:\n${requestDiagnostics.join(" | ") || "none"}`,
      (error) =>
        `<page text unreadable: ${String(error)}>\n\nDOM diagnostics:\n${domDiagnostics}\n\nNetwork diagnostics:\n${requestDiagnostics.join(" | ") || "none"}`,
    );

  return {
    label,
    url: page.url(),
    // A page whose text cannot be read is not a page with no text: handing the
    // model an empty string there would have it judge a blank screen and
    // report a phantom finding, or miss a real one.
    visibleText,
    screenshot: await page.screenshot({ fullPage: false }),
    consoleErrors: [...consoleErrors],
    networkEvents: requestDiagnostics,
  };
}

const targets = agentTargets();
const reports: string[] = [];

test.afterAll(() => {
  if (reports.length === 0) return;
  mkdirSync(dirname(FINDINGS_PATH), { recursive: true });
  writeFileSync(FINDINGS_PATH, reports.join("\n\n"), "utf8");
});

for (const target of targets) {
  test(`agent review of ${target.environment} ${target.app} signup`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const { errors } = collectAppPageErrors(page, target.origin);
    const networkEvents: string[] = [];
    const pendingRequests = new Map<string, number>();
    const isDiagnosticRequest = (url: string): boolean => {
      try {
        const parsed = new URL(url);
        return (
          parsed.origin === target.origin &&
          (parsed.pathname.startsWith("/_agent-native/onboarding/") ||
            parsed.pathname === "/ask" ||
            parsed.pathname === "/home")
        );
      } catch {
        return false;
      }
    };
    page.on("request", (request) => {
      if (isDiagnosticRequest(request.url())) {
        pendingRequests.set(request.url(), Date.now());
      }
    });
    page.on("response", (response) => {
      if (!isDiagnosticRequest(response.url())) return;
      const startedAt = pendingRequests.get(response.url());
      pendingRequests.delete(response.url());
      const elapsed =
        startedAt === undefined ? "?" : `${Date.now() - startedAt}ms`;
      networkEvents.push(
        `${response.status()} ${new URL(response.url()).pathname} ${elapsed}`,
      );
    });
    page.on("requestfailed", (request) => {
      if (!isDiagnosticRequest(request.url())) return;
      pendingRequests.delete(request.url());
      networkEvents.push(
        `FAILED ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`,
      );
    });
    const steps: JourneyStep[] = [];
    const email = createQaEmail(target.app, target.environment);
    const emailRequestedAt = Date.now() - 5_000;

    await test.step("open the sign-in page", async () => {
      await page.goto(`${target.origin}/sign-in`, {
        waitUntil: "domcontentloaded",
      });
      await renderedText(page, `${target.origin}/sign-in`);
      steps.push(
        await capture(
          page,
          "sign-in page",
          errors,
          networkEvents,
          pendingRequests,
        ),
      );
    });

    await test.step("request a sign-in link", async () => {
      const emailPromise = waitForVerificationEmail(email, emailRequestedAt);
      const emailInput = page.locator("#m-email");
      const submit = page.locator("#magic-link-submit");
      await emailInput.fill(email);
      await expect(emailInput).toHaveValue(email);
      await expect(
        submit,
        "email signup form never became ready after accepting the test address",
      ).toBeEnabled();
      await submit.click();
      // Give the app the moment a real user would give it before judging
      // whether the submit visibly did anything.
      await page.waitForTimeout(4_000);
      steps.push(
        await capture(
          page,
          "after requesting the link",
          errors,
          networkEvents,
          pendingRequests,
        ),
      );
      const message = await emailPromise;
      const link = verificationLinkFor(message, target.origin);
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await waitForReviewSurface(page);
      steps.push(
        await capture(
          page,
          "after following the emailed link",
          errors,
          networkEvents,
          pendingRequests,
        ),
      );
    });

    await test.step("reload the way a stuck user would", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForReviewSurface(page);
      steps.push(
        await capture(
          page,
          "after a browser reload",
          errors,
          networkEvents,
          pendingRequests,
        ),
      );
    });

    // A review that could not run is not a clean review: let this throw and
    // fail the lane rather than reporting an empty finding list.
    const review = await reviewSignupJourney(
      target.app,
      target.environment,
      steps,
    );
    const markdown = renderReviewMarkdown(
      target.app,
      target.environment,
      review,
    );
    reports.push(markdown);
    await test.info().attach(`agent-review-${target.app}`, {
      body: markdown,
      contentType: "text/markdown",
    });
    for (const step of steps) {
      await test.info().attach(`${target.app}-${step.label}`, {
        body: step.screenshot,
        contentType: "image/png",
      });
    }
    // Advisory by design: model-reported issues are surfaced in the job
    // summary and the rolling issue, never used to fail a build or page anyone.
    console.log(markdown);
  });
}
