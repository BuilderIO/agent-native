import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: () => ({
    userEmail: "timeout-test@example.test",
    orgId: "timeout-test-org",
  }),
  tryRequestCredentialContext: () => null,
  scopedCredentialCacheKey: (key: string) => `timeout-test:${key}`,
}));

vi.mock("./provider-credentials", () => ({
  resolveAnalyticsProviderCredential: async ({ keys }: { keys: string[] }) =>
    keys.includes("SENTRY_ORG_SLUG")
      ? null
      : {
          value: "fake-sentry-token",
          key: "SENTRY_AUTH_TOKEN",
          provider: "sentry",
          source: "workspace_connection",
          connectionId: "timeout-test-connection",
        },
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns: async () => false,
  createSsrfSafeDispatcher: async () => ({ dispatch: () => {} }),
}));

const { getIssueEvents } = await import("./sentry");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Sentry issue events provider timeout", () => {
  it("reports provider error responses instead of returning events", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("Unavailable", { status: 503 }),
    );

    await expect(
      getIssueEvents("unavailable", "test-org", "unavailable-connection"),
    ).rejects.toThrow("Sentry API error 503.");
  });

  it.each([
    { discoveryDelay: 7_000, succeeds: true },
    { discoveryDelay: 9_000, succeeds: false },
  ])(
    "handles organization discovery delayed by $discoveryDelay ms before retrieving events",
    async ({ discoveryDelay, succeeds }) => {
      vi.useFakeTimers();
      let started = () => {
        throw new Error("Fetch start signal was not initialized");
      };
      const fetchStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const events = [{ eventID: `discovery-${discoveryDelay}` }];
      vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        const isDiscovery = path === "/api/0/organizations/";
        if (
          !isDiscovery &&
          path !==
            `/api/0/organizations/discovered-org/issues/discovery-${discoveryDelay}/events/`
        ) {
          throw new Error(`Unexpected Sentry endpoint: ${path}`);
        }
        const body = isDiscovery ? [{ slug: "discovered-org" }] : events;
        const delay = isDiscovery ? discoveryDelay : 10_000;
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify(body), {
                  headers: { "content-type": "application/json" },
                }),
              ),
            delay,
          );
          init.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
          if (isDiscovery) started();
        });
      });

      const result = getIssueEvents(
        `discovery-${discoveryDelay}`,
        undefined,
        `discovery-${discoveryDelay}`,
      );
      const outcome = result.then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      );
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(discoveryDelay + 10_000);
      const settled = await outcome;
      if (succeeds) {
        expect(settled).toEqual({ value: events });
      } else {
        expect(settled).toEqual({ error: expect.any(Error) });
        expect("error" in settled && settled.error?.message).toContain(
          "Provider API request timed out after 8000ms",
        );
      }
    },
  );

  it.each([
    { issueId: "slow-success", delay: 10_000, succeeds: true },
    { issueId: "too-slow", delay: 21_000, succeeds: false },
  ])(
    "handles a response delayed by $delay ms",
    async ({ issueId, delay, succeeds }) => {
      vi.useFakeTimers();
      let started = () => {
        throw new Error("Fetch start signal was not initialized");
      };
      const fetchStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const events = [{ eventID: issueId, title: "Test event" }];
      vi.stubGlobal(
        "fetch",
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify(events), {
                    headers: { "content-type": "application/json" },
                  }),
                ),
              delay,
            );
            init.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
            started();
          }),
      );

      const result = getIssueEvents(
        issueId,
        "test-org",
        "timeout-test-connection",
      );
      const outcome = result.then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      );
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(delay);
      const settled = await outcome;
      if (succeeds) {
        expect(settled).toEqual({ value: events });
      } else {
        expect(settled).toEqual({ error: expect.any(Error) });
        expect("error" in settled && settled.error?.message).toContain(
          "Provider API request timed out after 20000ms",
        );
      }
    },
  );
});
