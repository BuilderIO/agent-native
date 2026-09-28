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

vi.mock("../metrics-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../metrics-store.js")>()),
  listAppUsageMetrics: listAppUsageMetricsMock,
}));

vi.mock("../../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

import { resetAppConfigForTests } from "../../app-config/index.js";
import { ALL_USAGE_APPS } from "../metrics-store.js";
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

  it("covers every app when no app filter is passed", async () => {
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
        app: ALL_USAGE_APPS,
      },
    );
  });

  it('treats app "all" as every app', async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", app: "all" },
      { caller: "frontend", userEmail: "owner@example.com" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: ALL_USAGE_APPS,
    });
  });

  it('resolves app "current" to the configured identity, not the static plugin context id', async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "me", app: "current" },
      {
        caller: "frontend",
        userEmail: "owner@example.com",
        appId: "plan",
      },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toMatchObject({
      app: "configured-app",
    });
  });

  it("filters to one app key", async () => {
    await getUsageMetrics.run(
      { sinceDays: 30, scope: "workspace", app: "mail" },
      { caller: "frontend", userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(listAppUsageMetricsMock.mock.calls[0]?.[1]).toEqual({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      app: "mail",
    });
  });

  it("rejects app and appId together instead of picking one", async () => {
    await expect(
      getUsageMetrics.run(
        { sinceDays: 30, scope: "me", app: "all", appId: "mail" },
        { caller: "frontend", userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("Pass app or appId, not both.");
    expect(listAppUsageMetricsMock).not.toHaveBeenCalled();
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
