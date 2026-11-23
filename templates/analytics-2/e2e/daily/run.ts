import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { expect, type BrowserContext } from "@playwright/test";

import { safeErrorDiagnostic } from "../failure-diagnostic.js";
import { openQaBrowser } from "../qa-browser.js";
import { classifyFailureResponse } from "./response-diagnostic";
import { startServer } from "./server";

async function main() {
  const root = resolve(import.meta.dirname, "../../../..");
  const require = createRequire(resolve(root, "package.json"));
  const production = process.argv.includes("--production");
  const testArgs = process.argv
    .slice(2)
    .filter((arg) => arg !== "--production");
  const { writeFile, mkdtemp, copyFile, rm } = await import("node:fs/promises");
  const output = await mkdtemp(resolve(root, ".tmp/analytics-daily-client-"));
  const { server, child } = await startServer(0, production, 8105);
  // The cookie remains in its local file; never print it or place it in command arguments.
  const cookiePath = resolve(output, "cookie");
  const browser = await (async () => {
    try {
      await writeFile(cookiePath, server.cookie, { mode: 0o600 });
      return await openQaBrowser();
    } catch (error) {
      if (child && child.exitCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGTERM");
        await exited;
      }
      throw error;
    }
  })();
  let active: ReturnType<typeof spawn> | undefined;
  let warmContext: BrowserContext | undefined;
  let stopping: Promise<void> | undefined;
  function stop() {
    return (stopping ??= (async () => {
      active?.kill("SIGTERM");
      const errors: unknown[] = [];
      try {
        await warmContext?.close();
      } catch (error) {
        errors.push(error);
      }
      warmContext = undefined;
      try {
        await browser.close();
      } catch (error) {
        errors.push(error);
      } finally {
        if (child && child.exitCode === null) {
          const exited = new Promise((done) => child.once("exit", done));
          child.kill("SIGTERM");
          await exited;
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Daily cleanup failed");
    })());
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void stop().then(() => process.exit(1)));
  const warmFile = resolve(output, "warmed");
  try {
    const refreshed = await fetch(`${server.fake}__control/assets/reset`, {
      method: "POST",
    });
    if (!refreshed.ok)
      throw new Error(`Asset cache reset failed: ${refreshed.status}`);
    const context = await browser.newContext({
      serviceWorkers: "block",
      proxy: { server: server.fake, bypass: "<-loopback>" },
    });
    warmContext = context;
    await context.route(
      (url) => !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      (route) => route.abort("blockedbyclient"),
    );
    await context.addCookies(
      server.cookie
        .split("; ")
        .filter(Boolean)
        .map((pair) => {
          const index = pair.indexOf("=");
          return {
            name: pair.slice(0, index),
            value: pair.slice(index + 1),
            url: server.base,
          };
        }),
    );
    const profile = JSON.parse(
      await readFile(
        resolve(homedir(), ".config/agent-native-qa/analytics-2-profile.json"),
        "utf8",
      ),
    );
    if (
      profile.email !== "qa-fleet@builder.io" ||
      typeof profile.workspaceId !== "string" ||
      !profile.workspaceId
    )
      throw new Error("Invalid QA profile fixture");
    const session = await context.request.get(
      `${server.base}/_agent-native/auth/session`,
    );
    if (!session.ok())
      throw new Error(`Local QA session HTTP ${session.status()}`);
    const identity = await session.json();
    const orgResponse = await context.request.get(
      `${server.base}/_agent-native/org/me`,
    );
    if (!orgResponse.ok())
      throw new Error(`Local QA org HTTP ${orgResponse.status()}`);
    const org = await orgResponse.json();
    if (
      identity.email !== profile.email ||
      org.email !== profile.email ||
      !org.orgId ||
      org.orgId === profile.workspaceId ||
      !["owner", "admin"].includes(org.role)
    )
      throw new Error("Local QA workspace identity did not match");
    console.log(`VERIFIED local QA ${identity.email}, workspace ${org.orgId}`);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const failedRequests: string[] = [];
    const failedResponses: string[] = [];
    const failureDetails: ReturnType<typeof classifyFailureResponse>[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        failedResponses.push(
          `${url.origin}${url.pathname}: ${response.status()}`,
        );
        if (response.status() === 503) {
          const request = response.request();
          failureDetails.push(
            classifyFailureResponse({
              url: response.url(),
              method: request.method(),
              resourceType: request.resourceType(),
              headerNames: Object.keys(request.headers()),
              contentType: response.headers()["content-type"] ?? "",
            }),
          );
        }
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      failedRequests.push(
        `${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "failed"}`,
      );
    });
    const firstRunResponse = await context.request.get(
      `${server.base}/_agent-native/onboarding/first-run/status`,
    );
    if (!firstRunResponse.ok())
      throw new Error(`First-run status failed: ${firstRunResponse.status()}`);
    const firstRun = await firstRunResponse.json();
    if (firstRun.firstRun === true) {
      const response = await context.request.post(
        `${server.base}/_agent-native/onboarding/first-run/complete`,
        {
          data: {
            expectedOrgId: org.orgId,
            expectedUserEmail: identity.email,
          },
        },
      );
      if (!response.ok() || (await response.json()).ok !== true)
        throw new Error("Synthetic onboarding completion was not acknowledged");
    } else if (firstRun.firstRun !== false)
      throw new Error("Unreadable first-run status");

    console.log("COLD HOME report A2-DAILY-OPTIMIZER-COLD-ENTRY");
    let documents = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents++;
    });
    const navigationStart = performance.now();
    let bootstrapStatus: number | undefined;
    let activityStart: number | undefined;
    let activityEnd: number | undefined;
    let activityStatus: number | undefined;
    page.on("request", (request) => {
      if (
        request.url().includes("/_agent-native/actions/get-workspace-activity")
      ) {
        if (activityStart !== undefined) return;
        activityStart = performance.now();
      }
    });
    page.on("response", (response) => {
      if (
        response
          .url()
          .includes("/_agent-native/actions/get-workspace-bootstrap")
      ) {
        bootstrapStatus = response.status();
      }
      if (
        response
          .url()
          .includes("/_agent-native/actions/get-workspace-activity") &&
        activityEnd === undefined
      ) {
        activityEnd = performance.now();
        activityStatus = response.status();
      }
    });
    await page.goto(`${server.base}/home`, { waitUntil: "domcontentloaded" });
    const domReady = performance.now();
    try {
      const link = page.getByRole("link", {
        name: "Connect your data",
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 5_000 });
      await expect(link).toHaveAttribute("href", /\/home\/data\?connect=1$/);
      const linkReady = performance.now();
      if (bootstrapStatus !== 200)
        throw new Error(
          `Cold Home bootstrap request failed: ${bootstrapStatus ?? "no response"}`,
        );
      const activityPendingAtLink = activityEnd === undefined;
      // oracle-change: authenticated bootstrap renders the CTA before the workspace activity read completes.
      await expect.poll(() => activityStatus, { timeout: 10_000 }).toBe(200);
      if (
        activityStart === undefined ||
        activityEnd === undefined ||
        activityStatus !== 200
      )
        throw new Error(
          `Cold Home activity request failed: ${activityStatus ?? "no response"}`,
        );
      if (
        pageErrors.length ||
        consoleErrors.length ||
        failedRequests.length ||
        failedResponses.length
      )
        throw new Error("Cold Home reported a page error or failed request");
      expect(documents, "Cold Home loads without a recovery navigation").toBe(
        1,
      );
      await page.screenshot({ path: resolve(output, "cold-home.png") });
      console.log(`COLD HOME screenshot ${resolve(output, "cold-home.png")}`);
      console.log(
        `COLD HOME timing ms ${JSON.stringify({
          domReady: Math.round(domReady - navigationStart),
          activityStart: Math.round(activityStart - navigationStart),
          activityEnd: Math.round(activityEnd - navigationStart),
          link: Math.round(linkReady - navigationStart),
          activityPendingAtLink,
        })}`,
      );
    } catch (error) {
      console.error(
        `COLD HOME failure timing ms ${JSON.stringify({
          domReady: Math.round(domReady - navigationStart),
          activityStart:
            activityStart === undefined
              ? null
              : Math.round(activityStart - navigationStart),
          activityEnd:
            activityEnd === undefined
              ? null
              : Math.round(activityEnd - navigationStart),
          elapsed: Math.round(performance.now() - navigationStart),
          pageErrors,
          consoleErrors,
          failedRequests,
          failedResponses,
          failureDetails,
        })}`,
      );
      await page.screenshot({ path: resolve(output, "cold-home-failure.png") });
      throw error;
    }
    await writeFile(
      cookiePath,
      (await context.cookies(server.base))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
      { mode: 0o600 },
    );
    for (const path of [
      "/home",
      "/home/data",
      "/settings",
      "/home/all",
      "/home/collections",
      "/home/threads",
      "/home/archive",
      "/home/trash",
    ]) {
      console.log(`Warm ${path}`);
      await page.goto(`${server.base}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 180_000,
      });
      const ready =
        path === "/settings"
          ? page.getByRole("navigation", { name: "Settings" })
          : page.locator("main, [aria-label='Workspace tools']").first();
      await ready.waitFor({ state: "visible", timeout: 120_000 });
      if (path === "/settings") await expect(page).toHaveTitle(/Settings/);
      const skip = page.getByRole("button", { name: "Skip", exact: true });
      if (await skip.isVisible()) await skip.click();
    }
    const response = await context.request.post(
      `${server.base}/_agent-native/actions/create-project`,
      { data: { title: "Daily warmup" } },
    );
    if (!response.ok())
      throw new Error(`Warmup project failed: ${response.status()}`);
    const project = await response.json();
    for (const path of [
      `/project/${project.id}/latest`,
      `/project/${project.id}/latest/app`,
    ]) {
      console.log("Warm notebook view");
      await page.goto(`${server.base}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 180_000,
      });
      try {
        const views = page.getByRole("navigation", { name: "Project views" });
        await views.waitFor({ state: "visible", timeout: 120_000 });
        await expect(
          views.getByRole("button", {
            name: path.endsWith("/app") ? "App builder" : "Notebook",
            exact: true,
          }),
        ).toHaveAttribute("aria-current", "page");
      } catch (error) {
        const url = new URL(page.url());
        console.error(
          `Notebook warmup URL ${url.origin}${url.pathname}; title ${await page.title()}`,
        );
        console.error(
          `Notebook warmup page errors: ${JSON.stringify(pageErrors)}; failed requests: ${JSON.stringify(failedRequests)}`,
        );
        await page.screenshot({
          path: resolve(output, "notebook-warmup-failure.png"),
          timeout: 10_000,
        });
        console.error(
          `Notebook warmup screenshot: ${resolve(output, "notebook-warmup-failure.png")}`,
        );
        throw error;
      }
    }
    await context.request.post(
      `${server.base}/_agent-native/actions/trash-project`,
      { data: { projectId: project.id } },
    );
    await writeFile(warmFile, "ready");
    await warmContext.close();
    warmContext = undefined;
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Daily warmup and cleanup failed",
      );
    }
    throw error;
  }
  try {
    const runs = 1;
    for (let run = 1; run <= runs; run++) {
      console.log(
        `Daily run ${run}/${runs}: one local app server, one shared browser, five bounded workers`,
      );
      await writeFile(
        resolve(root, ".tmp/analytics-daily/descriptor.json"),
        JSON.stringify({
          base: server.base,
          fake: server.fake,
          cookiePath,
          warmFile,
        }),
        { mode: 0o600 },
      );
      await rm(resolve(root, ".tmp/analytics-daily-results/results.json"), {
        force: true,
      });
      active = spawn(
        process.execPath,
        [
          require.resolve("@playwright/test/cli"),
          "test",
          "--config",
          "templates/analytics-2/e2e/daily/playwright.config.ts",
          ...testArgs,
        ],
        {
          cwd: root,
          env: {
            ...process.env,
          },
          stdio: "inherit",
        },
      );
      const code = await new Promise<number | null>((done, fail) => {
        active?.once("exit", done);
        active?.once("error", fail);
      });
      try {
        await copyFile(
          resolve(root, ".tmp/analytics-daily-results/results.json"),
          resolve(output, `run-${run}.json`),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error(
            `Playwright exited ${code ?? "without a code"} and did not produce a results file`,
            { cause: error },
          );
        throw error;
      }
      console.log(`Saved run ${run} result in ${output}/run-${run}.json`);
      if (code !== 0) {
        process.exitCode = code ?? 1;
        break;
      }
    }
  } finally {
    await stop();
    await rm(resolve(root, ".tmp/analytics-daily/descriptor.json"), {
      force: true,
    });
  }
}

await main().catch((error: unknown) => {
  console.error(safeErrorDiagnostic(error));
  process.exitCode = 1;
});
