import { describe, expect, it, vi } from "vitest";

import type { InvokeAgentOptions } from "../a2a/invoke.js";
import { createAgentNativeClient, type AgentNativeRuntime } from "./index.js";

function runtime(overrides: AgentNativeRuntime = {}): AgentNativeRuntime {
  return {
    discoverAgents: vi.fn(async () => []),
    invokeAgent: vi.fn(async (options: InvokeAgentOptions) => ({
      target: {
        kind: "url",
        name: options.target,
        url: options.target,
      },
      prompt: options.prompt,
      responseText: "ok",
    })),
    ...overrides,
  };
}

describe("agentNative client", () => {
  it("lists agents through the same discovery primitive", async () => {
    const rt = runtime({
      discoverAgents: vi.fn(async () => [
        {
          id: "research",
          name: "Research",
          description: "Finds source-backed answers",
          url: "https://research.agent-native.test",
          color: "#2563eb",
        },
      ]),
    });
    const client = createAgentNativeClient({
      selfAppId: "dispatch",
      runtime: rt,
    });

    const agents = await client.listAgents();

    expect(rt.discoverAgents).toHaveBeenCalledWith("dispatch");
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("research");
  });

  it("infers the current app when listing agents", async () => {
    const rt = runtime({
      discoverAgents: vi.fn(async () => []),
    });
    const client = createAgentNativeClient({
      env: { APP_BASE_PATH: "/dispatch" },
      runtime: rt,
    });

    await client.listAgents();

    expect(rt.discoverAgents).toHaveBeenCalledWith("dispatch");
  });

  it("invokes a target and resolves an API key from the configured env", async () => {
    const rt = runtime();
    const client = createAgentNativeClient({
      apiKeyEnv: "A2A_TOKEN",
      env: { A2A_TOKEN: "test-token" },
      runtime: rt,
    });

    const result = await client.invoke("briefs", "Create the account brief", {
      selfAppId: "dispatch",
      async: true,
    });

    expect(rt.invokeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "briefs",
        prompt: "Create the account brief",
        apiKey: "test-token",
        selfAppId: "dispatch",
        async: true,
      }),
    );
    expect(result.responseText).toBe("ok");
  });

  it("supports object form with agent alias", async () => {
    const rt = runtime();
    const client = createAgentNativeClient({ runtime: rt });

    await client.invoke({
      agent: "gong-evidence",
      prompt: "Find transcript evidence for deal_123",
      includeInvocationHint: false,
    });

    expect(rt.invokeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "gong-evidence",
        prompt: "Find transcript evidence for deal_123",
        includeInvocationHint: false,
      }),
    );
  });

  it("does not forward A2A_SECRET as a raw bearer token", async () => {
    const rt = runtime();
    const client = createAgentNativeClient({
      apiKeyEnv: "A2A_SECRET",
      env: { A2A_SECRET: "shared-signing-secret" },
      runtime: rt,
    });

    await client.invoke("briefs", "Create the account brief", {
      userEmail: "steve@example.com",
    });

    const call = vi.mocked(rt.invokeAgent).mock.calls[0]?.[0];
    expect(call?.apiKey).toBeUndefined();
    expect(call?.orgSecret).toBe("shared-signing-secret");
    expect(call?.userEmail).toBe("steve@example.com");
  });

  it("infers self-call guardrail context from the environment", async () => {
    const rt = runtime();
    const client = createAgentNativeClient({
      env: {
        AGENT_NATIVE_WORKSPACE_APP_ID: "dispatch",
        APP_URL: "https://dispatch.agent-native.test",
      },
      runtime: rt,
    });

    await client.invoke("analytics", "Summarize signups");

    expect(rt.invokeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "analytics",
        selfAppId: "dispatch",
        selfUrl: "https://dispatch.agent-native.test",
      }),
    );
  });

  it("rejects calls without an agent target", async () => {
    const client = createAgentNativeClient({ runtime: runtime() });

    await expect(client.invoke({ prompt: "Hello" })).rejects.toThrow(
      "agentNative.invoke requires an agent target",
    );
  });
});
