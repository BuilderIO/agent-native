// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackEventMock = vi.hoisted(() => vi.fn());
const analyticsSessionIdMock = vi.hoisted(() =>
  vi.fn(() => "browser-session-42"),
);
const analyticsIdentityKeyMock = vi.hoisted(() =>
  vi.fn(() => "browser-identity-42"),
);
const analyticsIdentityResolverMock = vi.hoisted(() => vi.fn());

vi.mock("../analytics.js", () => ({
  getAnalyticsIdentityKey: () => analyticsIdentityKeyMock(),
  getAnalyticsSessionId: () => analyticsSessionIdMock(),
  resolveAnalyticsIdentityKey: () => analyticsIdentityResolverMock(),
  trackEvent: trackEventMock,
}));

import {
  __resetOnboardingEventDedupeForTests,
  __resetOnboardingSummaryReadsForTests,
  createOnboardingCorrelationId,
  requestCustomKeyOnboardingAbandonment,
  setCustomKeyOnboardingAttempt,
  setCustomKeyOnboardingSetupKind,
  trackCustomKeyOnboardingOutcome,
  trackOnboardingEvent,
  useCustomKeyOnboardingAttemptLifecycle,
  useOnboarding,
  withCustomKeyOnboardingCredentialSave,
  withCustomKeyOnboardingLocalEndpointSave,
  type UseOnboardingResult,
} from "./use-onboarding.js";

// The summary read is shared across hook instances at module scope, so one
// test's settled or stalled read must not answer the next test.
beforeEach(() => {
  __resetOnboardingSummaryReadsForTests();
  __resetOnboardingEventDedupeForTests();
  analyticsSessionIdMock.mockReturnValue("browser-session-42");
  analyticsIdentityKeyMock.mockReturnValue("browser-identity-42");
  analyticsIdentityResolverMock.mockImplementation(() =>
    Promise.resolve(analyticsIdentityKeyMock()),
  );
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("useOnboarding — completeFirstRun failure handling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOnboardingResult | null;

  function Harness() {
    latest = useOnboarding({ initialFirstRun: true });
    return null;
  }

  function stubFetch(
    completeImpl: () => Response | Promise<Response>,
    firstRun = true,
  ) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/onboarding/summary")) {
        return jsonResponse({
          steps: [],
          dismissed: false,
          profile: {
            appId: "app",
            appName: "App",
            capabilities: [],
          },
        });
      }
      if (url.includes("/onboarding/first-run/status")) {
        return jsonResponse({ firstRun });
      }
      if (url.includes("/onboarding/first-run/complete")) {
        return completeImpl();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trackEventMock.mockReset();
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
      await new Promise((resolve) => setTimeout(resolve, 300));
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

    expect(latest?.firstRun).toBe(true);
    expect(latest?.completeFirstRunError).toBeTruthy();
    expect(trackEventMock).toHaveBeenCalledWith("onboarding_failed", {
      flow: "first_run",
      stage: "complete",
      reason: "http_error",
      status_code: 500,
    });
  });

  it("preserves gate-granted first-run state while loading onboarding data", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}), false);
    await mountAndSettle();

    expect(latest?.firstRun).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/onboarding/first-run/status"),
      ),
    ).toHaveLength(0);
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
    expect(trackEventMock).toHaveBeenCalledWith("onboarding_failed", {
      flow: "first_run",
      stage: "complete",
      reason: "network_error",
    });
  });

  it("clears the error and completes on a successful retry", async () => {
    let completed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/summary")) {
          return jsonResponse({
            steps: [],
            dismissed: false,
            profile: {
              appId: "app",
              appName: "App",
              capabilities: [],
            },
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

describe("useOnboarding — summary timeout", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOnboardingResult | null;
  let summarySignal: AbortSignal | undefined;

  function Harness() {
    latest = useOnboarding({ initialFirstRun: true });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latest = null;
    summarySignal = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        summarySignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
        } as Response;
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("surfaces a stalled response body instead of leaving first-run loading forever", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(latest?.loading).toBe(true);
    expect(latest?.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(latest?.loading).toBe(false);
    expect(latest?.error).toBe("onboarding summary timed out");
    expect(summarySignal?.aborted).toBe(true);
  });

  it("ignores an older timeout after a newer refresh succeeds", async () => {
    let summaryCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        summaryCalls += 1;
        if (summaryCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: () => new Promise(() => {}),
          } as Response;
        }
        return jsonResponse({
          steps: [],
          dismissed: false,
          profile: { appId: "app", appName: "App", capabilities: [] },
        });
      }),
    );
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      await latest!.refresh();
    });
    expect(latest?.loading).toBe(false);
    expect(latest?.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(latest?.loading).toBe(false);
    expect(latest?.error).toBeNull();
  });
});

