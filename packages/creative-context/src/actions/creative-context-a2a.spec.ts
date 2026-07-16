import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  decodeRequest: vi.fn(),
  createResponseToken: vi.fn(),
  resolveLocal: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/isolated-a2a.js", () => ({
  decodeCreativeContextA2ARequest: mocks.decodeRequest,
  createCreativeContextA2AResponseToken: mocks.createResponseToken,
}));

vi.mock("../server/generation-context.js", () => ({
  resolveGenerationCreativeContextLocal: mocks.resolveLocal,
}));

import action from "./creative-context-a2a.js";

describe("creative-context-a2a receiver action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("alice@example.test");
    mocks.decodeRequest.mockReturnValue({
      protocol: "creative-context-a2a-v1",
      requestId: "87f466ae-32f4-4d0f-9de7-96f955e69f7b",
      operation: "resolve",
      payload: { role: "slides", query: "launch" },
    });
    mocks.resolveLocal.mockResolvedValue({
      contextMode: "auto",
      contextPackId: null,
      reuseLabels: [],
      results: [],
    });
    mocks.createResponseToken.mockReturnValue("response-token");
  });

  it("executes the local operation and returns the opaque response token", async () => {
    await expect(
      action.run({ requestToken: "request-token" }),
    ).resolves.toMatchObject({
      protocol: "creative-context-a2a-v1",
      responseToken: "response-token",
    });
    expect(mocks.resolveLocal).toHaveBeenCalledWith({
      role: "slides",
      query: "launch",
    });
  });

  it("rejects an A2A request without verified caller identity", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    await expect(action.run({ requestToken: "request-token" })).rejects.toThrow(
      /cryptographically verified caller identity/,
    );
    expect(mocks.decodeRequest).not.toHaveBeenCalled();
  });
});
