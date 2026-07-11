import { describe, expect, it } from "vitest";

import {
  _agentChatPromptSectionsForTests,
  shouldBlockInProductCodeEditingSurface,
} from "./agent-chat-plugin.js";
import {
  corpusToolNamesTaughtByPrompt,
  generateCorpusToolsPrompt,
} from "./agent-chat/framework-prompts.js";
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

  it("database-tool-free variants point agents at typed actions", () => {
    const typedOnlyFull = buildFrameworkCore(undefined, {
      databaseTools: false,
    });
    const typedOnlyCompact = buildFrameworkCoreCompact(undefined, {
      databaseTools: false,
    });

    for (const prompt of [typedOnlyFull, typedOnlyCompact]) {
      expect(prompt).toContain("raw database tools are not available");
      expect(prompt).toContain("typed app actions");
      expect(prompt).not.toContain("db-schema");
      expect(prompt).not.toContain("db-query");
      expect(prompt).not.toContain("db-exec");
    }
  });

  it("read-only database-tool variants keep inspection but route writes to actions", () => {
    const readOnlyFull = buildFrameworkCore(undefined, {
      databaseTools: "read",
    });
    const readOnlyCompact = buildFrameworkCoreCompact(undefined, {
      databaseTools: "read",
    });

    for (const prompt of [readOnlyFull, readOnlyCompact]) {
      expect(prompt).toContain("db-query");
      expect(prompt).toContain("typed");
      expect(prompt).toContain("actions");
      expect(prompt).toContain("Raw SQL write tools are not available");
    }
  });

  it("assembled prompts can remove extension tool guidance", () => {
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts(
      undefined,
      {
        extensionTools: false,
      },
    );
    const corePrompt = buildFrameworkCore(undefined, {
      extensionTools: false,
    });

    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain("Extensions Disabled");
    expect(prompts.PROD_FRAMEWORK_PROMPT_COMPACT).toContain(
      "Extensions Disabled",
    );
    expect(corePrompt).toContain("registered actions and connected MCP tools");
    expect(corePrompt).not.toContain(
      "registered actions, extensions, and connected MCP tools",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).not.toContain(
      "call `create-extension` immediately",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).not.toContain(
      "use `create-extension` or `update-extension` instead",
    );
  });

  it("keeps app-native dashboard and analysis actions ahead of generic extensions", () => {
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts();

    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain(
      "If the app exposes native actions or instructions for dashboards",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT_COMPACT).toContain(
      "Use app-native artifact actions first",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).not.toContain(
      '"a dashboard summarizing my pipeline"',
    );
  });

  it("routes extension requests that need native placement to code customization", () => {
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts();

    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain(
      "UI inside or beside a native component where no named slot exists",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain(
      "show local time beside every native Calendar attendee row",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain(
      'do not end with "extensions cannot do that."',
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT_COMPACT).toContain(
      "needs placement where no slot exists",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT_COMPACT).toContain(
      "continue the code-change handoff",
    );
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

  it("both variants contain native chat widget guidance", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toMatch(/Native (chat )?widgets/);
      expect(prompt).toContain("chart");
      expect(prompt).toContain("markdown table");
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

describe("available action prompt rendering", () => {
  const actions = {
    common: {
      tool: {
        description: "Common action.",
        parameters: { type: "object", properties: {} },
      },
      run: async () => ({}),
    },
    rare: {
      tool: {
        description: "Rare action.",
        parameters: { type: "object", properties: {} },
      },
      run: async () => ({}),
    },
  } as never;

  it("defaults unconfigured apps to their own template actions", () => {
    expect(
      _agentChatPromptSectionsForTests.resolveInitialToolNames(actions),
    ).toEqual(["common", "rare"]);
    expect(
      _agentChatPromptSectionsForTests.resolveInitialToolNames(actions, [
        "common",
      ]),
    ).toEqual(["common"]);
  });

  it("summarizes only starter actions and points to tool-search for the rest", () => {
    const prompt = _agentChatPromptSectionsForTests.generateActionsPrompt(
      actions,
      "tool",
      ["common"],
    );

    expect(prompt).toContain("`common`");
    expect(prompt).not.toContain("`rare`");
    expect(prompt).toContain("1 less-common app action is available on demand");
    expect(prompt).toContain("`tool-search`");
  });

  it("labels actions that render native chat widgets", () => {
    const prompt = _agentChatPromptSectionsForTests.generateActionsPrompt(
      {
        "response-insights": {
          tool: {
            description: "Analyze responses and render insights.",
            parameters: { type: "object", properties: {} },
          },
          run: async () => ({}),
          chatUI: { renderer: "core.data-insights" },
        },
      } as never,
      "tool",
    );

    expect(prompt).toContain("Native chat widget: `core.data-insights`");
  });
});

describe("render-data-widget framework action", () => {
  it("validates and echoes native chart widgets for chat rendering", async () => {
    const entry =
      _agentChatPromptSectionsForTests.createDataWidgetActionEntries()[
        "render-data-widget"
      ]!;

    await expect(
      entry.run({
        widget: "data-chart",
        chartSeries: {
          type: "bar",
          title: "Responses by day",
          xKey: "day",
          series: [{ key: "responses", label: "Responses" }],
          data: [{ day: "Mon", responses: 8 }],
        },
      }),
    ).resolves.toMatchObject({
      widget: "data-chart",
      chartSeries: { title: "Responses by day" },
    });

    expect(entry.chatUI?.renderer).toBe("core.data-widget");
  });

  it("rejects malformed widget payloads", async () => {
    const entry =
      _agentChatPromptSectionsForTests.createDataWidgetActionEntries()[
        "render-data-widget"
      ]!;

    await expect(
      entry.run({
        widget: "data-chart",
        chartSeries: { type: "bar" },
      }),
    ).rejects.toThrow();
  });
});

describe("corpusToolNamesTaughtByPrompt / generateCorpusToolsPrompt consistency", () => {
  const noopTool = {
    tool: {
      description: "noop",
      parameters: { type: "object" as const, properties: {} },
    },
    run: async () => "ok",
  } as never;

  it("returns no names and no prompt text for a registry with none of the corpus tools", () => {
    const registry = { "some-template-action": noopTool } as never;

    expect(corpusToolNamesTaughtByPrompt(registry)).toEqual([]);
    expect(generateCorpusToolsPrompt(registry)).toBe("");
  });

  it("returns exactly the corpus tool names present, matching the prompt's authoritative availability line", () => {
    const registry = {
      "some-template-action": noopTool,
      "provider-api-catalog": noopTool,
      "query-staged-dataset": noopTool,
    } as never;

    const names = corpusToolNamesTaughtByPrompt(registry);
    expect(names).toEqual(["provider-api-catalog", "query-staged-dataset"]);

    const prompt = generateCorpusToolsPrompt(registry);
    // "Available corpus-capable tools: ..." is the authoritative,
    // registry-conditional line — this is the invariant
    // agent-chat-plugin.ts's `effectiveInitialToolNames` wiring depends on
    // to avoid teaching a tool as available when it isn't in the first
    // request's active tool set. (The fixed prose below it separately
    // explains `provider-corpus-job` / run-code usage unconditionally
    // whenever the block renders at all — that static explanatory text is
    // pre-existing and out of scope here.)
    const availabilityLine = prompt
      .split("\n")
      .find((line) => line.startsWith("Available corpus-capable tools:"));
    expect(availabilityLine).toBe(
      "Available corpus-capable tools: `provider-api-catalog`, `query-staged-dataset`.",
    );
    for (const name of names) {
      expect(availabilityLine).toContain(`\`${name}\``);
    }
    expect(availabilityLine).not.toContain("`provider-api-request`");
    expect(availabilityLine).not.toContain("`provider-corpus-job`");
    expect(availabilityLine).not.toContain("`run-code`");
  });

  it("includes every corpus tool name when the full set is registered", () => {
    const registry = {
      "provider-api-catalog": noopTool,
      "provider-api-docs": noopTool,
      "provider-api-request": noopTool,
      "provider-corpus-job": noopTool,
      "query-staged-dataset": noopTool,
      "run-code": noopTool,
    } as never;

    expect(corpusToolNamesTaughtByPrompt(registry)).toEqual([
      "provider-api-catalog",
      "provider-api-docs",
      "provider-api-request",
      "provider-corpus-job",
      "query-staged-dataset",
      "run-code",
    ]);
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