describe("trackOnboardingEvent", () => {
  beforeEach(() => {
    trackEventMock.mockReset();
    analyticsSessionIdMock.mockReturnValue("browser-session-42");
  });

  it("deduplicates a stable step view and allows a later step revisit", async () => {
    const properties = { flow: "first_run", step_id: "role" };
    function ViewOnMount() {
      React.useEffect(() => {
        trackOnboardingEvent("onboarding_step_viewed", properties);
      }, [properties]);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <React.StrictMode>
            <ViewOnMount />
          </React.StrictMode>,
        );
      });
      expect(trackEventMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      trackOnboardingEvent("onboarding_step_viewed", properties);
      expect(trackEventMock).toHaveBeenCalledTimes(1);

      trackOnboardingEvent("onboarding_step_viewed", {
        flow: "first_run",
        step_id: "choice",
      });
      trackOnboardingEvent("onboarding_step_viewed", properties);
      expect(trackEventMock).toHaveBeenCalledTimes(3);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("does not deduplicate step views across analytics sessions", () => {
    const properties = { flow: "first_run", step_id: "role" };
    trackOnboardingEvent("onboarding_step_viewed", properties);
    analyticsSessionIdMock.mockReturnValue("session-2");
    trackOnboardingEvent("onboarding_step_viewed", properties);

    expect(trackEventMock).toHaveBeenCalledTimes(2);

    trackOnboardingEvent("onboarding_reopened", { flow: "first_run" });
    trackOnboardingEvent("onboarding_step_viewed", properties);
    expect(trackEventMock).toHaveBeenCalledTimes(4);
  });

  it("keeps a completion refetch from duplicating the same step view", () => {
    const properties = { flow: "first_run", step_id: "role" };
    trackOnboardingEvent("onboarding_step_viewed", properties);
    trackOnboardingEvent("onboarding_step_completed", properties);
    trackOnboardingEvent("onboarding_step_viewed", properties);

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("keeps one-time events deduped within each analytics session", () => {
    const properties = { flow: "first_run" };
    trackOnboardingEvent("onboarding_started", properties);
    trackOnboardingEvent("onboarding_started", properties);
    analyticsSessionIdMock.mockReturnValue("session-2");
    trackOnboardingEvent("onboarding_started", properties);

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct integration and role intents distinct", () => {
    trackOnboardingEvent("integration_cta_clicked", {
      flow: "first_run",
      step_id: "tools",
      integration_id: "context7",
    });
    trackOnboardingEvent("integration_cta_clicked", {
      flow: "first_run",
      step_id: "tools",
      integration_id: "linear",
    });
    trackOnboardingEvent("onboarding_role_option_selected", {
      flow: "first_run",
      step_id: "role",
      role: "developer",
    });

    expect(trackEventMock).toHaveBeenCalledTimes(3);
  });

  it("does not deduplicate integration retries", () => {
    const properties = {
      flow: "first_run",
      step_id: "tools",
      integration_id: "context7",
    };
    trackOnboardingEvent("integration_cta_clicked", properties);
    trackOnboardingEvent("integration_cta_clicked", properties);
    trackOnboardingEvent("integration_connect_started", properties);
    trackOnboardingEvent("integration_connect_started", properties);
    trackOnboardingEvent("integration_connect_failed", {
      ...properties,
      error_type: "Error",
    });
    trackOnboardingEvent("integration_connect_failed", {
      ...properties,
      error_type: "popup_or_navigation_blocked",
    });

    expect(trackEventMock).toHaveBeenCalledTimes(6);
  });

  it("does not deduplicate role save retries", () => {
    const properties = {
      flow: "first_run",
      step_id: "role",
      role: "developer",
    };
    trackOnboardingEvent("onboarding_role_save_started", properties);
    trackOnboardingEvent("onboarding_role_save_started", properties);

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("does not deduplicate setup-method outcomes across attempts", () => {
    const properties = {
      flow: "first_run",
      step_id: "choice",
      method_id: "builder_create_account",
      outcome: "failed",
    };
    trackOnboardingEvent("onboarding_method_outcome", {
      ...properties,
      onboarding_attempt_id: "attempt-1",
    });
    trackOnboardingEvent("onboarding_method_outcome", {
      ...properties,
      onboarding_attempt_id: "attempt-2",
    });

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates correlation-unavailable events within an attempt", () => {
    const properties = {
      flow: "first_run",
      step_id: "choice",
      onboarding_attempt_id: "attempt-correlation-unavailable-1",
    };
    trackOnboardingEvent("onboarding_correlation_unavailable", properties);
    trackOnboardingEvent("onboarding_correlation_unavailable", properties);
    trackOnboardingEvent("onboarding_correlation_unavailable", {
      ...properties,
      onboarding_attempt_id: "attempt-correlation-unavailable-2",
    });

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("keeps abandonment events distinct across onboarding attempts", () => {
    const properties = {
      flow: "first_run",
      step_id: "role",
      reason: "page_exit",
    };
    trackOnboardingEvent("onboarding_abandoned", properties);
    trackOnboardingEvent("onboarding_abandoned", properties);

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates one step visit while retaining a later revisit", () => {
    const viewed = (stepViewId: string) =>
      trackOnboardingEvent("onboarding_step_viewed", {
        flow: "first_run",
        step_id: "choice",
        step_view_id: stepViewId,
      });

    viewed("visit-1");
    viewed("visit-1");
    viewed("visit-2");

    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });

  it("links custom-key outcomes to the handed-off attempt without recording values", async () => {
    await setCustomKeyOnboardingAttempt("attempt-1");

    expect(trackCustomKeyOnboardingOutcome("credential_entry_started")).toBe(
      "tracked",
    );
    expect(trackCustomKeyOnboardingOutcome("credential_entry_started")).toBe(
      "duplicate",
    );
    expect(trackCustomKeyOnboardingOutcome("credential_validated")).toBe(
      "tracked",
    );
    expect(trackCustomKeyOnboardingOutcome("credential_validated")).toBe(
      "duplicate",
    );
    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("tracked");
    expect(trackCustomKeyOnboardingOutcome("credential_validated")).toBe(
      "missing",
    );
    expect(trackEventMock.mock.calls).toEqual([
      [
        "onboarding_method_outcome",
        expect.objectContaining({
          method_id: "custom_keys",
          onboarding_attempt_id: "attempt-1",
          outcome: "credential_entry_started",
        }),
      ],
      [
        "onboarding_method_outcome",
        expect.objectContaining({
          method_id: "custom_keys",
          onboarding_attempt_id: "attempt-1",
          outcome: "credential_validated",
        }),
      ],
      [
        "onboarding_method_outcome",
        expect.objectContaining({
          method_id: "custom_keys",
          onboarding_attempt_id: "attempt-1",
          outcome: "credential_saved",
        }),
      ],
    ]);
  });

  it("preserves a custom-key attempt when the browser session rotates", async () => {
    await setCustomKeyOnboardingAttempt("attempt-session-rotation");
    analyticsSessionIdMock.mockReturnValue("browser-session-43");

    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("tracked");
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-session-rotation",
        outcome: "credential_saved",
      }),
    );
  });

  it("discards a custom-key attempt after the analytics identity changes", async () => {
    await setCustomKeyOnboardingAttempt("attempt-identity-rotation");
    analyticsIdentityKeyMock.mockReturnValue("browser-identity-43");

    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
      "identity_mismatch",
    );
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("does not store a custom-key attempt until analytics identity resolves", async () => {
    let resolveIdentity!: (identity: string | undefined) => void;
    analyticsIdentityResolverMock.mockReturnValueOnce(
      new Promise<string | undefined>((resolve) => {
        resolveIdentity = resolve;
      }),
    );

    const attempt = setCustomKeyOnboardingAttempt(
      "attempt-unresolved-identity",
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
    expect(trackCustomKeyOnboardingOutcome("credential_entry_started")).toBe(
      "pending",
    );

    resolveIdentity("resolved-user-identity");
    analyticsIdentityKeyMock.mockReturnValue("resolved-user-identity");
    expect(await attempt).toBe("stored");
    const stored = JSON.parse(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ) ?? "null",
    ) as { identityKey?: string } | null;
    expect(stored?.identityKey).toBe("resolved-user-identity");
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-unresolved-identity",
        outcome: "credential_entry_started",
      }),
    );
    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("tracked");
  });

  it("marks outcomes explicitly when no safe analytics identity resolves", async () => {
    analyticsIdentityResolverMock.mockResolvedValueOnce(undefined);

    expect(await setCustomKeyOnboardingAttempt("attempt-no-session")).toBe(
      "no_session",
    );
    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
      "tracked_uncorrelated",
    );
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-no-session",
        outcome: "credential_saved",
        correlation_status: "unavailable",
      }),
    );
  });

  it("discards an unavailable attempt when analytics identity changes", async () => {
    analyticsIdentityResolverMock.mockResolvedValueOnce(undefined);

    expect(
      await setCustomKeyOnboardingAttempt("attempt-unavailable-identity"),
    ).toBe("no_session");
    analyticsIdentityKeyMock.mockReturnValue("browser-identity-43");

    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
      "identity_mismatch",
    );
    expect(trackEventMock).not.toHaveBeenCalled();
    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("missing");
  });

  it("uses the in-memory attempt if session storage becomes unavailable", async () => {
    const key = "agent-native.onboarding.custom_keys_attempt";
    const storage = window.sessionStorage;
    storage.removeItem(key);
    const sessionStorage = vi
      .spyOn(window, "sessionStorage", "get")
      .mockReturnValue({
        clear: () => storage.clear(),
        getItem: (itemKey) => storage.getItem(itemKey),
        key: (index) => storage.key(index),
        removeItem: (itemKey) => storage.removeItem(itemKey),
        setItem: (itemKey, value) => {
          if (itemKey === key) {
            throw new Error("session storage unavailable");
          }
          storage.setItem(itemKey, value);
        },
        get length() {
          return storage.length;
        },
      } as Storage);

    try {
      expect(
        await setCustomKeyOnboardingAttempt("attempt-memory-fallback"),
      ).toBe("unavailable");
      expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
        "tracked",
      );
      expect(trackEventMock).toHaveBeenCalledWith(
        "onboarding_method_outcome",
        expect.objectContaining({
          onboarding_attempt_id: "attempt-memory-fallback",
          outcome: "credential_saved",
        }),
      );
    } finally {
      sessionStorage.mockRestore();
    }
  });

  it("discards a memory fallback when analytics identity changes", async () => {
    const key = "agent-native.onboarding.custom_keys_attempt";
    const storage = window.sessionStorage;
    storage.removeItem(key);
    const sessionStorage = vi
      .spyOn(window, "sessionStorage", "get")
      .mockReturnValue({
        clear: () => storage.clear(),
        getItem: (itemKey) => storage.getItem(itemKey),
        key: (index) => storage.key(index),
        removeItem: (itemKey) => storage.removeItem(itemKey),
        setItem: (itemKey, value) => {
          if (itemKey === key) {
            throw new Error("session storage unavailable");
          }
          storage.setItem(itemKey, value);
        },
        get length() {
          return storage.length;
        },
      } as Storage);

    try {
      expect(
        await setCustomKeyOnboardingAttempt("attempt-memory-identity-change"),
      ).toBe("unavailable");
      analyticsIdentityKeyMock.mockReturnValue("browser-identity-43");

      expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
        "identity_mismatch",
      );
      expect(trackEventMock).not.toHaveBeenCalled();
      expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe(
        "missing",
      );
    } finally {
      sessionStorage.mockRestore();
    }
  });

  it("uses a terminal local-endpoint outcome without a credential outcome", async () => {
    await setCustomKeyOnboardingAttempt("attempt-local-endpoint-skipped");

    expect(trackCustomKeyOnboardingOutcome("local_endpoint_skipped")).toBe(
      "tracked",
    );
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-local-endpoint-skipped",
        outcome: "local_endpoint_skipped",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("discards a custom-key attempt carried into another document without abandonment", async () => {
    await setCustomKeyOnboardingAttempt("attempt-old-document");
    const key = "agent-native.onboarding.custom_keys_attempt";
    const stored = window.sessionStorage.getItem(key);
    expect(stored).not.toBeNull();
    if (!stored) throw new Error("Expected a stored onboarding attempt");
    const attempt = JSON.parse(stored) as Record<string, unknown>;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ ...attempt, documentId: "old" }),
    );

    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("stale");
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});

