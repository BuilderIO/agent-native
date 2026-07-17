import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  decodeRequest: vi.fn(),
  createResponseToken: vi.fn(),
  resolveLocal: vi.fn(),
  verifyArtifactAccess: vi.fn(),
  getGeneration: vi.fn(),
  recordGeneration: vi.fn(),
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

vi.mock("../server/generation-artifact-access.js", () => ({
  verifyGenerationArtifactAccessCapability: mocks.verifyArtifactAccess,
}));

vi.mock("../store/generation.js", () => ({
  getGenerationCreativeContext: mocks.getGeneration,
  recordGenerationCreativeContext: mocks.recordGeneration,
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
    mocks.verifyArtifactAccess.mockResolvedValue({ verified: true });
    mocks.getGeneration.mockResolvedValue(null);
    mocks.recordGeneration.mockResolvedValue({
      id: "record-1",
      appId: "slides",
      artifactType: "deck",
      artifactId: "deck-1",
      contextMode: "auto",
      contextPackId: null,
      elementProvenance: [],
      createdAt: "2026-07-16T00:00:00.000Z",
    });
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

  it("keeps capability-free guessed reads owner-scoped", async () => {
    const identity = {
      appId: "slides",
      artifactType: "deck",
      artifactId: "guessed-deck",
    };
    mocks.decodeRequest.mockReturnValue({
      protocol: "creative-context-a2a-v1",
      requestId: "87f466ae-32f4-4d0f-9de7-96f955e69f7b",
      operation: "read",
      payload: { identity },
    });

    await action.run({ requestToken: "request-token" });

    expect(mocks.verifyArtifactAccess).not.toHaveBeenCalled();
    expect(mocks.getGeneration).toHaveBeenCalledWith(identity, {
      artifactAccess: undefined,
    });
  });

  it("requires a valid host capability for collaborative reads", async () => {
    const identity = {
      appId: "slides",
      artifactType: "deck",
      artifactId: "shared-deck",
    };
    mocks.decodeRequest.mockReturnValue({
      protocol: "creative-context-a2a-v1",
      requestId: "87f466ae-32f4-4d0f-9de7-96f955e69f7b",
      operation: "read",
      payload: {
        identity,
        artifactAccessCapability: "signed-capability",
      },
    });

    await action.run({ requestToken: "request-token" });

    expect(mocks.verifyArtifactAccess).toHaveBeenCalledWith(
      "signed-capability",
      identity,
      "read",
    );
    expect(mocks.getGeneration).toHaveBeenCalledWith(identity, {
      artifactAccess: { verified: true },
    });
  });

  it("does not write when a guessed-artifact capability is invalid", async () => {
    mocks.decodeRequest.mockReturnValue({
      protocol: "creative-context-a2a-v1",
      requestId: "87f466ae-32f4-4d0f-9de7-96f955e69f7b",
      operation: "record",
      payload: {
        appId: "slides",
        artifactType: "deck",
        artifactId: "guessed-deck",
        contextMode: "auto",
        contextPackId: null,
        reuseLabels: [],
        artifactAccessCapability: "forged-capability",
      },
    });
    mocks.verifyArtifactAccess.mockRejectedValue(
      new Error("Invalid generation artifact access capability"),
    );

    await expect(action.run({ requestToken: "request-token" })).rejects.toThrow(
      /invalid generation artifact access capability/i,
    );
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
});
