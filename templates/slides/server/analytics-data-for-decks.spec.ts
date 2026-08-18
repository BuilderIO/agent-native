import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentsGuide = readFileSync(
  new URL("../AGENTS.md", import.meta.url),
  "utf8",
);
const skill = readFileSync(
  new URL(
    "../.agents/skills/analytics-data-for-decks/SKILL.md",
    import.meta.url,
  ),
  "utf8",
);
const agentChatPlugin = readFileSync(
  new URL("./plugins/agent-chat.ts", import.meta.url),
  "utf8",
);
const netlifyConfig = readFileSync(
  new URL("../netlify.toml", import.meta.url),
  "utf8",
);

describe("Slides analytics delegation contract", () => {
  it("routes analytics-backed deck requests through Analytics", () => {
    expect(agentsGuide).toContain("analytics-data-for-decks");
    expect(agentsGuide).toContain("delegate via Analytics");
    expect(skill).toContain('agent: "analytics"');
    expect(skill).toContain("call-agent");
    expect(skill).toContain("natural-language `message`");
    expect(skill).toContain("Analytics decides which sources");
    expect(skill).toContain("not a fallback");
    expect(skill).not.toContain("use `gong-calls`");
  });

  it("prevents Slides from selecting providers or writing SQL", () => {
    expect(skill).toContain("must not write SQL");
    expect(skill).toContain("Analytics decides which sources");
    expect(skill).toContain("data dictionary interpretation");
    expect(skill).not.toMatch(/Slides.*(?:SELECT|FROM)\s+\w+/i);
  });

  it("keeps the hosted A2A path wired to Analytics and a fresh Core build", () => {
    expect(agentChatPlugin).toContain("a2aAgentDelegation: true");
    expect(agentChatPlugin).toContain('frameworkTools: { database: "off" }');
    expect(netlifyConfig).toContain("pnpm --filter @agent-native/core build");
  });
});
