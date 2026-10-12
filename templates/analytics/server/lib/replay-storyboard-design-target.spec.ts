import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCredentialedA2AUrl: vi.fn(),
  getBuiltinAgents: vi.fn(),
  getBuiltinAgentsForSeeding: vi.fn(),
  resolveAgentInvocationTarget: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  assertCredentialedA2AUrl: mocks.assertCredentialedA2AUrl,
  resolveAgentInvocationTarget: mocks.resolveAgentInvocationTarget,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: mocks.getBuiltinAgents,
  getBuiltinAgentsForSeeding: mocks.getBuiltinAgentsForSeeding,
}));

import { resolveReplayStoryboardDesignTarget } from "./replay-storyboard-design-target.js";

const productionUrl = "https://design.agent-native.com";
const betaUrl = "https://beta.design.agent-native.com";

describe("resolveReplayStoryboardDesignTarget", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.assertCredentialedA2AUrl.mockImplementation(() => {});
    mocks.getBuiltinAgentsForSeeding.mockReturnValue([
      { id: "design", url: productionUrl },
    ]);
    mocks.getBuiltinAgents.mockReturnValue([{ id: "design", url: betaUrl }]);
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: betaUrl,
    });
  });

  it("allows the caller-scoped target when it exactly matches a beta override", async () => {
    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "ready",
      targetClass: "beta_design",
      url: betaUrl,
    });
  });

  it("classifies an exact production target", async () => {
    mocks.getBuiltinAgents.mockReturnValue([
      { id: "design", url: productionUrl },
    ]);
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: productionUrl,
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "ready",
      targetClass: "production_design",
      url: productionUrl,
    });
  });

  it("allows an exact configured override without treating it as a mismatch", async () => {
    const configuredUrl = "https://design.workspace.example/app";
    mocks.getBuiltinAgents.mockReturnValue([
      { id: "design", url: configuredUrl },
    ]);
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: configuredUrl,
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "ready",
      targetClass: "configured_design",
      url: configuredUrl,
    });
  });

  it("allows an equivalent endpoint with only a trailing slash difference", async () => {
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: `${betaUrl}/`,
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "ready",
      targetClass: "beta_design",
      url: `${betaUrl}/`,
    });
  });

  it("rejects a personal shadow that resolves to another Design URL", async () => {
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: "https://personal.workspace.example/design",
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "notready",
      failureCode: "target_mismatch",
      targetClass: "configured_design",
    });
  });

  it("rejects unsafe targets and resolver failures without returning their values", async () => {
    mocks.getBuiltinAgents.mockReturnValue([
      { id: "design", url: "http://outside.example/design" },
    ]);
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: "http://outside.example/design",
    });
    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "notready",
      failureCode: "unsafe_target",
      targetClass: "configured_design",
    });

    mocks.resolveAgentInvocationTarget.mockRejectedValue(
      new Error("private target detail"),
    );
    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "notready",
      failureCode: "discovery_unavailable",
      targetClass: "configured_design",
    });
  });

  it("rejects missing catalog targets", async () => {
    mocks.getBuiltinAgents.mockReturnValue([]);

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "notready",
      failureCode: "target_unavailable",
      targetClass: "configured_design",
    });
  });

  it("classifies catalog discovery errors without returning error details", async () => {
    mocks.getBuiltinAgents.mockImplementation(() => {
      throw new Error("private discovery detail");
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "notready",
      failureCode: "discovery_unavailable",
      targetClass: "configured_design",
    });
  });

  it("uses configured classification when the optional production catalog is unavailable", async () => {
    const configuredUrl = "https://design.workspace.example/app";
    mocks.getBuiltinAgents.mockReturnValue([
      { id: "design", url: configuredUrl },
    ]);
    mocks.resolveAgentInvocationTarget.mockResolvedValue({
      id: "design",
      url: configuredUrl,
    });
    mocks.getBuiltinAgentsForSeeding.mockImplementation(() => {
      throw new Error("private production catalog detail");
    });

    await expect(resolveReplayStoryboardDesignTarget()).resolves.toEqual({
      code: "ready",
      targetClass: "configured_design",
      url: configuredUrl,
    });
  });
});
