import { describe, expect, it } from "vitest";

import {
  searchConsoleState,
  searchConsoleUpdate,
  type ContentCollectionStatus,
} from "./SearchConsoleDetail";

function status(
  overrides: {
    enabled?: boolean;
    stepEnabled?: boolean;
    lastRun?: string | null;
    errorCode?: string;
  } = {},
): ContentCollectionStatus {
  return {
    configured: true,
    enabled: overrides.enabled ?? true,
    config: { searchConsole: { enabled: true, sites: [] } },
    serviceAccount: { status: "missing" },
    steps: [
      {
        step: "search_console",
        enabled: overrides.stepEnabled ?? true,
        lastRun:
          overrides.lastRun === null || overrides.lastRun === undefined
            ? null
            : {
                status: overrides.lastRun,
                startedAt: "2026-10-15T07:00:00.000Z",
                errorCode: overrides.errorCode ?? null,
                errorMessage: null,
              },
      },
    ],
  };
}

describe("searchConsoleState", () => {
  it("is off until both the collection and the step are on", () => {
    expect(searchConsoleState(status({ enabled: false }))).toBe("off");
    expect(searchConsoleState(status({ stepEnabled: false }))).toBe("off");
  });

  it("keeps unreadable status distinct from disabled configuration", () => {
    expect(searchConsoleState(undefined)).toBe("unavailable");
    expect(searchConsoleState(status(), new Error("read failed"))).toBe(
      "unavailable",
    );
  });

  it("shows missing properties as not configured instead of needing access", () => {
    expect(
      searchConsoleState(
        status({
          lastRun: "not_configured",
          errorCode: "no_search_console_sites",
        }),
      ),
    ).toBe("off");
  });

  it("names a run without access as needing access, not as collecting", () => {
    expect(searchConsoleState(status({ lastRun: "not_configured" }))).toBe(
      "needs_access",
    );
  });

  it("names a failed run as failed", () => {
    expect(searchConsoleState(status({ lastRun: "failed" }))).toBe("failed");
  });

  it("treats a switched-on step that succeeded or has not run yet as collecting", () => {
    expect(searchConsoleState(status({ lastRun: "succeeded" }))).toBe(
      "collecting",
    );
    expect(searchConsoleState(status({ lastRun: null }))).toBe("collecting");
  });
});

describe("searchConsoleUpdate", () => {
  const sites = [{ siteUrl: "sc-domain:example.test" }];
  it("preserves a disabled job when saving an enabled step's properties", () => {
    expect(
      searchConsoleUpdate(status({ enabled: false }), true, sites),
    ).toEqual({
      enabled: false,
      searchConsole: true,
      searchConsoleSites: sites,
    });
  });
  it("enables the job only when switching the step on", () => {
    expect(
      searchConsoleUpdate(status({ enabled: false }), true, sites, true),
    ).toEqual({
      enabled: true,
      searchConsole: true,
      searchConsoleSites: sites,
    });
  });
  it("preserves the job and saved properties when switching off", () => {
    expect(searchConsoleUpdate(status(), false, sites, true)).toEqual({
      enabled: true,
      searchConsole: false,
    });
  });
});
