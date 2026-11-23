import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { safeErrorDiagnostic } from "./failure-diagnostic.js";

export async function checkHomeIntent(page: Page, base: string): Promise<void> {
  const response = await page.goto(`${base}/home`, {
    waitUntil: "domcontentloaded",
  });
  const composer = page.locator(".ws-home-composer");
  const input = composer
    .locator('[contenteditable="true"], textarea, input')
    .first();
  try {
    await expect(input).toBeVisible();
  } catch (error) {
    if (new URL(base).hostname === "localhost") {
      console.error(
        `HOME INTENT NAVIGATION ${JSON.stringify({ status: response?.status() ?? null, closed: page.isClosed() })}`,
      );
      let captureTimer: ReturnType<typeof setTimeout> | undefined;
      const capture = { timedOut: false };
      try {
        const state = await Promise.race([
          page.evaluate(() => ({
            path: location.pathname,
            readyState: document.readyState,
            homeCount: document.querySelectorAll(".ws-home").length,
            agentCount: document.querySelectorAll(".ws-agent-home").length,
            composerCount:
              document.querySelectorAll(".ws-home-composer").length,
            inputCount: document.querySelectorAll(
              '.ws-home-composer [contenteditable="true"], .ws-home-composer textarea, .ws-home-composer input',
            ).length,
            matches: Array.from(
              document.querySelectorAll<HTMLElement>(
                '.ws-home-composer [contenteditable="true"], .ws-home-composer textarea, .ws-home-composer input',
              ),
              (element) => ({
                tag: element.tagName,
                type: element.getAttribute("type"),
                contenteditable: element.getAttribute("contenteditable"),
                visible:
                  element.getBoundingClientRect().width > 0 &&
                  element.getBoundingClientRect().height > 0 &&
                  getComputedStyle(element).visibility !== "hidden",
              }),
            ),
          })),
          new Promise<never>((_, reject) => {
            captureTimer = setTimeout(() => {
              capture.timedOut = true;
              reject(new Error("Home state capture timed out"));
            }, 5000);
          }),
        ]);
        console.error(`HOME INTENT READINESS ${JSON.stringify(state)}`);
      } catch (captureError) {
        console.error(
          `HOME INTENT STATE CAPTURE ${capture.timedOut ? "timeout" : safeErrorDiagnostic(captureError)}`,
        );
      } finally {
        clearTimeout(captureTimer);
      }
      try {
        await page.screenshot({
          path: ".tmp/analytics-owner/home-intent-readiness-failure.png",
          timeout: 5000,
        });
      } catch (captureError) {
        console.error(
          `HOME INTENT SCREENSHOT CAPTURE ${safeErrorDiagnostic(captureError)}`,
        );
      }
    }
    throw error;
  }
  await input.fill("Show revenue by month");
  await page
    .getByRole("button", { name: "Analyze in a notebook", exact: true })
    .click();
  await expect(
    composer.getByText("Analyze in a notebook", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      input.evaluate((el) =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value
          : el.textContent,
      ),
    )
    .toBe("Show revenue by month");
  await page.screenshot({
    path: ".tmp/analytics-owner/report-home-app-intent.png",
  });
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    composer.getByText("Analyze in a notebook", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      input.evaluate((el) =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value
          : el.textContent,
      ),
    )
    .toBe("Show revenue by month");
}

// Browser-only readiness override permits transport inspection on an unconfigured
// local workspace. The chat POST is stopped here; no provider receives the prompt.
export async function checkHomeIntentTransport(page: Page, base: string) {
  const statusPattern = "**/_agent-native/agent-engine/status*";
  const startPattern = "**/_agent-native/actions/start-analytics-thread";
  const threadIds = new Set<string>();
  const threadWrites = new Set<import("@playwright/test").Request>();
  const seenPosts: unknown[] = [];
  let failure: Error | undefined;
  let phase = "open-home";
  let deletingThreads = false;
  const cleanupErrors: string[] = [];
  const safeThreadSuffix = (path: string) => {
    const suffix = path.split("/_agent-native/agent-chat/threads")[1] ?? "";
    return /^\/[a-zA-Z0-9_-]{1,128}(?:\/[a-z-]+)?$/.test(suffix) ||
      suffix === ""
      ? suffix
      : "[redacted]";
  };
  const safeThreadId = (id: string) =>
    /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : "[redacted]";
  const trackThread = (request: import("@playwright/test").Request) => {
    const path = new URL(request.url()).pathname;
    if (deletingThreads && path.includes("/_agent-native/agent-chat/threads")) {
      const suffix = safeThreadSuffix(path);
      console.log(
        `app-intent-transport cleanup browser start method=${request.method()} suffix=${suffix}`,
      );
    }
    if (
      path.includes("/_agent-native/agent-chat/threads") &&
      ["POST", "PUT", "PATCH"].includes(request.method())
    )
      threadWrites.add(request);
    if (
      request.method() === "POST" &&
      path.endsWith("/_agent-native/agent-chat/threads")
    ) {
      const payload: unknown = request.postDataJSON();
      if (
        payload &&
        typeof payload === "object" &&
        "id" in payload &&
        typeof payload.id === "string"
      )
        threadIds.add(payload.id);
    }
    const match = path.match(/\/_agent-native\/agent-chat\/threads\/([^/]+)$/);
    if (match?.[1] && ["POST", "PUT", "PATCH"].includes(request.method()))
      threadIds.add(decodeURIComponent(match[1]));
  };
  const finishThread = (request: import("@playwright/test").Request) => {
    threadWrites.delete(request);
    const path = new URL(request.url()).pathname;
    if (deletingThreads && path.includes("/_agent-native/agent-chat/threads")) {
      const suffix = safeThreadSuffix(path);
      void request.response().then(
        (response) =>
          console.log(
            `app-intent-transport cleanup browser finish method=${request.method()} suffix=${suffix} status=${response?.status() ?? "failed"}`,
          ),
        () =>
          console.log(
            `app-intent-transport cleanup browser finish method=${request.method()} suffix=${suffix} status=unreadable`,
          ),
      );
    }
  };
  page.on("request", trackThread);
  page.on("requestfinished", finishThread);
  page.on("requestfailed", finishThread);
  const isRouteSettledError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("Route is already handled") ||
      message.includes("Target page, context or browser has been closed")
    );
  };
  await page.route(statusPattern, async (route) => {
    try {
      const response = await route.fetch();
      const original: unknown = await response.json();
      if (!original || typeof original !== "object")
        throw new Error("Invalid real engine status response");
      await route.fulfill({
        response,
        json: { ...original, configured: true, chatEligible: true },
      });
    } catch (error) {
      if (!isRouteSettledError(error)) throw error;
    }
  });
  await page.route(startPattern, async (route) => {
    try {
      if (route.request().method() !== "POST") return await route.continue();
      seenPosts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Provider unavailable",
          errorCode: "ai_provider_unavailable",
        }),
      });
    } catch (error) {
      if (!isRouteSettledError(error)) throw error;
    }
  });
  try {
    await page.goto(`${base}/home`, {
      waitUntil: "domcontentloaded",
    });
    const host = page.locator(".ws-agent-home");
    const composer = host.getByRole("textbox", {
      name: "Message agent...",
      exact: true,
    });
    await expect(composer).toBeVisible({ timeout: 30000 });
    const prompt = "Show revenue by month in an app";
    await composer.fill(prompt);
    await page
      .getByRole("button", { name: "Analyze in a notebook", exact: true })
      .click();
    await expect(
      host.getByText("Analyze in a notebook", { exact: true }),
    ).toBeVisible();
    phase = "send";
    await composer.press("Enter");
    await expect.poll(() => seenPosts.length, { timeout: 20000 }).toBe(1);
    const body = seenPosts[0];
    const parsed = z
      .object({
        mode: z.string(),
        trigger: z.object({
          kind: z.literal("submit"),
          prompt: z.object({ text: z.string() }),
        }),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new Error("start-analytics-thread POST has no submit prompt");
    expect(parsed.data.trigger.prompt.text).toContain(prompt);
    expect(parsed.data.mode).toBe("notebook");
    await page.screenshot({
      path: ".tmp/analytics-owner/home-intent-transport.png",
    });
  } catch (error) {
    failure =
      error instanceof Error ? error : new Error(safeErrorDiagnostic(error));
    console.log(
      `app-intent-transport phase=${phase} ${safeErrorDiagnostic(failure)}`,
    );
  } finally {
    let quiescent = false;
    try {
      await page.goto("about:blank", { waitUntil: "load" });
      await expect(page).toHaveURL("about:blank");
      await expect.poll(() => threadWrites.size).toBe(0);
      quiescent = true;
    } catch (error) {
      cleanupErrors.push(safeErrorDiagnostic(error));
    }
    await page.unrouteAll({ behavior: "wait" });
    deletingThreads = true;
    for (const id of quiescent ? threadIds : []) {
      const path = `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(id)}`;
      try {
        const headers = {
          origin: base,
          "x-agent-native-csrf": "1",
          "x-agent-native-frontend": "1",
          "x-agent-native-interactive": "1",
        };
        const response = await page.request.delete(path, { headers });
        console.log(
          `app-intent-transport cleanup DELETE id=${safeThreadId(id)} status=${response.status()}`,
        );
        const deleteJson = response
          .headers()
          ["content-type"]?.includes("application/json")
          ? ((await response.json()) as unknown)
          : null;
        const acknowledged = Boolean(
          deleteJson &&
          typeof deleteJson === "object" &&
          "ok" in deleteJson &&
          deleteJson.ok === true,
        );
        if (!response.ok() || !acknowledged) {
          console.log(
            `app-intent-transport DELETE status=${response.status()} acknowledged=${acknowledged}`,
          );
          throw new Error(
            `QA thread DELETE HTTP ${response.status()} acknowledged=${acknowledged}`,
          );
        }
        const readback = await page.request.get(path, { headers });
        console.log(
          `app-intent-transport cleanup GET id=${safeThreadId(id)} status=${readback.status()}`,
        );
        if (readback.status() !== 404) {
          const json = readback
            .headers()
            ["content-type"]?.includes("application/json")
            ? ((await readback.json()) as unknown)
            : null;
          const object = json && typeof json === "object" ? json : null;
          const matchingId = Boolean(
            object && "id" in object && object.id === id,
          );
          const typedAbsent = Boolean(
            object && "absent" in object && object.absent === true,
          );
          console.log(
            `app-intent-transport GET status=${readback.status()} json=${json !== null} matchingId=${matchingId} typedAbsent=${typedAbsent}`,
          );
          throw new Error(
            `QA thread GET HTTP ${readback.status()} json=${json !== null} matchingId=${matchingId} typedAbsent=${typedAbsent}`,
          );
        }
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    deletingThreads = false;
    page.off("request", trackThread);
    page.off("requestfinished", finishThread);
    page.off("requestfailed", finishThread);
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      failure === undefined ? [] : [failure],
      cleanupErrors.join("; "),
    );
  }
  if (failure !== undefined) throw failure;
}
