import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  resolveA2ACallerAuth: vi.fn(),
  invokeAgentAction: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
  invokeAgentAction: mocks.invokeAgentAction,
}));

import { requestAnalytics } from "./analytics-peer.js";

const schema = z.object({ value: z.number() });

function answer(status: "completed" | "failed", output: string) {
  return { result: { action: "capture-dashboard-panel", status, output } };
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("asks nothing without a signed-in person", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValue({ userEmail: undefined });
    await expect(
      requestAnalytics("get-dashboard-panel-status", {}, schema, 15_000),
    ).resolves.toMatchObject({ ok: false, code: "analytics_signed_out" });
    expect(mocks.invokeAgentAction).not.toHaveBeenCalled();
  });

  it("passes on Analytics' own reason for a refusal", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("failed", JSON.stringify({ error: "Panel not found" })),
    );
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000),
    ).resolves.toEqual({
      ok: false,
      code: "analytics_refused",
      message: "Panel not found",
    });
  });

  it("says when Analytics can't be reached or answers nonsense", async () => {
    mocks.invokeAgentAction.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000),
    ).resolves.toMatchObject({ ok: false, code: "analytics_unreachable" });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer("completed", JSON.stringify({ value: "three" })),
    );
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000),
    ).resolves.toMatchObject({ ok: false, code: "analytics_invalid_response" });
  });

  it("logs the length, not the text, of an answer cut short", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cut = `{"value": 4, "secret": "acme
...[truncated — full result was 55,508 chars]`;
    mocks.invokeAgentAction.mockResolvedValueOnce(answer("completed", cut));
    await expect(
      requestAnalytics("capture-dashboard-panel", {}, schema, 58_000),
    ).resolves.toMatchObject({ ok: false, code: "analytics_invalid_response" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("isn't JSON"), {
      action: "capture-dashboard-panel",
      chars: cut.length,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("acme");
    warn.mockRestore();
  });
});
