import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

interface ReplayPayload {
  replayId?: string;
  sessionId?: string;
  userEmail?: string;
  userId?: string;
  properties?: Record<string, unknown>;
  events?: unknown[];
  [key: string]: unknown;
}

async function installReplaySink(context: BrowserContext, baseURL: string) {
  const payloads: ReplayPayload[] = [];
  const replayOrigins: string[] = [];
  const replayRequestOrigins: string[] = [];
  const appOrigin = new URL(baseURL).origin;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    if (
      url.hostname === "fonts.googleapis.com" &&
      route.request().resourceType() === "stylesheet"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "text/css",
        body: "",
      });
    }
    return route.abort();
  });
  await context.route("**/api/analytics/replay*", async (route) => {
    const request = route.request();
    replayOrigins.push(new URL(request.url()).origin);
    replayRequestOrigins.push(request.headers().origin ?? "");
    const body = request.postDataBuffer();
    if (body) {
      const raw = request.headers()["content-encoding"]?.includes("gzip")
        ? gunzipSync(body)
        : body;
      payloads.push(JSON.parse(raw.toString("utf8")) as ReplayPayload);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await context.route("**/api/analytics/track*", (route) =>
    route.fulfill({ status: 200, body: "{}" }),
  );
  return { payloads, replayOrigins, replayRequestOrigins };
}

function watchPage(page: Page, baseURL: string) {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const requestFailures: string[] = [];
  const appOrigin = new URL(baseURL).origin;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    const { origin, pathname } = new URL(response.url());
    if (origin !== appOrigin) return;
    if (response.status() >= 400)
      failedResponses.push(`${response.status()} ${pathname}`);
  });
  page.on("requestfailed", (request) => {
    const { origin, pathname } = new URL(request.url());
    if (origin === appOrigin) {
      requestFailures.push(
        `${pathname} ${request.failure()?.errorText ?? "unknown failure"}`,
      );
    }
  });
  return {
    consoleErrors,
    failedResponses,
    requestFailures,
  };
}

