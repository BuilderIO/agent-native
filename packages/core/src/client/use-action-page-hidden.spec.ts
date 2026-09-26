// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import { callAction } from "./use-action.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function setDocumentVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  setDocumentVisibility("visible");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("actionFetch page_hidden (real visibilitychange wiring)", () => {
  it("is false for a call that stays visible throughout", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }, { status: 200 })),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ page_hidden: false }),
    );
  });

  it("is true when the document is hidden while the call is in flight", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    const { promise, resolve } = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(promise));

    const callPromise = callAction("list-plans", {}, { method: "GET" });
    setDocumentVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setDocumentVisibility("visible");
    resolve(jsonResponse({ ok: true }, { status: 200 }));
    await callPromise;

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ page_hidden: true }),
    );
  });

  it("is true when the call starts already hidden and the tab surfaces again before it completes", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    setDocumentVisibility("hidden");
    const { promise, resolve } = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(promise));

    const callPromise = callAction("list-plans", {}, { method: "GET" });
    setDocumentVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    resolve(jsonResponse({ ok: true }, { status: 200 }));
    await callPromise;

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ page_hidden: true }),
    );
  });
});
