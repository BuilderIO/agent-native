import assert from "node:assert/strict";
import { test } from "node:test";

import type { BrowserContext, Page } from "@playwright/test";

import {
  bridgeSessionCookies,
  diagnoseRendererStall,
  probeRenderer,
  RendererStallError,
  requireResponsiveRenderer,
  stallExitCode,
} from "./first-run-browser.js";

const never = () => new Promise<never>(() => undefined);
const page = (evaluate: () => Promise<unknown>) =>
  ({ evaluate, close: async () => undefined }) as unknown as Page;

function jarContext(
  requestCookies: Array<{ name: string }>,
  browserKeepsCookies: boolean,
) {
  const added: Array<{ name: string }> = [];
  const context = {
    request: { storageState: async () => ({ cookies: requestCookies }) },
    addCookies: async (cookies: Array<{ name: string }>) => {
      if (browserKeepsCookies) added.push(...cookies);
    },
    cookies: async () => added,
  };
  return { context: context as unknown as BrowserContext, added };
}

void test("report A2-LOCAL-FIRST-RUN-RENDERER: request-jar login cookies are copied into the browser context", async () => {
  const { context, added } = jarContext(
    [{ name: "session" }, { name: "session_data" }],
    true,
  );
  await bridgeSessionCookies(context, "http://127.0.0.1:8105");
  assert.deepEqual(
    added.map(({ name }) => name),
    ["session", "session_data"],
  );
});

void test("report A2-LOCAL-FIRST-RUN-RENDERER: a login that never reaches the browser context fails before navigation", async () => {
  await assert.rejects(
    bridgeSessionCookies(
      jarContext([{ name: "session" }], false).context,
      "http://127.0.0.1:8105",
    ),
    /did not reach the browser context/,
  );
  await assert.rejects(
    bridgeSessionCookies(jarContext([], true).context, "http://127.0.0.1:8105"),
    /did not reach the browser context/,
  );
});

void test("report A2-LOCAL-FIRST-RUN-RENDERER: a tab that never answers evaluate is reported within its deadline", async () => {
  const started = Date.now();
  assert.equal(await probeRenderer(page(never), 50), false);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await probeRenderer(page(async () => true), 50), true);
  assert.equal(
    await probeRenderer(
      page(async () => {
        throw new Error("Target closed");
      }),
      50,
    ),
    false,
  );
});

void test("report A2-LOCAL-FIRST-RUN-RENDERER: readiness gate fails loud as a renderer stall, not an app result", async () => {
  await requireResponsiveRenderer(
    page(async () => true),
    50,
  );
  await assert.rejects(
    requireResponsiveRenderer(page(never), 50),
    (error: unknown) =>
      error instanceof RendererStallError &&
      /did not answer/.test(error.message) &&
      !/password|cookie/i.test(error.message),
  );
});

void test("report A2-LOCAL-FIRST-RUN-RENDERER: stall diagnosis separates a page-only hang from a browser-wide stall", async () => {
  const contextWith = (blank: Page) =>
    ({ newPage: async () => blank }) as unknown as BrowserContext;
  assert.equal(
    await diagnoseRendererStall(
      contextWith(page(async () => true)),
      page(never),
      50,
    ),
    "page-only",
  );
  assert.equal(
    await diagnoseRendererStall(contextWith(page(never)), page(never), 50),
    "browser-wide",
  );
  assert.equal(
    await diagnoseRendererStall(
      contextWith(page(never)),
      page(async () => true),
      50,
    ),
    "responsive",
  );
  const noTab = {
    newPage: async () => {
      throw new Error("Target closed");
    },
  } as unknown as BrowserContext;
  assert.equal(
    await diagnoseRendererStall(noTab, page(never), 50),
    "browser-wide",
  );
});

void test("report A2-LOCAL-FIRST-RUN-RENDERER: a renderer stall exits as could-not-run, assertion failures stay failures", () => {
  assert.equal(stallExitCode(new RendererStallError("stalled")), 2);
  assert.equal(stallExitCode(new Error("assertion")), undefined);
});