// oracle: none — verifies payload privacy and auth continuity, not Design parity.
test("pre-auth recording continues through signup and masks abandonment", async ({
  browser,
}, testInfo) => {
  // oracle: none — the isolated auth setup is a payload test precondition, not visual parity.
  test.skip(
    process.env.E2E_DISABLE_AUTO_DEV_ACCOUNT !== "1",
    "Requires the isolated signup and replay setup enabled by E2E_DISABLE_AUTO_DEV_ACCOUNT=1.",
  );
  const baseURL = String(testInfo.project.use.baseURL ?? "");
  if (!baseURL) throw new Error("Design E2E base URL is missing");
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const { payloads, replayOrigins, replayRequestOrigins } =
    await installReplaySink(context, baseURL);
  const page = await context.newPage();
  const browserDiagnostics = watchPage(page, baseURL);
  const email = `codex-auth-replay-smoke-${process.env.E2E_RUN_ID}@example.com`;
  const password = `FakeE2E-Password-${process.env.E2E_RUN_ID}!`;

  try {
    await page.goto(`${baseURL}/signup?signup_e2e=preauth-smoke`);
    await expect(page.locator("#signup-form")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__AGENT_NATIVE_CONFIG__?.authSessionReplay,
        ),
      )
      .toBe(true);
    await page.locator("#s-email").fill(email);
    await page.locator("#s-pass").fill(password);
    await page.locator("#s-pass2").fill(password);

    try {
      await expect
        .poll(
          () =>
            payloads.some(
              (payload) =>
                payload.properties?.capture_context === "pre_auth" &&
                !payload.userEmail &&
                !payload.userId,
            ),
          { timeout: 15_000 },
        )
        .toBe(true);
    } catch (error) {
      const redact = (value: string) =>
        value
          .split(email)
          .join("[redacted]")
          .split(password)
          .join("[redacted]");
      console.error(
        `[pre-auth replay browser diagnostics] ${JSON.stringify({
          consoleErrors: browserDiagnostics.consoleErrors.map(redact),
          failedResponses: browserDiagnostics.failedResponses,
          requestFailures: browserDiagnostics.requestFailures,
          replayOrigins,
        })}`,
      );
      throw error;
    }

    const anonymousChunk = payloads.find(
      (payload) =>
        payload.properties?.capture_context === "pre_auth" &&
        !payload.userEmail &&
        !payload.userId,
    );
    expect(anonymousChunk).toBeTruthy();
    expect(anonymousChunk?.replayId).toBeTruthy();
    expect(anonymousChunk?.sessionId).toBeTruthy();
    expect(anonymousChunk).not.toHaveProperty("userEmail");
    expect(anonymousChunk).not.toHaveProperty("userId");
    expect(JSON.stringify(anonymousChunk)).not.toContain(email);
    expect(JSON.stringify(anonymousChunk)).not.toContain(password);

    await page.locator("#signup-form button[type='submit']").click();
    // Design's development config disables first-run onboarding; this smoke
    // proves signup-to-authenticated continuity, not the production setup UI.
    await expect(
      page.getByRole("button").filter({ hasText: email }),
    ).toBeVisible({
      timeout: 60_000,
    });
    const screenshotPath = path.resolve(
      import.meta.dirname,
      "../../../.tmp/pre-auth-session-replay/design-signed-in-after-signup.png",
    );
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    await expect
      .poll(() => payloads.some((payload) => payload.userEmail === email), {
        timeout: 15_000,
      })
      .toBe(true);
    expect(new Set(replayOrigins)).toEqual(new Set([new URL(baseURL).origin]));
    expect(new Set(replayRequestOrigins)).toEqual(
      new Set([new URL(baseURL).origin]),
    );
    const linkedChunk = payloads.find((payload) => payload.userEmail === email);
    expect(linkedChunk?.replayId).toBe(anonymousChunk?.replayId);
    expect(linkedChunk?.sessionId).toBe(anonymousChunk?.sessionId);
    expect(linkedChunk?.sessionId).toBeTruthy();
    expect(linkedChunk?.properties).toMatchObject({
      capture_context: "pre_auth",
    });
    expect(linkedChunk?.properties).not.toHaveProperty("userEmail");
    expect(linkedChunk?.properties).not.toHaveProperty("userId");
    expect(JSON.stringify(linkedChunk?.properties)).not.toContain(email);
    expect(browserDiagnostics.consoleErrors).toEqual([]);
    expect(browserDiagnostics.failedResponses).toEqual([]);
    expect(browserDiagnostics.requestFailures).toEqual([]);
  } finally {
    await context.close();
  }

  const abandonmentContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const {
    payloads: abandonmentPayloads,
    replayOrigins: abandonmentReplayOrigins,
    replayRequestOrigins: abandonmentRequestOrigins,
  } = await installReplaySink(abandonmentContext, baseURL);
  const abandonmentPage = await abandonmentContext.newPage();
  const abandonmentEmail = `codex-abandonment-smoke-${process.env.E2E_RUN_ID}@example.com`;

  try {
    await abandonmentPage.goto(
      `${baseURL}/signup?signup_e2e=abandonment-smoke`,
    );
    await expect(abandonmentPage.locator("#signup-form")).toBeVisible();
    await expect
      .poll(() =>
        abandonmentPage.evaluate(
          () => (window as any).__AGENT_NATIVE_CONFIG__?.authSessionReplay,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        abandonmentPayloads.some(
          (payload) =>
            payload.properties?.capture_context === "pre_auth" &&
            !payload.userEmail &&
            !payload.userId,
        ),
      )
      .toBe(true);
    const payloadCountBeforeInput = abandonmentPayloads.length;
    await abandonmentPage.locator("#s-email").fill(abandonmentEmail);
    await abandonmentPage.locator("#s-pass").fill(password);
    await abandonmentPage.locator("#s-pass2").fill(password);
    await expect
      .poll(() => abandonmentPayloads.length > payloadCountBeforeInput, {
        timeout: 15_000,
      })
      .toBe(true);
    for (const abandonedChunk of abandonmentPayloads) {
      expect(abandonedChunk).not.toHaveProperty("userEmail");
      expect(abandonedChunk).not.toHaveProperty("userId");
      expect(JSON.stringify(abandonedChunk)).not.toContain(abandonmentEmail);
      expect(JSON.stringify(abandonedChunk)).not.toContain(password);
    }
    expect(new Set(abandonmentReplayOrigins)).toEqual(
      new Set([new URL(baseURL).origin]),
    );
    expect(new Set(abandonmentRequestOrigins)).toEqual(
      new Set([new URL(baseURL).origin]),
    );
  } finally {
    await abandonmentContext.close();
  }

  const loginContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const { payloads: loginPayloads, replayOrigins: loginReplayOrigins } =
    await installReplaySink(loginContext, baseURL);
  const loginPage = await loginContext.newPage();

  try {
    await loginPage.goto(`${baseURL}/login`);
    await expect(loginPage.locator("#login-form")).toBeVisible();
    await expect
      .poll(
        () =>
          loginPayloads.some(
            (payload) =>
              payload.properties?.capture_context === "pre_auth" &&
              !payload.userEmail &&
              !payload.userId,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(new Set(loginReplayOrigins)).toEqual(
      new Set([new URL(baseURL).origin]),
    );
  } finally {
    await loginContext.close();
  }
});
