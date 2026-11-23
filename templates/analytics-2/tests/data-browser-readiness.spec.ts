import assert from "node:assert/strict";

import { test } from "vitest";

import {
  captureDataBrowserState,
  classifyPlaywrightFailure,
  pageRouteClass,
  selectWarehouseDiagnostic,
} from "../e2e/data-browser-readiness.js";

test("route class requires the explicit mount and drops query, hash, and private paths", () => {
  assert.equal(
    pageRouteClass(
      "https://x.test/analytics-2/home/data/?token=s#h",
      "mounted",
    ),
    "/home/data",
  );
  assert.equal(
    pageRouteClass("https://x.test/analytics-2/data", "mounted"),
    "/data",
  );
  assert.equal(pageRouteClass("http://x.test/data?q=1", "unmounted"), "/data");
  assert.equal(
    pageRouteClass("https://x.test/home/data", "mounted"),
    "unknown",
  );
  assert.equal(
    pageRouteClass("http://x.test/analytics-2/data", "unmounted"),
    "unknown",
  );
  assert.equal(
    pageRouteClass("https://x.test/other/analytics-2/data", "mounted"),
    "unknown",
  );
  assert.equal(
    pageRouteClass(
      "https://x.test/analytics-2/projects/private-title",
      "mounted",
    ),
    "unknown",
  );
  assert.equal(pageRouteClass("not a url", "mounted"), "unknown");
});

test("classifies Playwright errors without echoing message, body, or cookie", () => {
  const intercepted = new Error(
    "locator.click: Timeout 25000ms exceeded.\nCall log:\n  - <div role=dialog>private-title</div> intercepts pointer events\n  - cookie: fake-session",
  );
  assert.equal(classifyPlaywrightFailure(intercepted), "intercepted-pointer");
  assert.equal(
    classifyPlaywrightFailure(
      new Error(
        "locator.click: Timeout 1ms exceeded.\n  - waiting for getByText('Warehouse')",
      ),
    ),
    "locator-unavailable",
  );
  assert.equal(
    classifyPlaywrightFailure(
      new Error("Target page, context or browser has been closed"),
    ),
    "closed",
  );
  assert.equal(classifyPlaywrightFailure("x"), "other");
  const line = selectWarehouseDiagnostic(
    { outcome: "timeout", route: "unknown" },
    intercepted,
  );
  assert.equal(
    line,
    "select-warehouse state=timeout route=unknown cause=intercepted-pointer",
  );
  assert.doesNotMatch(line, /private-title|fake-session|cookie/);
});

test("captures only known tab names and counts; unresponsive renderer is timeout, never ready", async () => {
  const dom = {
    tabs: ["Recommended", "Warehouse", "Secret Project Title", "Recents"],
    loader: true,
    alert: false,
    dialogCount: 2,
  };
  const state = await captureDataBrowserState(
    {
      url: () => "https://x.test/analytics-2/home/data?k=secret",
      evaluate: async () => dom as never,
    },
    "mounted",
  );
  const line = selectWarehouseDiagnostic(state, new Error("x"));
  assert.equal(
    line,
    "select-warehouse state=observed route=/home/data tabs=Recommended|Warehouse|Recents loader=true alert=false dialog-count=2 cause=other",
  );
  assert.doesNotMatch(line, /Secret|secret/);
  const hung = await captureDataBrowserState(
    {
      url: () => "http://x.test/data",
      evaluate: () => new Promise<never>(() => {}),
    },
    "unmounted",
  );
  assert.equal(hung.outcome, "timeout");
  const broken = await captureDataBrowserState(
    {
      url: () => "http://x.test/data",
      evaluate: async () => {
        throw new Error("closed");
      },
    },
    "unmounted",
  );
  assert.equal(broken.outcome, "unreadable");
});

test("malformed browser projections are unreadable, never coerced", async () => {
  const good = { tabs: [], loader: false, alert: false, dialogCount: 0 };
  for (const bad of [
    null,
    "x",
    { ...good, dialogCount: "2" },
    { ...good, dialogCount: 1.5 },
    { ...good, dialogCount: -1 },
    { ...good, dialogCount: Number.NaN },
    { ...good, loader: "true" },
    { ...good, alert: 1 },
    { ...good, tabs: [1] },
    { ...good, tabs: "Warehouse" },
  ]) {
    const state = await captureDataBrowserState(
      { url: () => "http://x.test/data", evaluate: async () => bad as never },
      "unmounted",
    );
    assert.equal(state.outcome, "unreadable");
  }
});
