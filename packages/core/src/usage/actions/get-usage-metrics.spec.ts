import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAppUsageMetricsMock = vi.hoisted(() => vi.fn());

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../metrics-store.js", () => ({
  listAppUsageMetrics: listAppUsageMetricsMock,
}));

import { resetAppConfigForTests } from "../../app-config/index.js";
import getUsageMetrics from "./get-usage-metrics.js";

describe("get-usage-metrics action", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    vi.stubEnv("AGENT_NATIVE_APP_ID", "configured-app");
    listAppUsageMetricsMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("uses configured identity instead of the static plugin context id", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock).toHaveBeenCalledWith(
      { sinceDays: 30, scope: "me", userEmail: undefined },
      {
        ownerEmail: "owner@example.com",
        orgId: undefined,
        app: "configured-app",
      },
    );
  });

  it("keeps an explicit app filter authoritative", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", appId: "selected-app" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: "selected-app",
    });
  });
});
