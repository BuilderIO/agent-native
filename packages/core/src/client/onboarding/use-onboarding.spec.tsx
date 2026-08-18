// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboarding, type UseOnboardingResult } from "./use-onboarding.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

// Regression for the "Skip/Continue silently does nothing" bug: a failed
// first-run completion must be a loud, typed failure (a rejected promise +
// a surfaced message), not a swallowed one indistinguishable from success.
describe("useOnboarding — completeFirstRun failure handling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOnboardingResult | null;

  function Harness() {
    latest = useOnboarding({ initialFirstRun: true });
    return null;
  }

  function stubFetch(completeImpl: () => Response | Promise<Response>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/steps")) return jsonResponse([]);
        if (url.includes("/onboarding/dismissed")) {
          return jsonResponse({ dismissed: false });
        }
        if (url.includes("/onboarding/profile")) {
          return jsonResponse({
            appId: "app",
            appName: "App",
            capabilities: [],
          });
        }
        if (url.includes("/onboarding/first-run/status")) {
          return jsonResponse({ firstRun: true });
        }
        if (url.includes("/onboarding/first-run/complete")) {
          return completeImpl();
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latest = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mountAndSettle() {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("rejects instead of silently resolving when the server rejects completion", async () => {
    stubFetch(() => jsonResponse({}, false, 500));
    await mountAndSettle();
    expect(latest?.firstRun).toBe(true);

    await act(async () => {
      await expect(latest!.completeFirstRun()).rejects.toThrow();
    });

    // Never falsely advance past a failed completion.
    expect(latest?.firstRun).toBe(true);
    expect(latest?.completeFirstRunError).toBeTruthy();
  });

  it("rejects instead of raising an unhandled rejection when the request itself fails", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    await mountAndSettle();

    await act(async () => {
      await expect(latest!.completeFirstRun()).rejects.toThrow("network down");
    });

    expect(latest?.firstRun).toBe(true);
    expect(latest?.completeFirstRunError).toBe("network down");
  });

  it("clears the error and completes on a successful retry", async () => {
    let completed = false;
    // Custom stub (not the shared stubFetch helper): the status check must
    // reflect completion, matching what the real server would report after
    // completeFirstRun's own post-success fetchAll() refresh.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/steps")) return jsonResponse([]);
        if (url.includes("/onboarding/dismissed")) {
          return jsonResponse({ dismissed: false });
        }
        if (url.includes("/onboarding/profile")) {
          return jsonResponse({
            appId: "app",
            appName: "App",
            capabilities: [],
          });
        }
        if (url.includes("/onboarding/first-run/status")) {
          return jsonResponse({ firstRun: !completed });
        }
        if (url.includes("/onboarding/first-run/complete")) {
          if (!completed) return jsonResponse({}, false, 500);
          return jsonResponse({});
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    await mountAndSettle();

    await act(async () => {
      await expect(latest!.completeFirstRun()).rejects.toThrow();
    });
    expect(latest?.completeFirstRunError).toBeTruthy();
    expect(latest?.firstRun).toBe(true);

    completed = true;
    await act(async () => {
      await latest!.completeFirstRun();
    });

    expect(latest?.completeFirstRunError).toBeNull();
    expect(latest?.firstRun).toBe(false);
  });
});
