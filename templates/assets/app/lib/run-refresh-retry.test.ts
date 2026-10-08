import { describe, expect, it } from "vitest";

import { runRefreshRetryDelayMs } from "./run-refresh-retry";

describe("runRefreshRetryDelayMs", () => {
  it("never retries a run the server reports as gone", () => {
    expect(
      runRefreshRetryDelayMs(
        Object.assign(new Error("Generation run not found."), {
          status: 404,
          errorCode: "not_found",
        }),
      ),
    ).toBeNull();
  });

  it("retries a transient failure after 30 seconds", () => {
    expect(
      runRefreshRetryDelayMs(Object.assign(new Error("boom"), { status: 500 })),
    ).toBe(30_000);
    expect(runRefreshRetryDelayMs(new Error("Failed to fetch"))).toBe(30_000);
  });

  it("retries after a successful refresh settles", () => {
    expect(runRefreshRetryDelayMs(null)).toBe(30_000);
  });
});
