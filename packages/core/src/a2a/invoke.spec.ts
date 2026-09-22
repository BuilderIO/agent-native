import { beforeEach, describe, expect, it, vi } from "vitest";

import { ANTHROPIC_MANAGED_AGENTS_METADATA_KEY } from "./anthropic-managed-agents.js";
import {
  AgentInvocationError,
  buildAgentInvocationPrompt,
  invokeAgent,
  invokeAgentAction,
  resolveAgentInvocationTarget,
  type AgentInvocationRuntime,
} from "./invoke.js";

const resolveRemoteAgentTokenMock = vi.hoisted(() => vi.fn());
const managedHandlerFactoryMock = vi.hoisted(() => vi.fn());

vi.mock("./remote-agent-auth.js", () => ({
  resolveRemoteAgentToken: resolveRemoteAgentTokenMock,
}));

vi.mock("./anthropic-managed-agents.js", () => ({
  ANTHROPIC_MANAGED_AGENTS_METADATA_KEY:
    "agent-native/anthropic-managed-agents",
  createAnthropicManagedAgentsHandler: managedHandlerFactoryMock,
}));

beforeEach(() => {
  resolveRemoteAgentTokenMock.mockReset();
  managedHandlerFactoryMock.mockReset();
});

function runtime(
  overrides: Partial<AgentInvocationRuntime> = {},
): AgentInvocationRuntime {
  return {
    findAgent: vi.fn(),
    discoverAgents: vi.fn(async () => []),
    callAgent: vi.fn(async () => "ok"),
    callAction: vi.fn(async (_url, action) => ({
      action,
      status: "completed" as const,
      output: "ok",
    })),
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
    expect(String(vi.mocked(rt.callAgent).mock.calls[0]?.[1])).toContain(
      "<a2a-caller-hint>",
    );
    expect(String(vi.mocked(rt.callAgent).mock.calls[0]?.[1])).toContain(
      "</a2a-caller-hint>",
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

  it("resolves discovered hosted auth without exposing it in the result", async () => {
    const auth = { type: "bearer" as const, credentialRef: "mail-token" };
    const callAgent = vi.fn(async () => "sent");
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "mail",
        name: "Mail",
        description: "Send and search email",
        url: "https://mail.agent-native.test",
        color: "#2563eb",
        auth,
      })),
      callAgent,
    });
    resolveRemoteAgentTokenMock.mockResolvedValue("resolved-mail-token");

    const result = await invokeAgent({
      target: "mail",
      prompt: "Draft the update",
      apiKey: "stale-caller-token",
      userEmail: "alice@example.test",
      runtime: rt,
    });

    expect(resolveRemoteAgentTokenMock).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({ userEmail: "alice@example.test" }),
    );
    expect(callAgent).toHaveBeenCalledWith(
      "https://mail.agent-native.test",
      expect.stringContaining("Draft the update"),
      expect.objectContaining({ apiKey: "resolved-mail-token" }),
    );
    expect(callAgent.mock.calls[0]?.[2]).not.toHaveProperty("userEmail");
    expect(callAgent.mock.calls[0]?.[2]).not.toHaveProperty("orgSecret");
    expect(result.target).not.toHaveProperty("auth");
  });

  it("invokes a discovered managed agent through its native handler", async () => {
    const handler = vi.fn(async () => ({
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: "managed result" }],
      },
    }));
    managedHandlerFactoryMock.mockReturnValueOnce(handler);
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "anthropic-research",
        name: "Anthropic Research",
        description: "Research",
        url: "https://api.anthropic.com",
        color: "#2563eb",
        kind: {
          provider: "anthropic-managed-agents" as const,
          agentId: "agt_fixture",
          environmentId: "env_fixture",
          credentialRef: "ANTHROPIC_API_KEY",
        },
      })),
    });
    resolveRemoteAgentTokenMock.mockResolvedValue("resolved-anthropic-key");

    const result = await invokeAgent({
      target: "anthropic-research",
      prompt: "Research this repository",
      userEmail: "alice@example.test",
      contextId: "context_fixture",
      runtime: rt,
    });

    expect(result.responseText).toBe("managed result");
    expect(rt.callAgent).not.toHaveBeenCalled();
    expect(managedHandlerFactoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
        apiBaseUrl: "https://api.anthropic.com",
      }),
    );
    expect(handler).toHaveBeenCalledWith(
      {
        role: "user",
        parts: [{ type: "text", text: "Research this repository" }],
      },
      expect.objectContaining({
        taskId: "context_fixture",
        contextId: "context_fixture",
      }),
    );
  });

  it("preserves managed-agent approval continuation metadata", async () => {
    const handler = vi.fn(async () => ({
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: "Approval required" }],
        metadata: {
          [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
            continuationToken: "opaque-fixture-token",
            pendingToolUseIds: ["tool_fixture"],
          },
        },
      },
      taskState: "input-required" as const,
    }));
    managedHandlerFactoryMock.mockReturnValueOnce(handler);
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "anthropic-research",
        name: "Anthropic Research",
        description: "Research",
        url: "https://api.anthropic.com",
        color: "#2563eb",
        kind: {
          provider: "anthropic-managed-agents" as const,
          agentId: "agt_fixture",
          environmentId: "env_fixture",
          credentialRef: "ANTHROPIC_API_KEY",
        },
      })),
    });

    const result = await invokeAgent({
      target: "anthropic-research",
      prompt: "Research this repository",
      contextId: "context_fixture",
      runtime: rt,
    });

    expect(result).toMatchObject({
      responseText: "Approval required",
      taskState: "input-required",
      continuation: {
        continuationToken: "opaque-fixture-token",
        pendingToolUseIds: ["tool_fixture"],
      },
    });
  });

  it("rejects direct actions for managed-agent targets", async () => {
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "anthropic-research",
        name: "Anthropic Research",
        description: "Research",
        url: "https://api.anthropic.com",
        color: "#2563eb",
        kind: {
          provider: "anthropic-managed-agents" as const,
          agentId: "agt_fixture",
          environmentId: "env_fixture",
          credentialRef: "ANTHROPIC_API_KEY",
        },
      })),
    });

    await expect(
      invokeAgentAction({
        target: "anthropic-research",
        action: "list-items",
        runtime: rt,
      }),
    ).rejects.toMatchObject({
      name: "AgentInvocationError",
      code: "unsupported-action",
    });
    expect(rt.callAction).not.toHaveBeenCalled();
  });

  it("uses resolved hosted auth for direct read-only actions", async () => {
    const auth = { type: "bearer" as const, credentialRef: "analytics-token" };
    const callAction = vi.fn(async () => ({
      action: "gong-calls",
      status: "completed" as const,
      output: "ok",
    }));
    const rt = runtime({
      findAgent: vi.fn(async () => ({
        id: "analytics",
        name: "Analytics",
        description: "Read calls",
        url: "https://analytics.agent-native.test",
        color: "#2563eb",
        auth,
      })),
      callAction,
    });
    resolveRemoteAgentTokenMock.mockResolvedValue("resolved-analytics-token");

    const result = await invokeAgentAction({
      target: "analytics",
      action: "gong-calls",
      input: { company: "Edmunds" },
      apiKey: "stale-caller-token",
      userEmail: "alice@example.test",
      runtime: rt,
    });

    expect(callAction).toHaveBeenCalledWith(
      "https://analytics.agent-native.test",
      "gong-calls",
      { company: "Edmunds" },
      expect.objectContaining({ apiKey: "resolved-analytics-token" }),
    );
    expect(callAction.mock.calls[0]?.[3]).not.toHaveProperty("userEmail");
    expect(result.target).not.toHaveProperty("auth");
  });

  it("invokes one direct read-only action without a delegated prompt", async () => {
    const callAction = vi.fn(async (_url, action) => ({
      action,
      status: "completed" as const,
      output: '{"calls":13}',
    }));
    const rt = runtime({ callAction });

    const result = await invokeAgentAction({
      target: "https://analytics.agent-native.test/",
      action: "gong-calls",
      input: { company: "Edmunds" },
      userEmail: "alice@example.test",
      runtime: rt,
    });

    expect(callAction).toHaveBeenCalledWith(
      "https://analytics.agent-native.test",
      "gong-calls",
      { company: "Edmunds" },
      expect.objectContaining({ userEmail: "alice@example.test" }),
    );
    expect(rt.callAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: "gong-calls",
      result: { status: "completed", output: '{"calls":13}' },
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
