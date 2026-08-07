import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { FrameworkToolGroup } from "../framework-tools.js";
import {
  _agentChatPromptSectionsForTests,
  buildLeanRunPolicyPrompt,
  resolveInteractiveAgentRunOptions,
  shouldBlockInProductCodeEditingSurface,
} from "./agent-chat-plugin.js";
import {
  corpusToolNamesTaughtByPrompt,
  generateCorpusToolsPrompt,
} from "./agent-chat/framework-prompts.js";
import { resolveA2AAgentDelegationEnabled } from "./agent-chat/plugin-options.js";
import {
  buildFrameworkCore,
  buildFrameworkCoreCompact,
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

describe("lean production run policy", () => {
  it("uses the same combined policy for the emitted prompt and Context X-Ray manifest", () => {
    const restriction = "<app-rendered-chat-no-direct-code-edits />";
    const codeExecution =
      "<code-execution-mode>Sandboxed</code-execution-mode>";

    expect(buildLeanRunPolicyPrompt(restriction, codeExecution)).toBe(
      restriction + codeExecution,
    );
  });
});

describe("interactive agent run options", () => {
  it("forwards an app's durable no-progress watchdog to every interactive handler", () => {
    expect(
      resolveInteractiveAgentRunOptions({
        runSoftTimeoutMs: 13 * 60_000,
        runNoProgressTimeoutMs: 3 * 60_000,
        durableBackgroundRuns: true,
      }),
    ).toEqual({
      runSoftTimeoutMs: 13 * 60_000,
      runNoProgressTimeoutMs: 3 * 60_000,
      durableBackgroundRuns: true,
    });
  });
});

// ---------------------------------------------------------------------------
// `resolveInteractiveAgentRunOptions` echoing its own inputs (above) proves
// nothing about whether the value it returns actually reaches the run
// manager — that wiring lives inside `createAgentChatPlugin`'s and
// `createProductionAgentHandler`'s multi-thousand-line request-handler
// closures, which have no cheap unit seam (same rationale as the
// "prompt-caching wiring guards" in runtime-context.spec.ts). These source
// guards close that gap: they fail if a future call site forgets to spread
// `resolveInteractiveAgentRunOptions(options)`, or if `startRun` stops
// receiving `runNoProgressTimeoutMs` as its `noProgressTimeoutMs` option —
// exactly the class of bug the run-manager's own no-progress-backstop tests
// (run-manager.spec.ts) cannot see, since they drive `startRun` directly.
describe("interactive agent run options — wiring guards", () => {
  it("spreads resolveInteractiveAgentRunOptions(options) into every createProductionAgentHandler call site", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });

    const handlerCallSites = source.match(/createProductionAgentHandler\(\{/g);
    const spreadSites = source.match(
      /\.\.\.resolveInteractiveAgentRunOptions\(options\),\s*\n\s*finalResponseGuard: options\?\.finalResponseGuard,/g,
    );

    // Three interactive handlers are created today (prod, anonymous
    // read-only, dev). If this count changes, a new call site was added or
    // removed — update this guard alongside it, and confirm the new/changed
    // site still spreads the run options immediately before
    // `finalResponseGuard`.
    expect(handlerCallSites).toHaveLength(3);
    expect(spreadSites).toHaveLength(handlerCallSites?.length ?? 0);
  });

  it("threads runNoProgressTimeoutMs into startRun's noProgressTimeoutMs option", () => {
    const source = readFileSync("src/agent/production-agent.ts", {
      encoding: "utf-8",
    });

    // There is exactly one `startRun(...)` call in production-agent.ts — the
    // interactive/production run start. Confirm it stays singular so the
    // adjacency assertion below can't silently start matching a different,
    // unrelated call site.
    expect(source.match(/\n {4}const startedRun = startRun\(\n/g)).toHaveLength(
      1,
    );

    // `noProgressTimeoutMs` must be set from `options.runNoProgressTimeoutMs`
    // (not hardcoded, not dropped) and live in the same options object as
    // `turnId`/`dispatchMode`, which are unambiguously the literal passed as
    // startRun's final argument.
    expect(source).toMatch(
      /noProgressTimeoutMs: options\.runNoProgressTimeoutMs,\s*(?:\/\/[^\n]*\n\s*)*turnId: effectiveTurnId,/,
    );
  });

  it("keeps background workers alive through run-manager finalization", () => {
    const source = readFileSync("src/agent/production-agent.ts", {
      encoding: "utf-8",
    });

    expect(source).toMatch(
      /if \(isBackgroundWorker\) \{\s*await startedRun\.finalized;\s*return \{ ok: true, runId \};\s*\}/,
    );
    expect(source).not.toContain("backgroundRunDone");
  });
});

describe("background automation action surface — wiring guards", () => {
  it("uses one shared background action builder with unattended email tools", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });

    expect(source).toContain(
      "backgroundCoreEmailTools = createCoreEmailActionEntries({",
    );
    expect(source).toContain("...backgroundCoreEmailTools,");
    expect(
      source.match(/getActions: getBackgroundActionEntries/g),
    ).toHaveLength(2);
  });
});

