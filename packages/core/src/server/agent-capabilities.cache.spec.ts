import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAgentCard = vi.fn();
const getRequestUserEmail = vi.fn<() => string | undefined>(() => undefined);
const signA2AToken = vi.fn(async () => "tok");

vi.mock("../a2a/client.js", () => ({
  A2AClient: class {
    constructor(readonly url: string) {}
    getAgentCard = getAgentCard;
    resolveEndpointUrl = vi.fn(async () => `${this.url}/a2a`);
  },
  signA2AToken,
}));

vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => getRequestUserEmail(),
  getRequestOrgId: () => undefined,
}));

const { loadAllCapabilities, loadCapabilities, _resetCapabilityCacheForTests } =
  await import("./agent-capabilities.js");

const PEER = { id: "slides", url: "http://127.0.0.1:8080/slides" } as never;

describe("peer capability card caching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetCapabilityCacheForTests();
    getAgentCard.mockReset();
    getRequestUserEmail.mockReturnValue(undefined);
    signA2AToken.mockClear();
    getAgentCard.mockResolvedValue({ skills: [{ id: "make-deck" }] });
  });

  afterEach(() => {
    _resetCapabilityCacheForTests();
    vi.useRealTimers();
  });

  it("probes a peer once across repeated calls inside the TTL", async () => {
    await loadCapabilities(PEER);
    await loadCapabilities(PEER);
    await loadAllCapabilities([PEER]);

    expect(getAgentCard).toHaveBeenCalledTimes(1);
  });

  it("collapses a concurrent burst onto a single probe", async () => {
    await Promise.all([
      loadCapabilities(PEER),
      loadCapabilities(PEER),
      loadCapabilities(PEER),
    ]);

    expect(getAgentCard).toHaveBeenCalledTimes(1);
  });

  it("re-probes once the TTL expires", async () => {
    await loadCapabilities(PEER);
    vi.setSystemTime(Date.now() + 31_000);
    await loadCapabilities(PEER);

    expect(getAgentCard).toHaveBeenCalledTimes(2);
  });

  it("retries an unreachable peer sooner than a reachable one", async () => {
    getAgentCard.mockRejectedValue(new Error("ECONNREFUSED"));
    const first = await loadCapabilities(PEER);
    expect(first.skills).toBeNull();
    expect(first.error).toContain("ECONNREFUSED");

    vi.setSystemTime(Date.now() + 6_000);
    getAgentCard.mockResolvedValue({ skills: [{ id: "make-deck" }] });
    const second = await loadCapabilities(PEER);

    expect(getAgentCard).toHaveBeenCalledTimes(2);
    expect(second.skills).toEqual([{ id: "make-deck" }]);
  });

  it("does not share a cached card between callers", async () => {
    getRequestUserEmail.mockReturnValue("a@example.com");
    await loadCapabilities(PEER);
    getRequestUserEmail.mockReturnValue("b@example.com");
    await loadCapabilities(PEER);

    expect(getAgentCard).toHaveBeenCalledTimes(2);
  });

  it("audience-binds authenticated discovery to the receiving app", async () => {
    getRequestUserEmail.mockReturnValue("alice@example.com");

    await loadCapabilities(PEER);

    expect(signA2AToken).toHaveBeenCalledWith(
      "alice@example.com",
      undefined,
      undefined,
      {
        preferGlobalSecret: true,
        audience: "http://127.0.0.1:8080/slides",
      },
    );
    expect(getAgentCard).toHaveBeenCalledWith({
      timeoutMs: expect.any(Number),
      token: "tok",
    });
  });

  it("supports an anonymous card probe without minting a caller token", async () => {
    getRequestUserEmail.mockReturnValue("alice@example.com");

    await loadCapabilities(PEER, { authenticate: false });

    expect(signA2AToken).not.toHaveBeenCalled();
    expect(getAgentCard).toHaveBeenCalledWith({
      timeoutMs: expect.any(Number),
    });
  });

  it("strips an explicit A2A endpoint from the discovery audience", async () => {
    getRequestUserEmail.mockReturnValue("alice@example.com");
    const endpointPeer = {
      ...PEER,
      url: "https://workspace.example/slides/_agent-native/a2a",
    };

    await loadCapabilities(endpointPeer);

    expect(signA2AToken).toHaveBeenCalledWith(
      "alice@example.com",
      undefined,
      undefined,
      {
        preferGlobalSecret: true,
        audience: "https://workspace.example/slides",
      },
    );
  });

  it("does not probe hosted providers that have no inbound A2A card", async () => {
    const managed = {
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
    };

    const result = await loadCapabilities(managed);

    expect(result.skills).toEqual([]);
    expect(result.cardDescription).toContain("native adapter");
    expect(getAgentCard).not.toHaveBeenCalled();
  });
});
