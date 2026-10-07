import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  actionsToEngineTools,
  attachToolSearch,
  buildCompactSkillsSummary,
  filterInitialEngineTools,
  loadActionsFromStaticRegistry,
  searchToolRegistry,
} from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  options: [] as Array<Record<string, any>>,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...original,
    createAgentChatPlugin: (options: Record<string, unknown>) => {
      captured.options.push(options);
      return () => {};
    },
  };
});

/**
 * Ratchet: the first hosted request, estimated. Lower it whenever a change
 * trims the baseline; raise it only with a reason written next to the new
 * number, because every token here is paid on every turn of every chat.
 */
const BASELINE_BUDGET_TOKENS = 18_000;

/** An estimate: real tokenizers differ by model, and JSON runs 3 to 3.5. */
const CHARS_PER_TOKEN = 3.5;
const MAX_TOOL_SCHEMA_TOKENS = 3_000;
const MAX_EXTRA_CONTEXT_TOKENS = 2_500;
/** `prompt-resources.ts` slices a template AGENTS.md here in the compact prompt. */
const COMPACT_RESOURCE_MAX_CHARS = 6_000;
/**
 * What cannot be measured offline: `<available-apps>`, org LEARNINGS.md,
 * memory instructions, runtime context, the code-execution note, the model
 * overlay, and framework tools the plugin registers at request time.
 */
const RUNTIME_ALLOWANCE_CHARS = 8_000;

/** Tools over MAX_TOOL_SCHEMA_TOKENS, each with the reason it earns the space. */
const SCHEMA_BUDGET_EXCEPTIONS: Record<string, string> = {};

/** Framework tools the plugin registers at request time, so no registry built here has them. */
const RUNTIME_REGISTERED_TOOLS = ["run-code", "connect-builder"];
/** Actions of another app, reached through `call-agent`; they are not local tools. */
const REMOTE_ACTIONS = ["list-dispatch-usage-metrics"];
/** Kebab-case names in the instructions that are not tools (state keys, `navigate` views). */
const NOT_TOOLS = ["selected-object", "event-catalog"];

/** Tools the initial surface used to carry. Each must stay one `tool-search` away. */
const LAZY_TOOLS = [
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "update-dashboard",
  "compose-dashboard",
  "generate-chart",
  "list-session-recordings",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "get-session-replay-events",
  "create-session-replay-agent-link",
  "list-error-issues",
  "get-error-issue",
  "create-extension",
  "update-extension",
  "get-extension",
  "list-extensions",
  "extension-data-set",
  "show-workspace-file",
];

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

generateActionRegistryForProject(projectRoot);
const { default: actionsRegistry } = await import(
  `${pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts")).href}?cacheBust=${Date.now()}`
);
await import("./agent-chat");
const pluginOptions = captured.options[0] as {
  initialToolNames: string[];
  extraContext: () => string | Promise<string>;
};

// The framework builds these inside the plugin, with no public factory.
const coreDist = path.resolve(
  path.dirname(
    createRequire(import.meta.url).resolve("@agent-native/core/server"),
  ),
  "..",
);
const coreInternal = (relativePath: string) =>
  import(
    /* @vite-ignore */ pathToFileURL(path.join(coreDist, relativePath)).href
  );
const scriptEntries = await coreInternal("server/agent-chat/script-entries.js");
const extensionActions = await coreInternal("extensions/actions.js");
const workspaceFileActions = await coreInternal("workspace-files/actions.js");
const skillMetadata = await import("@agent-native/core/resources/metadata");

const templateActions = loadActionsFromStaticRegistry(actionsRegistry);
const agentVisibleTemplateActions = Object.fromEntries(
  Object.entries(templateActions).filter(
    ([, entry]) => entry.agentTool !== false && entry.uiOnly !== true,
  ),
);
const docsScripts = await scriptEntries.createDocsScriptEntries();
// Mirrors `leanActionEntries` in agent-chat-plugin.ts, minus what it registers at request time.
const leanRegistry = attachToolSearch({
  ...agentVisibleTemplateActions,
  ...(await scriptEntries.createResourceScriptEntries()),
  "docs-search": docsScripts["docs-search"],
  ...workspaceFileActions.createWorkspaceFileActionEntries(),
  ...(await scriptEntries.createCallAgentScriptEntry("analytics")),
  ...extensionActions.createExtensionActionEntries(),
});

// `resolveInitialToolNames` adds every template action that opts out of deferral.
const eagerTemplateActions = Object.entries(agentVisibleTemplateActions)
  .filter(([, entry]) => entry.deferLoading === false)
  .map(([name]) => name);
const initialToolNames = [
  ...new Set([...pluginOptions.initialToolNames, ...eagerTemplateActions]),
];