// `frameworkTools` gating happens inside `createAgentChatPlugin`'s multi-
// thousand-line closure, which has no cheap unit seam (same rationale as the
// run-options guards above). `framework-tools.spec.ts` proves the filter and
// resolver in isolation; these source guards prove they are actually wired at
// the two points that matter, and that the UI's routes stay out of it.
describe("framework tool gating — wiring guards", () => {
  const source = readFileSync("src/server/agent-chat-plugin.ts", {
    encoding: "utf-8",
  });

  it("resolves the framework tool surface once and gates both agent registries", () => {
    expect(source).toContain(
      "const frameworkTools = resolveFrameworkTools(options);",
    );

    // Both agent-facing registries must be filtered. Missing either one leaves
    // a disabled kit reachable from that surface.
    for (const set of ["templateScriptsAll", "discoveredActionsAll"]) {
      expect(source, set).toMatch(
        new RegExp(
          `filterFrameworkToolGroups\\(\\s*filterAgentTools\\(${set}\\),\\s*disabledFrameworkGroups,\\s*\\)`,
        ),
      );
    }
  });

  it("leaves httpActions ungated so the UI keeps its routes", () => {
    // Disabling `sharing` must not 404 a share dialog that is still on screen:
    // the UI reaches these through client hooks, not the agent tool surface.
    const start = source.indexOf(
      "const httpActions: Record<string, ActionEntry> = {",
    );
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 1200);

    expect(block).toContain("...templateScriptsAll,");
    expect(block).toContain("...discoveredActionsAll,");
    expect(block).not.toContain("filterFrameworkToolGroups");
    expect(block).toContain("await mergeCoreSharingActions(httpActions);");
  });

  it("reads the deprecated flags only through the resolver", () => {
    // A second read of `options.databaseTools` / `options.extensionTools` would
    // bypass the conflict check and split the app's tool surface in two.
    expect(source).not.toContain("options?.databaseTools");
    expect(source).not.toContain("options?.extensionTools");
  });
});

