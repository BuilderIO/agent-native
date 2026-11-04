import { describe, expect, it, vi } from "vitest";

const discoverAgents = vi.fn();

vi.mock("./agent-discovery.js", () => ({
  discoverAgents: (...args: unknown[]) => discoverAgents(...args),
  discoverAgentsWithDirectoryStatus: vi.fn(),
}));

const { discoverAgentContextAgents, registerAgentContextAgentFilter } =
  await import("./agent-context-agents.js");

const agent = (id: string) => ({
  id,
  name: id,
  description: "",
  url: `https://${id}.example.test`,
  color: "#000000",
});

describe("agent context filters", () => {
  it("filters one app's context by normalized id until unregistered", async () => {
    discoverAgents.mockResolvedValue([agent("mail"), agent("slides")]);
    const unregister = registerAgentContextAgentFilter(" Dispatch ", (agents) =>
      agents.filter((peer) => peer.id !== "mail"),
    );

    expect(
      (await discoverAgentContextAgents("dispatch")).map((a) => a.id),
    ).toEqual(["slides"]);
    expect(
      (await discoverAgentContextAgents("analytics")).map((a) => a.id),
    ).toEqual(["mail", "slides"]);

    unregister();
    expect(
      (await discoverAgentContextAgents("dispatch")).map((a) => a.id),
    ).toEqual(["mail", "slides"]);
  });
});
