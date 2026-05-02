import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_AGENTS_FOR_SEEDING,
  discoverAgents,
  getBuiltinAgents,
} from "./agent-discovery.js";
import { visibleTemplates } from "../cli/templates-meta.js";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListAccessibleMock = vi.hoisted(() => vi.fn());
const resourceGetMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourceGet: resourceGetMock,
  resourceList: resourceListMock,
  resourceListAccessible: resourceListAccessibleMock,
  SHARED_OWNER: "__shared__",
}));

vi.mock("./auth.js", () => ({
  DEV_MODE_USER_EMAIL: "dev@example.test",
}));

describe("agent discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListMock.mockResolvedValue([]);
    resourceListAccessibleMock.mockResolvedValue([]);
    resourceGetMock.mockResolvedValue(null);
  });

  it("derives built-in connected agents from visible production templates", () => {
    const expected = visibleTemplates()
      .filter((template) => template.prodUrl && template.name !== "dispatch")
      .map((template) => template.name);

    expect(getBuiltinAgents("dispatch").map((agent) => agent.id)).toEqual(
      expected,
    );
  });

  it("includes current public agents and excludes hidden production agents", () => {
    const ids = getBuiltinAgents("dispatch").map((agent) => agent.id);

    expect(ids).toContain("clips");
    expect(ids).toContain("design");
    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).not.toContain("calls");
    expect(ids).not.toContain("meeting-notes");
    expect(ids).not.toContain("scheduling");
    expect(ids).not.toContain("voice");
  });

  it("seeds built-in remote agents with production URLs only", () => {
    for (const agent of BUILTIN_AGENTS_FOR_SEEDING) {
      expect(agent.url).toMatch(/^https:\/\/.+\.agent-native\.com$/);
      expect(agent.url).not.toContain("localhost");
      expect(agent.url).not.toContain("127.0.0.1");
    }
  });

  it("ignores stale hidden first-party remote-agent resources", async () => {
    resourceListAccessibleMock.mockResolvedValue([
      { id: "issues-resource", path: "remote-agents/issues.json" },
      { id: "recruiting-resource", path: "remote-agents/recruiting.json" },
      { id: "custom-resource", path: "remote-agents/custom-qa.json" },
    ]);
    resourceGetMock.mockImplementation(async (id: string) => {
      const contentById: Record<string, string> = {
        "issues-resource": JSON.stringify({
          id: "issues",
          name: "Issues",
          url: "https://issues.agent-native.com",
        }),
        "recruiting-resource": JSON.stringify({
          id: "recruiting",
          name: "Recruiting",
          url: "https://recruiting.agent-native.com",
        }),
        "custom-resource": JSON.stringify({
          id: "custom-qa",
          name: "Custom QA",
          url: "https://custom.example.com",
        }),
      };
      return { id, content: contentById[id] ?? "{}" };
    });

    const ids = (await discoverAgents("dispatch")).map((agent) => agent.id);

    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).toContain("custom-qa");
  });
});
