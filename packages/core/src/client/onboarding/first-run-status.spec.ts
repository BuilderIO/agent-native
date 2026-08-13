// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchFirstRunOnboardingStatus,
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
} from "./first-run-status.js";

describe("first-run onboarding status", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes the server decision for other initial flows", async () => {
    const listener = vi.fn();
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ firstRun: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchFirstRunOnboardingStatus()).resolves.toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });

  it("publishes an ineligible decision when the status request fails", async () => {
    const listener = vi.fn();
    window.addEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    await expect(fetchFirstRunOnboardingStatus()).rejects.toThrow(
      "first-run status: 503",
    );
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      firstRun: false,
    });
    window.removeEventListener(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      listener,
    );
  });
});
