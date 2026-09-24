import { describe, expect, it } from "vitest";

import {
  filterModelGroupsForAgent,
  isClaudeCodeAgentId,
  isClaudeModelId,
  isLunaModel,
  resolvePreferredAgentModel,
} from "./model-selection.js";

describe("composer agent model defaults", () => {
  const groups = [
    {
      engine: "builder",
      models: ["gpt-5-6-luna"],
      configured: true,
    },
    {
      engine: "builder",
      models: ["claude-sonnet-5"],
      configured: true,
    },
  ];

  it("identifies Claude Code and Luna model ids", () => {
    expect(isClaudeCodeAgentId("claude-code")).toBe(true);
    expect(isClaudeCodeAgentId("claude-cli")).toBe(true);
    expect(isClaudeCodeAgentId("codex")).toBe(false);
    expect(isLunaModel("gpt-5.6-luna")).toBe(true);
    expect(isLunaModel("openai/gpt-5.6-sol")).toBe(false);
    expect(isClaudeModelId("claude-sonnet-5")).toBe(true);
    expect(isClaudeModelId("gpt-5.6-sol")).toBe(false);
  });

  it("keeps only Claude models when Claude Code is selected", () => {
    expect(
      filterModelGroupsForAgent("claude-code", [
        { engine: "claude-cli", models: ["claude-sonnet-5", "gpt-5.6-luna"] },
        { engine: "builder", models: ["claude-opus-4-8", "gpt-5.6-sol"] },
      ]),
    ).toEqual([{ engine: "claude-cli", models: ["claude-sonnet-5"] }]);
  });

  it("defaults Claude Code to Sonnet and other agents to Luna", () => {
    expect(resolvePreferredAgentModel("claude-code", groups)).toEqual({
      engine: "builder",
      model: "claude-sonnet-5",
    });
    expect(resolvePreferredAgentModel("codex", groups)).toEqual({
      engine: "builder",
      model: "gpt-5-6-luna",
    });
    expect(resolvePreferredAgentModel(undefined, groups)).toEqual({
      engine: "builder",
      model: "gpt-5-6-luna",
    });
  });
});
