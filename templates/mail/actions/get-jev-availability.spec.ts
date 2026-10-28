import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDecisionsStatus: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({
  getDecisionsStatus: mocks.getDecisionsStatus,
  JEV_DECISIONS_MODEL: "jev-latest",
  OPENAI_DECISIONS_MODEL: "gpt-6-luna",
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import action from "./get-jev-availability";

function status(
  providers: Array<{
    provider: "jev" | "openai";
    status: "ready" | "not_configured" | "unknown";
  }>,
) {
  return { providerOrder: ["jev", "openai"], providers };
}

describe("get-jev-availability action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.getDecisionsStatus.mockResolvedValue(
      status([
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "not_configured" },
      ]),
    );
  });

  it("accepts OpenAI-only access and returns its provider status identity", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(
      status([
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ]),
    );

    const result = await action.run({});
    expect(result).toEqual({
      configured: true,
      providerIdentity: JSON.stringify({
        providerOrder: ["jev", "openai"],
        providers: [
          { provider: "jev", status: "not_configured", model: "jev-latest" },
          { provider: "openai", status: "ready", model: "gpt-6-luna" },
        ],
      }),
    });
    expect(mocks.getDecisionsStatus).toHaveBeenCalledWith("owner@example.test");
  });

  it("changes the provider identity when the active order or readiness changes", async () => {
    mocks.getDecisionsStatus.mockResolvedValueOnce({
      providerOrder: ["jev", "openai"],
      providers: [
        { provider: "jev", status: "ready" },
        { provider: "openai", status: "not_configured" },
      ],
    });
    const jevReady = await action.run({});

    mocks.getDecisionsStatus.mockResolvedValueOnce({
      providerOrder: ["openai", "jev"],
      providers: [
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ],
    });
    const openAiReady = await action.run({});

    expect(jevReady.providerIdentity).not.toBe(openAiReady.providerIdentity);
  });

  it("reports false only when all providers are known to be unavailable", async () => {
    await expect(action.run({})).resolves.toMatchObject({ configured: false });
  });

  it("does not turn unknown provider status into not configured", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(
      status([
        { provider: "jev", status: "unknown" },
        { provider: "openai", status: "not_configured" },
      ]),
    );

    await expect(action.run({})).rejects.toThrow(
      "Decision provider availability could not be checked.",
    );
  });

  it("does not look up status without an authenticated user", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);

    await expect(action.run({})).resolves.toEqual({
      configured: false,
      providerIdentity: "unavailable",
    });
    expect(mocks.getDecisionsStatus).not.toHaveBeenCalled();
  });
});
