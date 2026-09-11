import { describe, expect, it } from "vitest";

import type { PeerCapabilities } from "./agent-capabilities.js";
import type { DiscoveredAgent } from "./agent-discovery.js";
import { probePeerAgent, type PeerProbeDeps } from "./agent-peer-probe.js";

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
    createClient: () => ({
      getTask: async () => {
        throw new Error("A2A error (-32001): Task not found");
      },
    }),
    ...overrides,
  };
}

describe("probePeerAgent", () => {
  // Reachability and auth are independent questions. An unreachable peer
  // can't tell us anything about whether our calls would authenticate, so
  // `authorized` must stay ABSENT — not coerced to `false` — or the settings
  // UI reports a peer as "auth rejected" when it never even answered.
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

  it("reports authorized:true when the no-op call comes back as task-not-found", async () => {
    const result = await probePeerAgent(agent, makeDeps());

    expect(result.reachable).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.authError).toBeUndefined();
  });

  // A timeout on the auth-only call proves nothing about auth — the card
  // fetch already proved reachability. Collapsing a timeout into
  // `authorized: false` would tell a correctly-configured caller that its
  // credentials are rejected, when the real cause is an unrelated network hiccup.
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
});
