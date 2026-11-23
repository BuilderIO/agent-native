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

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () => [
    { id: "design", url: "https://design.agent-native.com" },
  ],
}));

import { resetAppConfigForTests } from "@agent-native/core/server";

import { requestDesign } from "./design-peer.js";

const schema = z.object({ value: z.number() });

function answer(status: "completed" | "failed", output: string) {
  return { result: { action: "capture-design-screen", status, output } };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveA2ACallerAuth.mockResolvedValue({
    userEmail: "editor@example.test",
    orgDomain: "example.test",
    orgSecret: "org-secret",
  });
});

describe("requestDesign", () => {
  it("asks Design as the signed-in person and checks the answer", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    await expect(
      requestDesign(
        "capture-design-screen",
        { designId: "checkout", screenId: "pay" },
        schema,
        58_000,
        "org_1",
      ),
    ).resolves.toEqual({ ok: true, data: { value: 3 } });
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith({
      target: "design",
      selfAppId: "content",
      action: "capture-design-screen",
      input: { designId: "checkout", screenId: "pay" },
      userEmail: "editor@example.test",
      orgDomain: "example.test",
      orgSecret: "org-secret",
      requestTimeoutMs: 58_000,
    });
  });

  it("asks nothing without a signed-in person", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValue({ userEmail: undefined });
    await expect(
      requestDesign("get-design-screen-status", {}, schema, 15_000, null),
    ).resolves.toEqual({
      ok: false,
      code: "design_signed_out",
      message: "Sign in to pin Design screens.",
    });
    expect(mocks.invokeAgentAction).not.toHaveBeenCalled();
  });

  it("passes on Design's own reason for a refusal", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer(
        "failed",
        JSON.stringify({ error: "This screen has live effects." }),
      ),
    );
    await expect(
      requestDesign("capture-design-screen", {}, schema, 58_000, null),
    ).resolves.toEqual({
      ok: false,
      code: "design_refused",
      message: "This screen has live effects.",
    });
  });

  it("keeps the code Design gave its refusal", async () => {
    mocks.invokeAgentAction.mockResolvedValue(
      answer(
        "failed",
        JSON.stringify({
          error:
            "Error running capture-design-screen: This screen shows a running app. (errorCode: design_screen_live_app)",
        }),
      ),
    );
    await expect(
      requestDesign("capture-design-screen", {}, schema, 58_000, null),
    ).resolves.toMatchObject({
      ok: false,
      code: "design_refused",
      peerCode: "design_screen_live_app",
    });
  });

  it("says when Design can't be reached or answers nonsense", async () => {
    mocks.invokeAgentAction.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      requestDesign("capture-design-screen", {}, schema, 58_000, null),
    ).resolves.toMatchObject({ ok: false, code: "design_unreachable" });

    mocks.invokeAgentAction.mockResolvedValueOnce(
      answer("completed", JSON.stringify({ value: "three" })),
    );
    await expect(
      requestDesign("capture-design-screen", {}, schema, 58_000, null),
    ).resolves.toMatchObject({ ok: false, code: "design_invalid_response" });
  });

  it("asks beta Design when Content is served from beta", async () => {
    vi.stubEnv("APP_URL", "https://beta.content.agent-native.com");
    resetAppConfigForTests();
    mocks.invokeAgentAction.mockResolvedValue(
      answer("completed", JSON.stringify({ value: 3 })),
    );
    await requestDesign("capture-design-screen", {}, schema, 58_000, null);
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "https://beta.design.agent-native.com",
      }),
    );
  });
});
