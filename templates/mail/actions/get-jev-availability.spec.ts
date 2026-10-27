import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDecisionsStatus: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({
  getDecisionsStatus: mocks.getDecisionsStatus,
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
  return { providers };
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

  it("keeps the configured result shape and accepts OpenAI-only access", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(
      status([
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ]),
    );

    await expect(action.run({})).resolves.toEqual({ configured: true });
    expect(mocks.getDecisionsStatus).toHaveBeenCalledWith("owner@example.test");
  });

  it("reports false only when all providers are known to be unavailable", async () => {
    await expect(action.run({})).resolves.toEqual({ configured: false });
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

    await expect(action.run({})).resolves.toEqual({ configured: false });
    expect(mocks.getDecisionsStatus).not.toHaveBeenCalled();
  });
});
