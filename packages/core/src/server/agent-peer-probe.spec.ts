import { describe, expect, it } from "vitest";

import { RemoteAgentCredentialRejectedError } from "../a2a/remote-agent-auth.js";
import type { PeerCapabilities } from "./agent-capabilities.js";
import type { DiscoveredAgent } from "./agent-discovery.js";
import {
  probeAllPeerAgents,
  probePeerAgent,
  type PeerProbeDeps,
} from "./agent-peer-probe.js";

const agent: DiscoveredAgent = {
  id: "peer",
  name: "Peer",
  description: "",
  url: "https://peer.example.com",
  color: "#000",
};

function makeDeps(overrides: Partial<PeerProbeDeps> = {}): PeerProbeDeps {
  return {
    loadCapabilities: async () =>
      ({
        agent,
        skills: [],
        card: {
          name: "Peer",
          description: "A peer app",
          url: "https://peer.example.com",
          version: "1",
          protocolVersion: "0.3",
          capabilities: {},
          skills: [],
        },
      }) as PeerCapabilities,
    resolveCallerAuth: async () => ({ metadata: {} }),
    resolveRemoteAgentToken: async () => undefined,
    fetch: async () =>
      new Response(JSON.stringify({ id: "agt_fixture" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    createClient: () => ({
      getTask: async () => {
        throw new Error("A2A error (-32001): Task not found");
      },
    }),
    ...overrides,
  };
}

describe("probePeerAgent", () => {
  it("leaves authorized undefined when the peer is unreachable", async () => {
    const deps = makeDeps({
      loadCapabilities: async () => ({
        agent,
        skills: null,
        error: "Failed to fetch agent card (503)",
      }),
      createClient: () => ({
        getTask: async () => {
          throw new Error("should never be called for an unreachable peer");
        },
      }),
    });

    const result = await probePeerAgent(agent, deps);

    expect(result.reachable).toBe(false);
    expect(result.error).toBe("Failed to fetch agent card (503)");
    expect(result.authorized).toBeUndefined();
    expect("authorized" in result).toBe(false);
  });

  it("reports reachable:true, authorized:false on a 401 from the no-op call", async () => {
    const deps = makeDeps({
      createClient: () => ({
        getTask: async () => {
          throw new Error(
            'A2A request failed (401): {"jsonrpc":"2.0","error":{"code":-32001,"message":"Invalid or expired A2A token"}}',
          );
        },
      }),
    });

    const result = await probePeerAgent(agent, deps);

    expect(result.reachable).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.authError).toBe("401");
  });

  it("maps typed credential rejection from the no-op call to auth-rejected", async () => {
    const deps = makeDeps({
      createClient: () => ({
        getTask: async () => {
          throw new RemoteAgentCredentialRejectedError({ status: 403 });
        },
      }),
    });

    const result = await probePeerAgent(agent, deps);

    expect(result).toMatchObject({
      reachable: true,
      authorized: false,
      cardStatus: "auth-rejected",
      authError: "403",
    });
  });

  it("reports authorized:true when the no-op call comes back as task-not-found", async () => {
    const result = await probePeerAgent(agent, makeDeps());

    expect(result.reachable).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.authError).toBeUndefined();
  });

  it("never reports a timeout on the no-op call as authorized:false", async () => {
    const deps = makeDeps({
      createClient: () => ({
        getTask: async () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          throw err;
        },
      }),
    });

    const result = await probePeerAgent(agent, deps);

    expect(result.reachable).toBe(true);
    expect(result.authorized).toBeUndefined();
    expect("authorized" in result).toBe(false);
    expect(result.authError).toBe("This operation was aborted");
  });

  it("probes native provider agents by ID without creating a session", async () => {
    const managed = {
      ...agent,
      id: "anthropic-research",
      kind: {
        provider: "anthropic-managed-agents" as const,
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
      },
    };
    const deps = makeDeps({
      loadCapabilities: async () => {
        throw new Error("native providers do not have A2A cards");
      },
      resolveRemoteAgentToken: async (auth) => {
        expect(auth).toEqual({
          type: "bearer",
          credentialRef: "ANTHROPIC_API_KEY",
        });
        return "fixture-key";
      },
      fetch: async (url, init) => {
        expect(url).toBe("https://peer.example.com/v1/agents/agt_fixture");
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-key");
        return new Response(
          JSON.stringify({
            id: "agt_fixture",
            name: "Managed fixture",
            description: "A managed fixture",
          }),
          { status: 200 },
        );
      },
    });

    await expect(probeAllPeerAgents([managed], deps)).resolves.toMatchObject([
      {
        id: "anthropic-research",
        reachable: true,
        authorized: true,
        cardStatus: "reachable",
        name: "Managed fixture",
      },
    ]);
  });

  it("reports a managed agent key rejection", async () => {
    const managed = {
      ...agent,
      kind: {
        provider: "anthropic-managed-agents" as const,
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
      },
    };
    const deps = makeDeps({
      resolveRemoteAgentToken: async () => "wrong-key",
      fetch: async () => new Response("no", { status: 401 }),
    });

    await expect(probePeerAgent(managed, deps)).resolves.toMatchObject({
      reachable: true,
      authorized: false,
      cardStatus: "auth-rejected",
      authError: "401",
    });
  });

  it("surfaces a managed agent ID that the provider cannot find", async () => {
    const managed = {
      ...agent,
      kind: {
        provider: "anthropic-managed-agents" as const,
        agentId: "missing_agent",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
      },
    };
    const deps = makeDeps({
      resolveRemoteAgentToken: async () => "fixture-key",
      fetch: async () => new Response("missing", { status: 404 }),
    });

    await expect(probePeerAgent(managed, deps)).resolves.toMatchObject({
      reachable: false,
      error:
        'Anthropic Managed Agent "missing_agent" was not found (HTTP 404).',
    });
  });
});
