import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { test, type Page } from "@playwright/test";

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
): Promise<JourneyStep> {
  return {
    label,
    url: page.url(),
    // A page whose text cannot be read is not a page with no text: handing the
    // model an empty string there would have it judge a blank screen and
    // report a phantom finding, or miss a real one.
    visibleText: await page
      .locator("body")
      .innerText()
      .then(
        (text) => text.slice(0, 6_000),
        (error) => `<page text unreadable: ${String(error)}>`,
      ),
    screenshot: await page.screenshot({ fullPage: false }),
    consoleErrors: [...consoleErrors],
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
    const steps: JourneyStep[] = [];
    const email = createQaEmail(target.app, target.environment);
    const emailRequestedAt = Date.now() - 5_000;

    await test.step("open the sign-in page", async () => {
      await page.goto(`${target.origin}/sign-in`, {
        waitUntil: "domcontentloaded",
      });
      await renderedText(page, `${target.origin}/sign-in`);
      steps.push(await capture(page, "sign-in page", errors));
    });

    await test.step("request a sign-in link", async () => {
      const emailPromise = waitForVerificationEmail(email, emailRequestedAt);
      await page.locator("#m-email").fill(email);
      await page.locator("#magic-link-submit").click();
      // Give the app the moment a real user would give it before judging
      // whether the submit visibly did anything.
      await page.waitForTimeout(4_000);
      steps.push(await capture(page, "after requesting the link", errors));
      const message = await emailPromise;
      const link = verificationLinkFor(message, target.origin);
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4_000);
      steps.push(
        await capture(page, "after following the emailed link", errors),
      );
    });

    await test.step("reload the way a stuck user would", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4_000);
      steps.push(await capture(page, "after a browser reload", errors));
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