describe("delegated agent run policy — wiring guards", () => {
  it("forwards non-default delegated budgets to MCP ask_app", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });
    const mcpCallStart = source.indexOf("await runMCPAgentLoop(");
    expect(mcpCallStart).toBeGreaterThan(-1);

    const mcpCall = source.slice(mcpCallStart, mcpCallStart + 3200);
    expect(mcpCall).toMatch(
      /\{\s*delegatedRunPolicy: options\?\.delegatedRunPolicy,\s*finalResponseGuard: options\?\.finalResponseGuard,\s*runSoftTimeoutMs: options\?\.runSoftTimeoutMs,\s*\}/,
    );
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

  it("does not include first-session personalization onboarding", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).not.toContain("First-Session Personalization");
      expect(prompt).not.toContain("application_state.personalization");
    }
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

  it("stops naming a group's tools once that group is switched off", () => {
    // The invariant this whole gate exists for: prompt text and tool schemas
    // must agree. A prompt that names an absent tool makes the model call it,
    // fail, and often tell the user the capability does not exist.
    const cases: Array<[FrameworkToolGroup, string[]]> = [
      ["resources", ["`resources`", "agent_scratch"]],
      ["chat", ["`chat-history`"]],
      ["automation", ["`manage-jobs`", "`manage-progress`"]],
      // Bold in the full prompt, backticked in the compact one — match both.
      ["workspaceApps", ["call-agent"]],
    ];

    for (const [group, phrases] of cases) {
      const gatedFull = buildFrameworkCore(undefined, {
        disabledFrameworkGroups: new Set([group]),
      });
      const gatedCompact = buildFrameworkCoreCompact(undefined, {
        disabledFrameworkGroups: new Set([group]),
      });

      for (const phrase of phrases) {
        expect(full, `${group} baseline (full)`).toContain(phrase);
        expect(gatedFull, `${group} gated (full)`).not.toContain(phrase);
        expect(gatedCompact, `${group} gated (compact)`).not.toContain(phrase);
      }
    }
  });

  it("keeps the surrounding prose intact when a group is dropped", () => {
    // Dropping a clause must not leave a dangling list or an empty heading.
    const gated = buildFrameworkCore(undefined, {
      disabledFrameworkGroups: new Set<FrameworkToolGroup>([
        "chat",
        "automation",
      ]),
    });

    expect(gated).toContain("### Extended Capabilities");
    expect(gated).toContain("You also have tools for inline embeds");
    expect(gated).not.toMatch(/,\s*,/);
    expect(gated).not.toMatch(/for\s*,/);
    expect(gated).not.toMatch(/,\s*and\s*\./);
    // The planning rule survives without its tool reference.
    expect(gated).toContain("**Plan and track multi-step work**");
  });

  it("keeps extension tool guidance out of assembled prompts by default", () => {
    const defaultPrompts =
      _agentChatPromptSectionsForTests.buildFrameworkPrompts();
    const defaultCorePrompt = buildFrameworkCore();
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts(
      undefined,
      {
        extensionTools: false,
      },
    );
    const corePrompt = buildFrameworkCore(undefined, {
      extensionTools: false,
    });

    expect(defaultPrompts.PROD_FRAMEWORK_PROMPT).not.toContain("Extensions");
    expect(defaultPrompts.PROD_FRAMEWORK_PROMPT_COMPACT).not.toContain(
      "Extensions",
    );
    expect(defaultCorePrompt).toContain(
      "registered actions and connected MCP tools",
    );
    expect(defaultCorePrompt).not.toContain(
      "registered actions, extensions, and connected MCP tools",
    );
    expect(prompts.PROD_FRAMEWORK_PROMPT).not.toContain("Extensions");
    expect(prompts.PROD_FRAMEWORK_PROMPT_COMPACT).not.toContain("Extensions");
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
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts(
      undefined,
      { extensionTools: true },
    );

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
    const prompts = _agentChatPromptSectionsForTests.buildFrameworkPrompts(
      undefined,
      { extensionTools: true },
    );

    // The 7-row routing table and worked examples were cut in favor of one
    // boundary sentence (routing among render-inline-extension/create-extension/
    // show-extension-inline/update-extension is already derivable from each
    // tool's own description; the "can't reach native chrome" case is also
    // restated in connect-builder's own tool description).
    expect(prompts.PROD_FRAMEWORK_PROMPT).toContain(
      "they cannot inject UI into arbitrary native components",
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

  it("registers extension actions only after an explicit opt-in", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });

    // The default-false decision now lives in `resolveFrameworkTools`, which
    // folds the deprecated `extensionTools` flag into `frameworkTools`.
    // `framework-tools.spec.ts` asserts that default behaviorally.
    expect(source).toContain(
      "const extensionToolsEnabled = frameworkTools.extensions;",
    );
    expect(source).toContain("if (extensionToolsEnabled) {");
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

  it("both variants say when to open a progress run without restating the tool's mechanics", () => {
    for (const prompt of [full, compact]) {
      expect(prompt).toContain("manage-progress");
      expect(prompt).toContain("never create single-step plans");
      // The start/update/complete call sequence belongs to `manage-progress`'s
      // own tool description, which the model reads before it can call the
      // tool. Restating it here charges every turn for it.
      expect(prompt).not.toContain('action: "start"');
      expect(prompt).not.toContain('status: "succeeded"');
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

  it("keeps framework kits out of the default first-request tool set", () => {
    // The kits reach this same registry through autoDiscoverActions, so the
    // plain "all template actions" default used to promote ~45 framework
    // schemas into every app's first request. They stay in availableTools and
    // remain reachable through tool-search.
    const withFrameworkKits = {
      ...(actions as Record<string, unknown>),
      "share-resource": { frameworkGroup: "sharing" },
      "list-review-comments": { frameworkGroup: "review" },
    } as never;

    expect(
      _agentChatPromptSectionsForTests.resolveInitialToolNames(
        withFrameworkKits,
      ),
    ).toEqual(["common", "rare"]);

    // An app that genuinely wants one on turn one still names it explicitly.
    expect(
      _agentChatPromptSectionsForTests.resolveInitialToolNames(
        withFrameworkKits,
        ["common", "share-resource"],
      ),
    ).toEqual(["common", "share-resource"]);
  });

  it("points to tool-search for actions omitted from the initial tool set, without re-listing loaded actions (already covered by native tool schemas)", () => {
    const prompt = _agentChatPromptSectionsForTests.generateActionsPrompt(
      actions,
      "tool",
      ["common"],
    );

    expect(prompt).not.toContain("`common`");
    expect(prompt).not.toContain("`rare`");
    expect(prompt).toContain("1 less-common app action is available on demand");
    expect(prompt).toContain("`tool-search`");
  });

  it("returns nothing when every action is already loaded and none has a native widget", () => {
    const prompt = _agentChatPromptSectionsForTests.generateActionsPrompt(
      actions,
      "tool",
    );

    expect(prompt).toBe("");
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

describe("delegated tool surfaces in dev", () => {
  it("enables cross-app delegation by default with an explicit isolation opt-out", () => {
    expect(resolveA2AAgentDelegationEnabled()).toBe(true);
    expect(resolveA2AAgentDelegationEnabled({})).toBe(true);
    expect(resolveA2AAgentDelegationEnabled({ a2aAgentDelegation: true })).toBe(
      true,
    );
    expect(
      resolveA2AAgentDelegationEnabled({ a2aAgentDelegation: false }),
    ).toBe(false);
  });

  // The interactive surface routes template actions through bash in dev to
  // dodge the degenerate empty-object tool call some models emit. A delegated
  // caller (A2A, or `ask_app` over MCP) has nobody to retry for it: with no
  // native action the sibling agent shells out, repeats the same command, and
  // the run dies on the repetition guard minutes later. Both delegated
  // surfaces therefore keep template actions native even in dev.
  it("keep template actions native so a sibling never has to shell out", () => {
    const source = readFileSync("src/server/agent-chat-plugin.ts", {
      encoding: "utf-8",
    });

    const devBranch = (declaration: string): string => {
      const start = source.indexOf(declaration);
      expect(start, `${declaration} not found`).toBeGreaterThan(-1);
      const branch = source.slice(start, start + 1200);
      const elseAt = branch.indexOf(": {");
      expect(elseAt, `${declaration} has no else branch`).toBeGreaterThan(-1);
      return branch.slice(0, elseAt);
    };

    expect(devBranch("const a2aActions = attachToolSearch(")).toContain(
      "...templateScripts,",
    );
    expect(devBranch("const mcpActions = attachToolSearch(")).toContain(
      "...templateScripts,",
    );

    const a2aPrompt = source.slice(
      source.indexOf("// Delegated turns use native template actions"),
      source.indexOf("// Build tools — same as interactive handler."),
    );
    expect(a2aPrompt).toContain("basePrompt +");
    expect(a2aPrompt).not.toContain("devPrompt +");

    const mcpPrompt = source.slice(
      source.indexOf("// ask_app receives native template actions"),
      source.indexOf("const mcpEvents:"),
    );
    expect(mcpPrompt).toContain("basePrompt +");
    expect(mcpPrompt).not.toContain("mcpDevPrompt");
  });
});
