import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  resolveA2ACallerAuth: vi.fn(),
  invokeAgentAction: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
  invokeAgentAction: mocks.invokeAgentAction,
}));

const discovery = vi.hoisted(() => ({
  analyticsUrl: "https://analytics.agent-native.com",
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () => [{ id: "analytics", url: discovery.analyticsUrl }],
}));

import { resetAppConfigForTests } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";

import { requestAnalytics } from "./analytics-peer.js";

const schema = z.object({ value: z.number() });

function answer(status: "completed" | "failed", output: string) {
  return { result: { action: "capture-dashboard-panel", status, output } };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

beforeEach(() => {
  vi.clearAllMocks();
  discovery.analyticsUrl = "https://analytics.agent-native.com";
  mocks.resolveA2ACallerAuth.mockResolvedValue({
    userEmail: "editor@example.test",
    orgDomain: "example.test",
    orgSecret: "org-secret",
  });
});

describe("requestAnalytics", () => {
  it("asks Analytics as the signed-in person and checks the answer", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    await expect(
      requestAnalytics(
        "capture-dashboard-panel",
        { dashboardId: "growth", panelId: "wau" },
        schema,
        58_000,
        "org_1",
      ),
    ).resolves.toEqual({ ok: true, data: { value: 3 } });
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith({
      target: "analytics",
      selfAppId: "content",
      action: "capture-dashboard-panel",
      input: { dashboardId: "growth", panelId: "wau" },
      userEmail: "editor@example.test",
      orgDomain: "example.test",
      orgSecret: "org-secret",
      requestTimeoutMs: 58_000,
    });
  });

  it("asks as the organization that opened the page, not the current one", async () => {
    const orgs: (string | undefined)[] = [];
    mocks.resolveA2ACallerAuth.mockImplementation(async () => {
      orgs.push(getRequestOrgId());
      return { userEmail: getRequestUserEmail() };
    });
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    await runWithRequestContext(
      { userEmail: "editor@example.test", orgId: "org_current" },
      async () => {
        await requestAnalytics(
          "capture-dashboard-panel",
          {},
          schema,
          58_000,
          "org_space",
        );
        await requestAnalytics(
          "capture-dashboard-panel",
          {},
          schema,
          58_000,
          null,
        );
      },
    );
    expect(orgs).toEqual(["org_space", undefined]);
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: "editor@example.test" }),
    );
  });

  it("asks nothing without a signed-in person", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValue({ userEmail: undefined });
    await expect(
      requestAnalytics("get-dashboard-panel-status", {}, schema, 15_000, null),
    ).resolves.toMatchObject({ ok: false, code: "analytics_signed_out" });
    expect(mocks.invokeAgentAction).not.toHaveBeenCalled();
  });

  it("passes on Analytics' own reason for a refusal", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("failed", JSON.stringify({ error: "Panel not found" })),
    );
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000, null),
    ).resolves.toEqual({
      ok: false,
      code: "analytics_refused",
      message: "Panel not found",
    });
  });

  it("says when Analytics can't be reached or answers nonsense", async () => {
    mocks.invokeAgentAction.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000, null),
    ).resolves.toMatchObject({ ok: false, code: "analytics_unreachable" });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer("completed", JSON.stringify({ value: "three" })),
    );
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000, null),
    ).resolves.toMatchObject({ ok: false, code: "analytics_invalid_response" });
  });

  it("logs the length, not the text, of an answer cut short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cut = `{"value": 4, "secret": "acme
...[truncated — full result was 55,508 chars]`;
    mocks.invokeAgentAction.mockResolvedValueOnce(answer("completed", cut));
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000, null),
    ).resolves.toMatchObject({ ok: false, code: "analytics_invalid_response" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("isn't JSON"), {
      action: "capture-dashboard-panel",
      chars: cut.length,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("acme");
    warn.mockRestore();
  });

  it("asks beta Analytics when Content is served from beta", async () => {
    vi.stubEnv("APP_URL", "https://beta.content.agent-native.com");
    resetAppConfigForTests();
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    await requestAnalytics("capture-dashboard-panel", {}, schema, 58_000, null);
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "https://beta.analytics.agent-native.com",
      }),
    );
  });

  it("asks the built-in Analytics by name on production and locally", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    for (const lane of [
      {
        content: "https://content.agent-native.com",
        analytics: "https://analytics.agent-native.com",
      },
      { content: "http://localhost:8083", analytics: "http://localhost:8084" },
    ]) {
      vi.stubEnv("APP_URL", lane.content);
      resetAppConfigForTests();
      discovery.analyticsUrl = lane.analytics;
      await requestAnalytics(
        "capture-dashboard-panel",
        {},
        schema,
        58_000,
        null,
      );
    }
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(2);
    expect(
      mocks.invokeAgentAction.mock.calls.map((call) => call[0]?.target),
    ).toEqual(["analytics", "analytics"]);
  });
});
