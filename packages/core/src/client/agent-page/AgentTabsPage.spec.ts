import { describe, expect, it } from "vitest";

import {
  AGENT_ACCESS_DOCS_HREF,
  AGENT_RESOURCE_DOCS_HREF,
} from "./AgentTabsPage.js";

describe("Agent access documentation links", () => {
  it("points MCP and A2A access fields to their protocol docs", () => {
    expect(AGENT_ACCESS_DOCS_HREF).toEqual({
      mcp: "https://www.agent-native.com/docs/mcp-protocol",
      a2a: "https://www.agent-native.com/docs/a2a-protocol",
    });
  });
});

describe("Agent resource documentation links", () => {
  it("provides a specific docs destination for every resource page", () => {
    expect(AGENT_RESOURCE_DOCS_HREF).toEqual({
      files: "https://www.agent-native.com/docs/agent-resources#resources-tab",
      instructions:
        "https://www.agent-native.com/docs/agent-resources#agents-md",
      agents: "https://www.agent-native.com/docs/agent-resources#custom-agents",
      memory: "https://www.agent-native.com/docs/agent-resources#memory",
      skills: "https://www.agent-native.com/docs/skills-guide",
      learnings: "https://www.agent-native.com/docs/agent-resources#memory",
      "remote-agents":
        "https://www.agent-native.com/docs/agent-resources#remote-vs-custom-agents",
    });
  });
});
