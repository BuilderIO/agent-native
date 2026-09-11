import { describe, expect, it } from "vitest";

import {
  getMobileAgentId,
  getMobileModelGroups,
  MOBILE_AGENT_OPTIONS,
  selectMobileAgentSettings,
} from "./model-picker";

describe("mobile model picker", () => {
  it("keeps Remote out of the agent list", () => {
    expect(MOBILE_AGENT_OPTIONS.map((agent) => agent.id)).toEqual([
      "default",
      "codex",
      "claude-code",
      "pi",
      "opencode",
    ]);
  });

  it("resolves local engines to their agent labels", () => {
    expect(getMobileAgentId("codex-cli")).toBe("codex");
    expect(getMobileAgentId("claude-cli")).toBe("claude-code");
    expect(getMobileAgentId("ai-sdk:openai")).toBe("default");
  });

  it("keeps hosted model groups on Default and selects a local model by agent", () => {
    const catalog = {
      groups: [
        { engine: "ai-sdk:openai", label: "OpenAI", models: ["gpt-5"] },
        { engine: "codex-cli", label: "Codex", models: ["gpt-5.6"] },
      ],
    };

    expect(getMobileModelGroups(catalog, "default")).toEqual([
      catalog.groups[0],
    ]);
    expect(
      selectMobileAgentSettings("codex", { effort: "high" }, catalog),
    ).toMatchObject({
      engine: "codex-cli",
      model: "gpt-5.6",
      effort: "high",
    });
  });
});
