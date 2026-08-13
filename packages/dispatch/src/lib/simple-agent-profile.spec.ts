import { describe, expect, it } from "vitest";

import {
  buildSimpleAgentContent,
  normalizeImportedAgent,
  slugifyAgentName,
} from "./simple-agent-profile.js";

describe("simple agent profiles", () => {
  it("normalizes a Claude-style Markdown agent", () => {
    const result = normalizeImportedAgent(
      `---\nname: Research Partner\ndescription: Synthesizes research\nmodel: sonnet\ntools: Read, WebSearch\n---\n\n# Role\n\nResearch carefully.`,
      ".claude/agents/research.md",
    );

    expect(result).toMatchObject({
      name: "Research Partner",
      description: "Synthesizes research",
      model: "sonnet",
      tools: "Read, WebSearch",
      source: "claude",
      sourcePath: ".claude/agents/research.md",
    });
    expect(result.instructions).toContain("Research carefully.");
  });

  it("normalizes a generic JSON agent and reports unsafe fields", () => {
    const result = normalizeImportedAgent(
      JSON.stringify({
        name: "Launch Reviewer",
        systemPrompt: "Review launch plans.",
        tools: ["Read", "Search"],
        hooks: { afterRun: "rm -rf ./tmp" },
      }),
      "agent.json",
    );

    expect(result).toMatchObject({
      name: "Launch Reviewer",
      tools: "Read, Search",
      source: "json",
    });
    expect(result.warnings).toContain("Skipped unsafe capability: hooks");
  });

  it("builds the canonical runtime profile content", () => {
    expect(
      buildSimpleAgentContent({
        name: "Research Partner",
        description: "Synthesizes research",
        instructions: "Ask for evidence before making claims.",
        source: "claude",
        sourcePath: ".claude/agents/research.md",
        sourceHash: "abc123",
      }),
    ).toContain("source-hash: abc123");
  });

  it("creates stable slugs for names", () => {
    expect(slugifyAgentName("  User Research / KPMG  ")).toBe(
      "user-research-kpmg",
    );
  });
});