const skillsDir = path.join(projectRoot, ".agents/skills");
const skillNames = readdirSync(skillsDir);
const runtimeSkills = skillNames.flatMap((dir) => {
  const frontmatter = skillMetadata.parseFrontmatter(
    readFileSync(path.join(skillsDir, dir, "SKILL.md"), "utf8"),
  );
  const scope = skillMetadata.getFrontmatterValue(frontmatter, "scope");
  if (scope === "dev") return [];
  return [
    {
      meta: {
        name: skillMetadata.getFrontmatterValue(frontmatter, "name") ?? dir,
        description:
          skillMetadata.getFrontmatterValue(frontmatter, "description") ??
          undefined,
      },
    },
  ];
});
const skillsSummary =
  buildCompactSkillsSummary(runtimeSkills, "docs-search") ?? "";

const agentsGuide = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
const learningsDefaults = readFileSync(
  path.join(projectRoot, "learnings.defaults.md"),
  "utf8",
);
const extraContext = String((await pluginOptions.extraContext()) ?? "");

const tokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

const initialTools = filterInitialEngineTools(
  actionsToEngineTools(leanRegistry),
  initialToolNames,
);
const toolRows = initialTools
  .map((tool): [string, number] => [
    `tool:${tool.name}`,
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }).length,
  ])
  .sort((a, b) => b[1] - a[1]);
const rows: Array<[string, number]> = [
  ...toolRows,
  ["system:extraContext", extraContext.length],
  [
    "system:AGENTS.md",
    Math.min(agentsGuide.length, COMPACT_RESOURCE_MAX_CHARS) + 300,
  ],
  [
    `system:skills-summary(${runtimeSkills.length} runtime skills)`,
    skillsSummary.length,
  ],
  ["system:learnings.defaults.md", learningsDefaults.length + 200],
  ["system:runtime allowance (fixed estimate)", RUNTIME_ALLOWANCE_CHARS],
];
const totalChars = rows.reduce((sum, [, chars]) => sum + chars, 0);
const toolChars = toolRows.reduce((sum, [, chars]) => sum + chars, 0);

function componentTable(): string {
  return [
    `BASELINE ~${tokens(totalChars)} tokens (budget ${BASELINE_BUDGET_TOKENS}, chars/${CHARS_PER_TOKEN} estimate); tools(${toolRows.length})=${tokens(toolChars)}t system=${tokens(totalChars - toolChars)}t`,
    ...[...rows]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([name, chars]) => `  ${String(tokens(chars)).padStart(6)}t  ${name}`,
      ),
  ].join("\n");
}

function backtickedToolNames(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

describe("Analytics first-request baseline", () => {
  it("stays within the token budget", () => {
    expect(tokens(totalChars), componentTable()).toBeLessThanOrEqual(
      BASELINE_BUDGET_TOKENS,
    );
  });

  it("keeps the always-on instructions inside their own budgets", () => {
    expect(tokens(extraContext.length)).toBeLessThanOrEqual(
      MAX_EXTRA_CONTEXT_TOKENS,
    );
    expect(agentsGuide.trim().length).toBeLessThanOrEqual(
      COMPACT_RESOURCE_MAX_CHARS,
    );
  });

  it("names only initial tools that exist as agent-visible tools", () => {
    const missing = initialToolNames.filter((name) => !leanRegistry[name]);

    expect(missing).toEqual([]);
  });

  it("keeps the skill reader callable on the first request", () => {
    // The skills summary and the skills rule both send the model to docs-search.
    expect(initialTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["docs-search", "tool-search"]),
    );
  });

  it("never lists a deferred action as an initial tool", () => {
    const deferred = pluginOptions.initialToolNames.filter(
      (name) => agentVisibleTemplateActions[name]?.deferLoading === true,
    );

    expect(deferred).toEqual([]);
  });

  it("names only tools that exist in the lean registry", () => {
    const known = new Set([
      ...Object.keys(leanRegistry),
      ...RUNTIME_REGISTERED_TOOLS,
      ...REMOTE_ACTIONS,
      ...NOT_TOOLS,
      ...skillNames,
    ]);
    const unknown = Object.entries({
      extraContext,
      "AGENTS.md": agentsGuide,
      "skills-summary": skillsSummary,
    }).flatMap(([source, text]) =>
      backtickedToolNames(text)
        .filter((name) => !known.has(name))
        .map((name) => `${source}: \`${name}\``),
    );

    expect(unknown).toEqual([]);
  });

  it("keeps every schema under the per-tool ceiling unless it earns an exception", () => {
    const oversized = toolRows
      .filter(
        ([name, chars]) =>
          tokens(chars) > MAX_TOOL_SCHEMA_TOKENS &&
          !(name.slice("tool:".length) in SCHEMA_BUDGET_EXCEPTIONS),
      )
      .map(([name, chars]) => `${name} ~${tokens(chars)}t`);

    expect(oversized).toEqual([]);
  });

  it("leaves every dropped tool one tool-search away", () => {
    const found = searchToolRegistry(leanRegistry, { names: LAZY_TOOLS });
    const callable = new Set(
      found.results.filter((result) => result.callable).map((r) => r.name),
    );

    expect(LAZY_TOOLS.filter((name) => !callable.has(name))).toEqual([]);
    expect(
      LAZY_TOOLS.filter((name) => initialToolNames.includes(name)),
    ).toEqual([]);
  });
});