describe("useCustomKeyOnboardingAttemptLifecycle", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  function Harness() {
    useCustomKeyOnboardingAttemptLifecycle();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trackEventMock.mockReset();
    analyticsSessionIdMock.mockReturnValue("browser-session-42");
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("preserves the attempt during a back-forward cache pagehide", async () => {
    await setCustomKeyOnboardingAttempt("attempt-bfcache");
    await act(async () => root?.render(<Harness />));

    const event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: true });
    act(() => window.dispatchEvent(event));

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(trackCustomKeyOnboardingOutcome("credential_saved")).toBe("tracked");
  });

  it("discards a stale attempt when a new document enters settings", async () => {
    await setCustomKeyOnboardingAttempt("attempt-new-document");
    const key = "agent-native.onboarding.custom_keys_attempt";
    const stored = window.sessionStorage.getItem(key);
    expect(stored).not.toBeNull();
    if (!stored) throw new Error("Expected a stored onboarding attempt");
    const attempt = JSON.parse(stored) as Record<string, unknown>;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ ...attempt, documentId: "old" }),
    );

    await act(async () => root?.render(<Harness />));

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("records abandonment when the settings route unmounts", async () => {
    await setCustomKeyOnboardingAttempt("attempt-route-exit");
    await act(async () => root?.render(<Harness />));
    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });

    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-route-exit",
        outcome: "credential_abandoned",
      }),
    );
  });

  it("records local endpoint abandonment on page exit", async () => {
    await setCustomKeyOnboardingAttempt("attempt-local-endpoint-route-exit");
    expect(setCustomKeyOnboardingSetupKind("local_endpoint")).toBe("stored");
    await act(async () => root?.render(<Harness />));
    await act(async () => {
      const pagehide = new Event("pagehide");
      Object.defineProperty(pagehide, "persisted", { value: false });
      window.dispatchEvent(pagehide);
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-local-endpoint-route-exit",
        outcome: "local_endpoint_abandoned",
      }),
    );
    expect(trackEventMock).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({ outcome: "credential_abandoned" }),
    );
  });

  it("keeps an attempt through settings unmount until a pending save succeeds", async () => {
    await setCustomKeyOnboardingAttempt("attempt-save-during-unmount");
    await act(async () => root?.render(<Harness />));

    let resolveSave!: () => void;
    const save = withCustomKeyOnboardingCredentialSave(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();

    await act(async () => {
      resolveSave();
      await save;
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-save-during-unmount",
        outcome: "credential_saved",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("resolves a requested abandonment to the pending save outcome", async () => {
    await setCustomKeyOnboardingAttempt("attempt-dismiss-pending-save");

    let resolveSave!: () => void;
    const save = withCustomKeyOnboardingCredentialSave(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    requestCustomKeyOnboardingAbandonment();

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();

    await act(async () => {
      resolveSave();
      await save;
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-dismiss-pending-save",
        outcome: "credential_saved",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("records abandonment after a dismissed pending save fails", async () => {
    await setCustomKeyOnboardingAttempt("attempt-dismiss-failed-save");

    let rejectSave!: (error: Error) => void;
    const save = withCustomKeyOnboardingCredentialSave(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    requestCustomKeyOnboardingAbandonment();

    expect(trackEventMock).not.toHaveBeenCalled();

    await act(async () => {
      rejectSave(new Error("save failed"));
      await expect(save).rejects.toThrow("save failed");
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-dismiss-failed-save",
        outcome: "credential_abandoned",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("lets a pending local endpoint save win over pagehide abandonment", async () => {
    await setCustomKeyOnboardingAttempt("attempt-local-endpoint-save");
    expect(setCustomKeyOnboardingSetupKind("local_endpoint")).toBe("stored");
    await act(async () => root?.render(<Harness />));

    let resolveSave!: () => void;
    const save = withCustomKeyOnboardingLocalEndpointSave(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: false });
    act(() => window.dispatchEvent(pagehide));

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();

    await act(async () => {
      resolveSave();
      await save;
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-local-endpoint-save",
        outcome: "local_endpoint_saved",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("keeps local endpoint abandonment separate when its pending save fails", async () => {
    await setCustomKeyOnboardingAttempt("attempt-local-endpoint-failed-save");

    let rejectSave!: (error: Error) => void;
    const save = withCustomKeyOnboardingLocalEndpointSave(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    requestCustomKeyOnboardingAbandonment();

    await act(async () => {
      rejectSave(new Error("save failed"));
      await expect(save).rejects.toThrow("save failed");
    });

    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-local-endpoint-failed-save",
        outcome: "local_endpoint_abandoned",
      }),
    );
    expect(trackEventMock.mock.calls[0]?.[1]).not.toMatchObject({
      outcome: "credential_abandoned",
    });
  });

  it("defers pagehide abandonment until a pending credential save fails", async () => {
    await setCustomKeyOnboardingAttempt("attempt-failed-save-after-unmount");
    await act(async () => root?.render(<Harness />));

    let rejectSave!: (error: Error) => void;
    const save = withCustomKeyOnboardingCredentialSave(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );

    const event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: false });
    act(() => window.dispatchEvent(event));
    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();

    await act(async () => {
      rejectSave(new Error("save failed"));
      await expect(save).rejects.toThrow("save failed");
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-failed-save-after-unmount",
        outcome: "credential_abandoned",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("lets a pending credential save win over pagehide abandonment", async () => {
    await setCustomKeyOnboardingAttempt("attempt-credential-pagehide-save");
    await act(async () => root?.render(<Harness />));

    let resolveSave!: () => void;
    const save = withCustomKeyOnboardingCredentialSave(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: false });
    act(() => window.dispatchEvent(pagehide));

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();

    await act(async () => {
      resolveSave();
      await save;
    });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        onboarding_attempt_id: "attempt-credential-pagehide-save",
        outcome: "credential_saved",
      }),
    );
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).toBeNull();
  });

  it("leaves an attempt available for retry after a save fails while settings stays mounted", async () => {
    await setCustomKeyOnboardingAttempt("attempt-retry-save");
    await act(async () => root?.render(<Harness />));

    await expect(
      withCustomKeyOnboardingCredentialSave(() =>
        Promise.reject(new Error("save failed")),
      ),
    ).rejects.toThrow("save failed");

    expect(trackEventMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "agent-native.onboarding.custom_keys_attempt",
      ),
    ).not.toBeNull();
  });

  it("uses fallback correlation IDs without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});

    const first = createOnboardingCorrelationId();
    const second = createOnboardingCorrelationId();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[a-z0-9-]+$/);
  });

  it("does not treat Strict Mode effect replay as abandonment", async () => {
    await setCustomKeyOnboardingAttempt("attempt-strict-mode");
    await act(async () => {
      root?.render(
        <React.StrictMode>
          <Harness />
        </React.StrictMode>,
      );
      await Promise.resolve();
    });

    expect(trackEventMock).not.toHaveBeenCalled();

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });
    expect(trackEventMock).toHaveBeenCalledTimes(1);
  });
});

describe("useOnboarding — focus during the deferral window", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOnboardingResult | null;
  let summaryCalls = 0;

  function Harness() {
    latest = useOnboarding({ initialFirstRun: true });
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latest = null;
    summaryCalls = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/summary")) {
          summaryCalls += 1;
          return jsonResponse({
            steps: [],
            dismissed: false,
            profile: {
              appId: "app",
              appName: "App",
              capabilities: [],
            },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function settlePastPaintWindow() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("focus inside the window consumes the scheduled read instead of duplicating it", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(summaryCalls).toBe(1);

    await settlePastPaintWindow();
    expect(summaryCalls).toBe(1);
    expect(latest?.error).toBeNull();
    expect(latest?.loading).toBe(false);
  });

  it("visibility-visible inside the window behaves the same", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(summaryCalls).toBe(1);

    await settlePastPaintWindow();
    expect(summaryCalls).toBe(1);
    expect(latest?.error).toBeNull();
    delete (document as { visibilityState?: string }).visibilityState;
  });
});

describe("useOnboarding — degraded summary tolerance", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOnboardingResult | null;

  function Harness() {
    latest = useOnboarding({ initialFirstRun: true });
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latest = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/summary")) {
          return jsonResponse({
            steps: [
              {
                id: "llm",
                title: "Connect an AI engine",
                description: "Pick an engine to power the agent.",
                order: 10,
                required: true,
                complete: false,
                methods: [],
              },
            ],
            dismissed: false,
            profile: {
              appId: "app",
              appName: "App",
              capabilities: [],
            },
          });
        }
        if (url.includes("/onboarding/first-run/status")) {
          return jsonResponse({ firstRun: false });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps steps and profile when the summary answers with safe-default dismissed data", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.error).toBeNull();
    expect(latest?.steps).toHaveLength(1);
    expect(latest?.steps[0]?.id).toBe("llm");
    expect(latest?.profile).toEqual({
      appId: "app",
      appName: "App",
      capabilities: [],
    });
    expect(latest?.dismissed).toBe(false);
  });
});

describe("useOnboarding — one summary for every mounted consumer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const results = new Map<string, UseOnboardingResult>();
  let summaryCalls = 0;
  let pageAgeMs = 0;

  function Consumer({ label }: { label: string }) {
    results.set(label, useOnboarding());
    return null;
  }

  function Consumers({ labels }: { labels: string[] }) {
    return labels.map((label) => <Consumer key={label} label={label} />);
  }

  async function advance(ms: number) {
    await act(async () => {
      pageAgeMs += ms;
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    pageAgeMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => pageAgeMs);
    results.clear();
    summaryCalls = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/onboarding/summary")) {
          summaryCalls += 1;
          return jsonResponse({
            steps: [
              {
                id: "llm",
                title: "Connect an AI engine",
                description: "Pick an engine to power the agent.",
                order: 10,
                required: true,
                complete: summaryCalls > 1,
                methods: [],
              },
            ],
            dismissed: false,
            profile: { appId: "app", appName: "App", capabilities: [] },
          });
        }
        if (url.includes("/onboarding/first-run/status")) {
          return jsonResponse({ firstRun: false });
        }
        if (url.includes("/onboarding/steps/llm/complete")) {
          return jsonResponse({ ok: true });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits out startup, then answers the setup button and the panel with one request", async () => {
    await act(async () => {
      root.render(<Consumers labels={["setup-button", "panel"]} />);
    });

    await advance(1_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(summaryCalls).toBe(0);

    await advance(2_600);
    expect(summaryCalls).toBe(1);
    expect(results.get("setup-button")?.steps).toHaveLength(1);
    expect(results.get("panel")?.steps).toHaveLength(1);
  });

  it("reuses a summary that just landed for a consumer mounted right after it", async () => {
    await act(async () => {
      root.render(<Consumers labels={["panel"]} />);
    });
    await advance(3_600);
    expect(summaryCalls).toBe(1);

    await act(async () => {
      root.render(<Consumers labels={["panel", "setup-button"]} />);
    });
    await advance(600);

    expect(summaryCalls).toBe(1);
    expect(results.get("setup-button")?.loading).toBe(false);
    expect(results.get("setup-button")?.steps).toHaveLength(1);
  });

  it("reads a fresh summary after this tab completes a step", async () => {
    await act(async () => {
      root.render(<Consumers labels={["panel"]} />);
    });
    await advance(3_600);
    expect(results.get("panel")?.steps[0]?.complete).toBe(false);

    await act(async () => {
      await results.get("panel")!.complete("llm");
    });

    expect(summaryCalls).toBe(2);
    expect(results.get("panel")?.steps[0]?.complete).toBe(true);
  });

  describe("the sidebar first-run fallback", () => {
    function Fallback() {
      results.set("sidebar-fallback", useOnboarding({ firstRunSurface: true }));
      return null;
    }

    async function summaryReadsAtPaint(cookie: () => string) {
      vi.spyOn(document, "cookie", "get").mockImplementation(cookie);
      await act(async () => {
        root.render(<Fallback />);
      });
      await advance(600);
      return summaryCalls;
    }

    it("reads at paint while the first-run cookie is present", async () => {
      expect(await summaryReadsAtPaint(() => "agent-native-first-run=1")).toBe(
        1,
      );
    });

    it("reads at paint where the first-run cookie is unreadable", async () => {
      expect(
        await summaryReadsAtPaint(() => {
          throw new DOMException("cookies are blocked", "SecurityError");
        }),
      ).toBe(1);
    });

    it("waits for startup once the first-run cookie is gone, since the server then reports no first run", async () => {
      expect(await summaryReadsAtPaint(() => "an_session_hint=1")).toBe(0);
      await advance(3_000);
      expect(summaryCalls).toBe(1);
    });

    it("leaves setup hints waiting even while the first-run cookie is present", async () => {
      vi.spyOn(document, "cookie", "get").mockImplementation(
        () => "agent-native-first-run=1",
      );
      await act(async () => {
        root.render(<Consumers labels={["setup-button"]} />);
      });
      await advance(600);

      expect(summaryCalls).toBe(0);
    });
  });

  it("keeps the first-run surface on the paint-aligned read", async () => {
    function FirstRun() {
      results.set("first-run", useOnboarding({ initialFirstRun: true }));
      return null;
    }
    await act(async () => {
      root.render(<FirstRun />);
    });
    await advance(600);

    expect(summaryCalls).toBe(1);
    expect(results.get("first-run")?.loading).toBe(false);
  });
});
