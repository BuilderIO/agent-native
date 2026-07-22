import { describe, expect, it } from "vitest";

import { AGENT_RESOURCE_DOCS_HREF } from "./AgentTabsPage.js";

describe("Agent resource documentation links", () => {
  it("provides a specific docs destination for every resource page", () => {
    expect(AGENT_RESOURCE_DOCS_HREF).toEqual({
      files: "https://agent-native.com/docs/agent-resources#resources-tab",
      instructions: "https://agent-native.com/docs/agent-resources#agents-md",
      agents: "https://agent-native.com/docs/agent-resources#custom-agents",
      memory: "https://agent-native.com/docs/agent-resources#memory",
      skills: "https://agent-native.com/docs/skills-guide",
      learnings: "https://agent-native.com/docs/agent-resources#memory",
      "remote-agents":
        "https://agent-native.com/docs/agent-resources#remote-vs-custom-agents",
    });
  });
});
