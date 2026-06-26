import { describe, expect, it, vi } from "vitest";

import {
  AgentInvocationError,
  buildAgentInvocationPrompt,
  invokeAgent,
  resolveAgentInvocationTarget,
  type AgentInvocationRuntime,
} from "./invoke.js";

function runtime(
  overrides: Partial<AgentInvocationRuntime> = {},
): AgentInvocationRuntime {
  return {
    findAgent: vi.fn(),
    discoverAgents: vi.fn(async () => []),
    callAgent: vi.fn(async () => "ok"),
    ...overrides,
  } as AgentInvocationRuntime;
}

describe("invokeAgent", () => {
  it("calls a direct A2A URL without discovery", async () => {
    const rt = runtime();

    const result = await invokeAgent({
      target: "https://slides.agent-native.test/",
      prompt: "Make a deck",
      async: false,
      runtime: rt,
    });

    expect(rt.findAgent).not.toHaveBeenCalled();
    expect(rt.discoverAgents).not.toHaveBeenCalled();
    expect(rt.callAgent).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.stringContaining("Make a deck"),
      expect.objectContaining({ async: false }),
    );
    expect(String(vi.mocked(rt.callAgent).mock.calls[0]?.[1])).toContain(
      "FULLY-QUALIFIED URL",
    );
    expect(result).toMatchObject({
      target: {
        kind: "url",
        name: "https://slides.agent-native.test",
        url: "https://slides.agent-native.test",
      },
      responseText: "ok",
    });
  });

  it("resolves an app id through the existing discovery client", async () => {
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "mail",
        name: "Mail",
        description: "Send and search email",
        url: "https://mail.agent-native.test",
        color: "#2563eb",
      })),
      callAgent: vi.fn(async () => "sent"),
    });

    const result = await invokeAgent({
      target: "mail",
      prompt: "Draft the update",
      selfAppId: "calendar",
      apiKey: "test-token",
      runtime: rt,
    });

    expect(rt.findAgent).toHaveBeenCalledWith("mail", "calendar");
    expect(rt.callAgent).toHaveBeenCalledWith(
      "https://mail.agent-native.test",
      expect.stringContaining("Draft the update"),
      expect.objectContaining({ apiKey: "test-token" }),
    );
    expect(result.target).toMatchObject({
      kind: "discovered",
      id: "mail",
      name: "Mail",
      url: "https://mail.agent-native.test",
    });
  });

  it("can send the raw prompt when invocation hints are disabled", async () => {
    const rt = runtime({
      callAgent: vi.fn(async () => "plain"),
    });

    await invokeAgent({
      target: "https://analytics.agent-native.test",
      prompt: "Just answer",
      includeInvocationHint: false,
      runtime: rt,
    });

    expect(rt.callAgent).toHaveBeenCalledWith(
      "https://analytics.agent-native.test",
      "Just answer",
      expect.any(Object),
    );
  });

  it("prevents id/name self-calls before discovery", async () => {
    const rt = runtime();

    await expect(
      resolveAgentInvocationTarget("images", {
        selfAppId: "assets",
        runtime: rt,
      }),
    ).rejects.toMatchObject({
      name: "AgentInvocationError",
      code: "self-call",
    });
    expect(rt.findAgent).not.toHaveBeenCalled();
  });

  it("prevents direct URL self-calls including explicit A2A endpoints", async () => {
    await expect(
      resolveAgentInvocationTarget(
        "https://mail.agent-native.test/_agent-native/a2a",
        {
          selfUrl: "https://mail.agent-native.test",
        },
      ),
    ).rejects.toMatchObject({
      name: "AgentInvocationError",
      code: "self-call",
    });
  });

  it("reports available agents when id/name lookup misses", async () => {
    const rt = runtime({
      findAgent: vi.fn(async () => undefined),
      discoverAgents: vi.fn(async () => [
        {
          id: "mail",
          name: "Mail",
          description: "",
          url: "https://mail.agent-native.test",
          color: "#000000",
        },
        {
          id: "calendar",
          name: "Calendar",
          description: "",
          url: "https://calendar.agent-native.test",
          color: "#000000",
        },
      ]),
    });

    await expect(
      resolveAgentInvocationTarget("missing", { runtime: rt }),
    ).rejects.toMatchObject({
      code: "not-found",
      message:
        'Error: Agent "missing" not found. Available agents: Mail, Calendar',
    });
  });

  it("rejects non-http URL targets instead of treating them as names", async () => {
    await expect(
      resolveAgentInvocationTarget("ftp://agent.test"),
    ).rejects.toMatchObject({
      code: "invalid-url",
      message: "Error: Agent URL must use http or https",
    });
  });

  it("formats the cross-app prompt hint with the target host", () => {
    expect(
      buildAgentInvocationPrompt("Create a report", "https://plan.test/"),
    ).toContain("https://plan.test/<path>/<id>");
  });

  it("uses typed invocation errors for missing prompt", async () => {
    await expect(
      invokeAgent({
        target: "https://agent.test",
        prompt: "   ",
        runtime: runtime(),
      }),
    ).rejects.toBeInstanceOf(AgentInvocationError);
  });
});
