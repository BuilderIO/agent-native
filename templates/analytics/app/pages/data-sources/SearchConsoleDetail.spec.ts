import { describe, expect, it } from "vitest";

import {
  searchConsoleState,
  type ContentCollectionStatus,
} from "./SearchConsoleDetail";

function status(
  overrides: {
    enabled?: boolean;
    stepEnabled?: boolean;
    lastRun?: string | null;
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
                errorCode: null,
                errorMessage: null,
              },
      },
    ],
  };
}

describe("searchConsoleState", () => {
  it("is off until both the collection and the step are on", () => {
    expect(searchConsoleState(undefined)).toBe("off");
    expect(searchConsoleState(status({ enabled: false }))).toBe("off");
    expect(searchConsoleState(status({ stepEnabled: false }))).toBe("off");
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
