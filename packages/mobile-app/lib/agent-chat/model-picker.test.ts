import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_SETTINGS,
  formatMobileModelLabel,
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

  it("shows current provider model versions", () => {
    expect(formatMobileModelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(formatMobileModelLabel("anthropic/claude-opus-5.5")).toBe(
      "Opus 5.5",
    );
    expect(formatMobileModelLabel("claude-haiku-4-5-20251001")).toBe(
      "Haiku 4.5",
    );
    expect(formatMobileModelLabel("openai/gpt-6-luna")).toBe("GPT-6 Luna");
    expect(formatMobileModelLabel("gpt-5-1-codex-mini")).toBe(
      "GPT-5.1 Codex Mini",
    );
    expect(formatMobileModelLabel("gemini-3-8-flash")).toBe("Gemini 3.8 Flash");
    expect(formatMobileModelLabel("gemini-3-1-flash-lite")).toBe(
      "Gemini 3.1 Flash Lite",
    );
  });

  it("defaults new chats to the current hosted model", () => {
    expect(DEFAULT_CHAT_SETTINGS.model).toBe("gpt-6-luna");
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
