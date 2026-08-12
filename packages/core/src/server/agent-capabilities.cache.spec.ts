import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAgentCard = vi.fn();
const getRequestUserEmail = vi.fn<() => string | undefined>(() => undefined);
const signA2AToken = vi.fn(async () => "tok");

vi.mock("../a2a/client.js", () => ({
  A2AClient: class {
    constructor(readonly url: string) {}
    getAgentCard = getAgentCard;
  },
  signA2AToken,
}));

vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => getRequestUserEmail(),
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

  // Against a dev gateway each probe cold-starts the peer it touches, so a
  // repeated probe is not just a wasted request — it spawns a dev server.
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

  // A peer that is still booting must not be reported skill-less for the full
  // TTL, so failures expire far sooner than successes.
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

  // Cards are fetched AS the caller, and an anonymous card lists fewer skills
  // than an authenticated one — one caller must never be served another's view.
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
});
