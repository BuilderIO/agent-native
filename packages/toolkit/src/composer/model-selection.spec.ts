import { describe, expect, it } from "vitest";

import {
  curateModelPickerRows,
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

describe("curateModelPickerRows", () => {
  const row = (
    identity: string,
    provider?: string,
    recommendedRank?: number,
  ) => ({
    identity,
    provider,
    recommendedRank,
  });

  it("shows the catalog's root list in its order when the engines offer it", () => {
    const rows = [
      { ...row("pro", "google", 3) },
      { ...row("luna", "openai", 7), rootRank: 3 },
      { ...row("haiku", "anthropic", 6) },
      { ...row("sol", "openai", 2), rootRank: 2 },
      { ...row("sonnet", "anthropic", 4), rootRank: 1 },
      { ...row("opus", "anthropic", 1), rootRank: 0 },
      { ...row("opus", "anthropic", 1), rootRank: 0 },
    ];
    const { main, more } = curateModelPickerRows(rows);
    expect(main.map((r) => r.identity)).toEqual([
      "opus",
      "sonnet",
      "sol",
      "luna",
    ]);
    // The second engine's Opus is the same model, so it moves to More.
    expect(more.map((r) => r.identity)).toEqual(["pro", "haiku", "opus"]);
  });

  it("skips root models the engines don't offer", () => {
    const rows = [
      { ...row("sonnet", "anthropic", 4), rootRank: 1 },
      { ...row("haiku", "anthropic", 6) },
      { ...row("legacy", "anthropic") },
      { ...row("fable") },
      { ...row("opus-4-8", "anthropic") },
    ];
    const { main, more } = curateModelPickerRows(rows);
    expect(main.map((r) => r.identity)).toEqual(["sonnet"]);
    expect(more).toHaveLength(4);
  });

  it("picks one recommended model per provider before a second from any", () => {
    const rows = [
      row("haiku", "anthropic", 6),
      row("sonnet", "anthropic", 4),
      row("opus", "anthropic", 1),
      row("sol", "openai", 2),
      row("luna", "openai", 7),
      row("pro", "google", 3),
      row("legacy", "anthropic"),
    ];
    const { main, more } = curateModelPickerRows(rows);
    expect(main.map((r) => r.identity)).toEqual([
      "opus",
      "sol",
      "pro",
      "sonnet",
    ]);
    expect(more.map((r) => r.identity)).toEqual(["haiku", "luna", "legacy"]);
  });

  it("ranks within the provider for a single key", () => {
    const rows = [
      row("haiku", "anthropic", 6),
      row("sonnet", "anthropic", 4),
      row("opus", "anthropic", 1),
      row("fable"),
      row("legacy", "anthropic"),
    ];
    const { main, more } = curateModelPickerRows(rows);
    expect(main.map((r) => r.identity)).toEqual(["opus", "sonnet", "haiku"]);
    expect(more.map((r) => r.identity)).toEqual(["fable", "legacy"]);
  });

  it("keeps a small engine whole and never drops or adds a row", () => {
    const small = [row("a"), row("b"), row("c", "openai", 2), row("d")];
    expect(curateModelPickerRows(small)).toEqual({ main: small, more: [] });

    const unranked = ["a", "b", "c", "d", "e", "f"].map((id) => row(id));
    const { main, more } = curateModelPickerRows(unranked);
    expect(main.map((r) => r.identity)).toEqual(["a", "b", "c", "d"]);
    expect([...main, ...more]).toHaveLength(unranked.length);
  });

  it("shows one model offered by two engines once in the short list", () => {
    const rows = [
      row("opus", "anthropic", 1),
      row("sol", "openai", 2),
      row("opus", "anthropic", 1),
      row("pro", "google", 3),
      row("sonnet", "anthropic", 4),
    ];
    const { main, more } = curateModelPickerRows(rows);
    expect(main).toEqual([rows[0], rows[1], rows[3], rows[4]]);
    expect(more).toEqual([rows[2]]);
  });
});
