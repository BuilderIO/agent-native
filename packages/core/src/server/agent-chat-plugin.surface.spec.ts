import { describe, expect, it } from "vitest";
import {
  _agentChatPromptSectionsForTests,
  shouldBlockInProductCodeEditingSurface,
} from "./agent-chat-plugin.js";

describe("shouldBlockInProductCodeEditingSurface", () => {
  it("blocks app-rendered chat surfaces, including legacy iframe labels", () => {
    expect(
      shouldBlockInProductCodeEditingSurface({
        surface: "app",
        userAgent: "Mozilla/5.0",
        host: "preview.builder.io",
      }),
    ).toBe(true);
    expect(
      shouldBlockInProductCodeEditingSurface({
        surface: "frame",
        userAgent: "Mozilla/5.0",
        host: "preview.builder.io",
      }),
    ).toBe(true);
  });

  it("allows explicit dev-frame and desktop host surfaces", () => {
    expect(
      shouldBlockInProductCodeEditingSurface({
        surface: "dev-frame",
        userAgent: "Mozilla/5.0",
        host: "localhost:3334",
      }),
    ).toBe(false);
    expect(
      shouldBlockInProductCodeEditingSurface({
        surface: "desktop",
        userAgent: "AgentNativeDesktop/0.1.7",
        host: "localhost:8080",
      }),
    ).toBe(false);
  });

  it("treats missing browser headers as app-rendered but preserves non-browser callers", () => {
    expect(
      shouldBlockInProductCodeEditingSurface({
        userAgent: "Mozilla/5.0 Chrome/124",
        host: "preview.builder.io",
      }),
    ).toBe(true);
    expect(
      shouldBlockInProductCodeEditingSurface({
        userAgent: "agent-native-cli",
        host: "agent.example.com",
      }),
    ).toBe(false);
  });
});

describe("agent teams prompt guidance", () => {
  const { frameworkCore, frameworkCoreCompact, frameworkContextSections } =
    _agentChatPromptSectionsForTests;

  it("treats equivalent background batch phrasing as delegation intent", () => {
    for (const prompt of [frameworkCore, frameworkCoreCompact]) {
      expect(prompt).toContain('"background agent"');
      expect(prompt).toContain('"sub-agent"');
      expect(prompt).toContain('"parallel"');
      expect(prompt).toContain('"batch"');
      expect(prompt).toContain('"kick off"');
      expect(prompt).toContain('"run the rest"');
      expect(prompt).toContain('"queued items"');
    }
  });

  it("makes agent-teams spawn distinct from completed delegated work", () => {
    const agentTeams = frameworkContextSections["agent-teams"];

    expect(agentTeams).toContain("**Spawn is not completion.**");
    expect(agentTeams).toContain(
      "A successful `spawn` call means the sub-agent started and is running.",
    );
    expect(agentTeams).toContain(
      'Never say the delegated task "completed", "ran successfully", or "finished"',
    );
  });
});
