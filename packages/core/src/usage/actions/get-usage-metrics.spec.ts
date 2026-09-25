import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAppUsageMetricsMock, isFeatureFlagEnabledMock } = vi.hoisted(
  () => ({
    listAppUsageMetricsMock: vi.fn(),
    isFeatureFlagEnabledMock: vi.fn(),
  }),
);

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../metrics-store.js", () => ({
  listAppUsageMetrics: listAppUsageMetricsMock,
}));

vi.mock("../../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

import { resetAppConfigForTests } from "../../app-config/index.js";
import getUsageMetrics from "./get-usage-metrics.js";

describe("get-usage-metrics action", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    vi.stubEnv("AGENT_NATIVE_APP_ID", "configured-app");
    listAppUsageMetricsMock.mockResolvedValue({ ok: true });
    isFeatureFlagEnabledMock.mockResolvedValue(false);
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
      {
        sinceDays: 30,
        scope: "me",
        userEmail: undefined,
        builderCreditsEnabled: false,
      },
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

  it("enables reported Builder credits only when the registered flag is on", async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);

    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me" },
      { caller: "frontend", userEmail: "owner@example.com" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[0]).toMatchObject({
      builderCreditsEnabled: true,
    });
  });
});
