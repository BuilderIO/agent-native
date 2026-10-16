import { beforeEach, describe, expect, it, vi } from "vitest";

import { BigQueryMaximumBytesBilledError } from "../server/lib/bigquery.js";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getHealth: vi.fn(),
  unavailable: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ to }: { to: string }) => `https://example.com${to}`,
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/first-party-analytics-health.js", () => ({
  getFirstPartyAnalyticsHealth: mocks.getHealth,
  unavailableFirstPartyAnalyticsHealth: mocks.unavailable,
}));

const action = (await import("./get-first-party-analytics-health")).default;

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.getHealth.mockReset();
  mocks.unavailable.mockReset();
  mocks.getRequestOrgId.mockReturnValue("org_123");
  mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
  mocks.getHealth.mockResolvedValue({ status: "healthy" });
  mocks.unavailable.mockReturnValue({ status: "unavailable" });
});

describe("get-first-party-analytics-health", () => {
  it("passes the request scope to the health reader", async () => {
    await expect(action.run({})).resolves.toEqual({ status: "healthy" });
    expect(mocks.getHealth).toHaveBeenCalledWith({
      userEmail: "alice@example.com",
      orgId: "org_123",
    });
  });

  it("does not turn a health read failure into a healthy result", async () => {
    mocks.getHealth.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(action.run({})).resolves.toEqual({ status: "unavailable" });
    expect(mocks.unavailable).toHaveBeenCalledTimes(1);
  });

  it("requires an authenticated request", async () => {
    mocks.getRequestUserEmail.mockReturnValueOnce(null);

    await expect(action.run({})).rejects.toThrow("no authenticated user");
    expect(mocks.getHealth).not.toHaveBeenCalled();
  });

  it("reports the typed byte cap failure as unavailable coverage", async () => {
    const { unavailableFirstPartyAnalyticsHealth } = await vi.importActual<
      typeof import("../server/lib/first-party-analytics-health.js")
    >("../server/lib/first-party-analytics-health.js");
    mocks.unavailable.mockImplementation(unavailableFirstPartyAnalyticsHealth);
    mocks.getHealth.mockRejectedValueOnce(
      new BigQueryMaximumBytesBilledError(400),
    );
    const result = await action.run({});
    expect(
      await action.outputSchema!["~standard"].validate(result),
    ).toMatchObject({
      value: {
        status: "unavailable",
        metrics: {
          coverage: { kind: "unavailable", reason: "maximum_bytes_billed" },
          eventCount: null,
          dailyRollupRows: null,
        },
      },
    });
    expect(mocks.unavailable).toHaveBeenCalledWith("maximum_bytes_billed");
  });
});
