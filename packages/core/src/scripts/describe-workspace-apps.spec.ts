import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentCard, AgentSkill } from "../a2a/types.js";
import type { DiscoveredAgent } from "../server/agent-discovery.js";

const getAgentCard = vi.fn();
const discoverAgents = vi.fn();
const findAgent = vi.fn();

vi.mock("../a2a/client.js", () => ({
  A2AClient: class {
    constructor(public baseUrl: string) {}
    getAgentCard(options?: { timeoutMs?: number }) {
      return getAgentCard(this.baseUrl, options);
    }
  },
}));

vi.mock("../server/agent-discovery.js", () => ({
  discoverAgents: (...args: unknown[]) => discoverAgents(...args),
  findAgent: (...args: unknown[]) => findAgent(...args),
}));

const { run, tool } = await import("./describe-workspace-apps.js");

function agent(overrides: Partial<DiscoveredAgent> = {}): DiscoveredAgent {
  return {
    id: "analytics",
    name: "Analytics",
    description: "Product analytics, funnels, and session replay.",
    url: "https://analytics.example.test",
    color: "#000000",
    ...overrides,
  };
}

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "query-events",
    name: "Query events",
    description: "Run a bounded analytics query.",
    readOnly: true,
    ...overrides,
  };
}

function card(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    name: "Analytics",
    description: "Agent-native analytics agent",
    url: "https://analytics.example.test/_agent-native/a2a",
    version: "1.0.0",
    protocolVersion: "0.3",
    capabilities: { streaming: true },
    skills: [skill()],
    ...overrides,
  };
}

describe("describe-workspace-apps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    discoverAgents.mockResolvedValue([]);
    findAgent.mockResolvedValue(undefined);
    getAgentCard.mockResolvedValue(card());
  });

  it("tells the agent not to hand-maintain a workspace app list", () => {
    expect(tool.description).toContain("never hand-maintain");
  });

  it("makes the receiving specialist agent the default cross-app path", () => {
    expect(tool.description).toContain("natural-language call-agent message");
    expect(tool.description).toContain(
      "not a substitute for the specialist agent",
    );
  });

  it("reports each peer's purpose and its live callable actions", async () => {
    discoverAgents.mockResolvedValue([agent()]);

    const output = await run({}, undefined, "coach");

    expect(output).toContain("Analytics (analytics)");
    expect(output).toContain("Product analytics, funnels, and session replay.");
    expect(output).toContain("query-events");
    expect(discoverAgents).toHaveBeenCalledWith("coach");
  });

  // The catalog is only trustworthy if it is read from live deployments, so an
  // unreachable peer must read as unknown rather than as having no capabilities.
  it("distinguishes an unreachable card from a peer that exposes nothing", async () => {
    discoverAgents.mockResolvedValue([
      agent(),
      agent({ id: "mail", name: "Mail", url: "https://mail.example.test" }),
    ]);
    getAgentCard.mockImplementation(async (baseUrl: string) => {
      if (baseUrl.includes("mail")) throw new Error("fetch failed");
      return card({ skills: [] });
    });

    const output = await run({}, undefined, "coach");

    expect(output).toContain("exposes no directly callable actions");
    expect(output).toContain("could not read agent card");
    expect(output).toContain("fetch failed");
  });

  it("bounds each card fetch so one dead peer cannot hang the run", async () => {
    discoverAgents.mockResolvedValue([agent()]);

    await run({}, undefined, "coach");

    expect(getAgentCard).toHaveBeenCalledWith(
      "https://analytics.example.test",
      { timeoutMs: expect.any(Number) },
    );
  });

  it("summarizes long action lists and points at the per-app detail call", async () => {
    discoverAgents.mockResolvedValue([agent()]);
    getAgentCard.mockResolvedValue(
      card({
        skills: Array.from({ length: 20 }, (_, i) =>
          skill({ id: `action-${i}` }),
        ),
      }),
    );

    const output = await run({}, undefined, "coach");

    expect(output).toContain("more");
    expect(output).toContain('app="analytics"');
    expect(output).not.toContain("action-19");
  });

  it("returns one peer's full action list with descriptions when asked", async () => {
    findAgent.mockResolvedValue(agent());
    getAgentCard.mockResolvedValue(
      card({
        skills: [
          skill(),
          skill({
            id: "send-report",
            description: "Email a report.",
            readOnly: false,
          }),
        ],
      }),
    );

    const output = await run({ app: "analytics" }, undefined, "coach");

    expect(output).toContain("Run a bounded analytics query.");
    expect(output).toContain("send-report (mutating)");
    expect(output).toContain('agent="analytics"');
    expect(output).toContain('message="<objective>"');
    expect(findAgent).toHaveBeenCalledWith("analytics", "coach");
  });

  it("prefers the authored manifest purpose over the generic card description", async () => {
    findAgent.mockResolvedValue(agent());

    const output = await run({ app: "analytics" }, undefined, "coach");

    expect(output).toContain("Product analytics, funnels, and session replay.");
    expect(output).not.toContain("Agent-native analytics agent");
  });

  it("falls back to the card description when the manifest has none", async () => {
    findAgent.mockResolvedValue(agent({ description: "" }));

    const output = await run({ app: "analytics" }, undefined, "coach");

    expect(output).toContain("Agent-native analytics agent");
  });

  it("lists the real app ids when the requested app does not exist", async () => {
    discoverAgents.mockResolvedValue([agent()]);

    const output = await run({ app: "nope" }, undefined, "coach");

    expect(output).toContain('no workspace app "nope"');
    expect(output).toContain("analytics");
    expect(getAgentCard).not.toHaveBeenCalled();
  });

  it("says so plainly when the app runs standalone", async () => {
    const output = await run({}, undefined, "coach");

    expect(output).toContain("No other apps are reachable");
    expect(getAgentCard).not.toHaveBeenCalled();
  });
});
