import { describe, expect, it } from "vitest";
import {
  _agentChatPromptSectionsForTests,
  shouldBlockInProductCodeEditingSurface,
} from "./agent-chat-plugin.js";
import {
  buildFrameworkCore,
  buildFrameworkCoreCompact,
  FIRST_SESSION_PERSONALIZATION,
} from "./prompts/index.js";

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

// ---------------------------------------------------------------------------
// Token-budget regression tests
// These assert rough character-count budgets so prompt drift is caught early.
// Update the snapshot when you intentionally change the prompt content.
// ---------------------------------------------------------------------------

describe("prompt token-budget regressions", () => {
  const full = buildFrameworkCore();
  const compact = buildFrameworkCoreCompact();

  it("compact prompt stays under 11 KB", () => {
    expect(compact.length).toBeLessThan(11 * 1024);
  });

  it("full prompt stays under 20 KB", () => {
    expect(full.length).toBeLessThan(20 * 1024);
  });

  it("compact prompt is materially smaller than the full prompt", () => {
    // compact should be at most 75 % of full — if it's bigger, dedup is broken
    expect(compact.length).toBeLessThan(full.length * 0.75);
  });

  it("first-session personalization block stays under 3 KB", () => {
    expect(FIRST_SESSION_PERSONALIZATION.length).toBeLessThan(3 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Prompt-content invariants
// Spot-check that shared rules survived the modularisation.
// ---------------------------------------------------------------------------

describe("prompt content invariants", () => {
  const full = buildFrameworkCore();
  const compact = buildFrameworkCoreCompact();

  it("both variants contain the db-* internal-only rule", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toContain("`db-*` tools are internal only");
      expect(prompt).toContain("db-query");
    }
  });

  it("both variants contain the no-fabrication rule", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toContain("Never fabricate factual claims");
    }
  });

  it("both variants contain the no-false-success rule", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toContain("Never fabricate success from tool errors");
    }
  });

  it("both variants contain the plan/progress discipline rule", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toContain("manage-progress");
      expect(prompt).toContain("in_progress");
      expect(prompt).toContain("Never create single-step plans");
    }
  });

  it("both variants contain response-length guidance", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toMatch(/response length|Response length/i);
    }
  });

  it("injectable examples default: full prompt contains neutral provider names", () => {
    expect(full).toContain("provider-search");
    expect(full).toContain("warehouse-query");
    expect(full).not.toContain("hubspot-deals");
  });

  it("injectable examples custom: custom providers appear, defaults do not", () => {
    const custom = buildFrameworkCore({
      providerActions: ["my-crm", "my-warehouse"],
    });
    expect(custom).toContain("my-crm");
    expect(custom).toContain("my-warehouse");
    expect(custom).not.toContain("hubspot-deals");
  });
});

// ---------------------------------------------------------------------------
// Snapshot test — full assembled prompt at default config
// Run `vitest --update` to regenerate after intentional changes.
// ---------------------------------------------------------------------------

describe("assembled prompt snapshots", () => {
  it("full prompt (default examples) matches snapshot", () => {
    const full = buildFrameworkCore();
    expect(full).toMatchSnapshot();
  });

  it("compact prompt (default examples) matches snapshot", () => {
    const compact = buildFrameworkCoreCompact();
    expect(compact).toMatchSnapshot();
  });
});
