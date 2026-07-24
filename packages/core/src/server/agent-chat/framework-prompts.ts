import nodePath from "node:path";

import type { ActionEntry } from "../../agent/production-agent.js";
import type { DatabaseToolsOption } from "../../scripts/db/tool-mode.js";
import {
  buildFrameworkCore,
  buildFrameworkCoreCompact,
  type PromptExamples,
} from "../prompts/index.js";
import { getRequestOrgId } from "../request-context.js";
import { loadSchemaPromptBlock } from "../schema-prompt.js";
import { resolveInitialToolNames } from "./action-filters-a2a.js";
import {
  createDataWidgetActionEntries,
  FRAMEWORK_CONTEXT_SECTIONS,
} from "./context-tools.js";
import { lazyFs } from "./lazy-fs.js";

// ---------------------------------------------------------------------------
// Framework-level system prompt assembly (production/dev, full/compact),
// the "Available Actions" and corpus-tools prompt sections, the SQL schema
// block, and the codebase file-tree walker used by a few dev-mode tools.
// ---------------------------------------------------------------------------

/**
 * Framework-level instructions injected into every agent's system prompt.
 * Prompt text lives in packages/core/src/server/prompts/ so this file stays
 * focused on routing and assembly logic.
 *
 * buildFrameworkPrompts() is called once per plugin instantiation (not per
 * request) with the template's promptExamples, producing the four assembled
 * prompt strings used at request time.
 */
export function buildFrameworkPrompts(
  examples?: PromptExamples,
  options?: { databaseTools?: DatabaseToolsOption; extensionTools?: boolean },
): {
  FRAMEWORK_CORE: string;
  FRAMEWORK_CORE_COMPACT: string;
  PROD_FRAMEWORK_PROMPT: string;
  DEV_FRAMEWORK_PROMPT: string;
  PROD_FRAMEWORK_PROMPT_COMPACT: string;
  DEV_FRAMEWORK_PROMPT_COMPACT: string;
} {
  const FRAMEWORK_CORE = buildFrameworkCore(examples, options);
  const FRAMEWORK_CORE_COMPACT = buildFrameworkCoreCompact(examples, options);
  const extensionToolsEnabled = options?.extensionTools !== false;
  const planModeArtifactList = extensionToolsEnabled
    ? "source-code handoffs and app-created artifacts such as extensions, widgets, dashboards, calculators, mini-apps, documents, designs, slides, or videos"
    : "source-code handoffs and app-created artifacts such as documents, designs, slides, or videos";
  const planModeBlockedTools = extensionToolsEnabled
    ? "`render-inline-extension`, `create-extension`, `update-extension`, `connect-builder`, or any action that creates, updates, deletes, sends, publishes, or persists data"
    : "`connect-builder`, or any action that creates, updates, deletes, sends, publishes, or persists data";
  const extensionConnectBuilderGuard = extensionToolsEnabled
    ? "If the complete request can be satisfied by a self-contained extension or an existing named slot, use `render-inline-extension`, `create-extension`, `show-extension-inline`, or `update-extension` instead. If the exact placement or behavior requires changing the host UI or no suitable slot exists, continue with the normal `connect-builder` source-change flow even if the user called it an extension; never stop at saying extensions cannot do it."
    : "Because extension tools are disabled, do NOT invent an extension workflow. Only use `connect-builder` when the request genuinely requires changing the host app's source code.";
  const extensionInstructionsFull = extensionToolsEnabled
    ? `### Generative UI and Extensions (Mini-Apps)

In Act mode, if the user asks for generated interactive UI in chat, choose the smallest extension action for the lifetime: \`render-inline-extension\` (one-off, chat-only), \`create-extension\` (saved/reusable), \`show-extension-inline\` (reopen a saved one), or \`update-extension\` (edit an existing one) — call the right one directly, without a "let me build…" preamble. Each tool's own description covers its exact use case, arguments, and available helpers (appAction, dbQuery, extensionData, agentNative.ui.output, etc.). Extensions are sandboxed mini-apps, not source-code changes, and never go through \`connect-builder\`.

If the app exposes native actions or instructions for dashboards, reports, analyses, charts, documents, decks, or other domain artifacts, use those app-native actions first. Choose an extension only when the user explicitly asks for an extension/custom mini-app, or when the app's native artifact format cannot faithfully express the requested interaction.

Editing an existing extension (fix, restyle, rename, add behavior) is a SQL data update — call \`update-extension\` directly using the extensionId from \`<current-screen>\`/\`<current-url>\` when present; never call \`connect-builder\` for it.

Extensions render only on their own page or inside an existing named slot; they cannot inject UI into arbitrary native components. If an extension could only approximate the request in a different location, do not silently downgrade the requirement and do not end with "extensions cannot do that." Briefly explain the boundary, then follow the normal source-code handoff so the app can still be customized fully.

For helper APIs, Alpine.js patterns, the extension-vs-code-change boundary, and worked examples, read the \`extensions\` and \`generative-ui\` skills.`
    : `### Extensions Disabled

Extension creation and management tools are disabled for this app. Do not claim you can create, edit, hide, or delete Agent-Native extensions unless the template exposes its own typed action for that workflow. For requests that would otherwise be handled as an extension/widget/dashboard/calculator mini-app, explain that this app has disabled extension tools and use the app's available actions instead.`;
  const extensionInstructionsCompact = extensionToolsEnabled
    ? `### Generative UI and Extensions (Mini-Apps)

In Act mode, choose the smallest extension action for the lifetime: \`render-inline-extension\` (one-off, chat-only), \`create-extension\` (saved/reusable), \`show-extension-inline\` (reopen a saved one), or \`update-extension\` (edit an existing one) — each tool's own description covers its use case and helpers. These are sandboxed mini-apps, not code changes; never route them through \`connect-builder\`. Do not preface with "let me build…" — just call the right extension action.

Use app-native artifact actions first when they exist for dashboards, reports, analyses, charts, documents, decks, or similar domain artifacts. Pick \`create-extension\` only for explicit extension/custom mini-app requests or for behavior the native artifact format cannot support.

Editing an existing extension is a data update — call \`update-extension\` directly using the extensionId from \`<current-screen>\`/\`<current-url>\` when present; never \`connect-builder\`.

Extensions can render only on their own page or in an existing named slot; they cannot inject UI into arbitrary native components. If the exact request changes host chrome, native components, layout, styles, routes, business logic, or needs placement where no slot exists, treat it as a source-code change and use the normal \`connect-builder\` flow even if the user called it an extension. Never stop at "extensions cannot do that" or silently offer a different placement; explain the boundary briefly and continue the code-change handoff.

See the \`extensions\` and \`generative-ui\` skills for helper APIs, Alpine.js patterns, and worked examples.`
    : `### Extensions Disabled

Extension creation and management tools are disabled for this app. Do not claim you can create, edit, hide, or delete Agent-Native extensions unless the template exposes its own typed action for that workflow.`;

  const PROD_FRAMEWORK_PROMPT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Plan Mode

If the current turn is in Plan mode, plan before anything gets written. This applies to ${planModeArtifactList}. Use only read-only tools, clarify the goal when needed, and return a concrete plan for approval. Do not call ${planModeBlockedTools} until the user switches back to Act mode.

${extensionInstructionsFull}

### Code Changes Not Available — Call \`connect-builder\` Immediately

${extensionConnectBuilderGuard}

In Act mode, when the user asks you to change the UI, modify code, add a feature, fix a bug in the app itself, change styles, add a hook, create a component, add a route, add an integration, or anything else that requires editing source files — you MUST take exactly these steps, in order:

1. Briefly acknowledge the user's specific request in their own terms — one short clause naming what they asked for (e.g. "Got it — wider subject lines in the email list."). Do NOT restate the request verbatim, do NOT add a generic preamble, and do NOT promise outcomes. Skip this step entirely if the user already knows you're handing off (e.g. they said "send this to Builder").
2. Call the \`connect-builder\` tool, passing the user's full request verbatim as the \`prompt\` argument. This renders an inline card. The returned \`builderEnabled\` flag is authoritative: \`true\` means Builder Cloud Agents can take the code-change handoff; \`false\` means this still requires a code change, but no Builder Cloud Agent can run from this workspace. If Builder is connected and \`builderEnabled\` is true, the card hands the prompt off to Builder's cloud agent on one click and returns a branch URL. If Builder is not connected and \`builderEnabled\` is true, it shows the Connect Builder flow. If \`builderEnabled\` is false, it still shows the card, but as a code-change fallback instead of a runnable cloud handoff.
3. After the card renders, inspect the tool result and write one sentence that frames the next click around what the user just asked — not as a Builder pitch. If \`builderEnabled\` is true and the card can send, say something like "Click Send to Builder and it'll wire that up for you." If the user needs to connect first, say something like "Connect Builder once and it'll handle this and future changes." If \`builderEnabled\` is false, say: "This requires a code change. Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like." Do NOT say "click Send to Builder", mention a branch URL, say the card is pre-loaded, or imply a Builder Cloud Agent can run when \`builderEnabled\` is false.

When \`builderEnabled\` is false, Builder Cloud Agents are not self-serve from Builder org settings. Do NOT tell the user to go to Builder org settings, beta features, "Cloud Agents", or "AI Agents" to enable them. The only allowed guidance is the card's code-change fallback: edit locally, use Agent Native Desktop, or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.

**Act-mode handoff — do exactly this:** The moment a code change is requested, call \`connect-builder\` with the user's verbatim request, then write one sentence framing the next click. That is the whole job: Builder plans and edits in its own sandbox, so the planning, file-mapping, and code all happen there, not here. Keep your turn to the call plus that one sentence — skip code exploration, implementation plans, \`resources\` writes of specs, and sub-agents (they have no code-editing tools either). You don't need filesystem access to recommend Builder, so don't reach for it or list tools you lack.

Builder Cloud Agents are the recommended path when \`builderEnabled\` is true because they are one-click and run in the cloud. Local dev, Agent Native Desktop, and Builder.io cloud editing are the fallback when \`builderEnabled\` is false.
${FRAMEWORK_CORE}`;

  const DEV_FRAMEWORK_PROMPT = `## Agent-Native Framework — Development Mode

You are an AI agent in an agent-native application, running in **development mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via tools/scripts, and vice versa. They share the same SQL database and stay in sync automatically.

**In development mode, you have full local access — use it with senior-engineer judgment** (read before you edit, keep changes scoped, verify before you claim done):
- Run any shell command via the \`bash\` tool (node, curl, pnpm, rg, git, etc.), including arbitrary code: \`bash({ command: 'node -e "console.log(1+1)"' })\`
- Read and write any file on the filesystem; edit source, install packages, modify the app
- Query and modify the database
- Call external APIs (via bash with curl, or via scripts)

When no dedicated tool/action exists for what you need, reach for \`bash\` — e.g. \`bash({ command: 'curl -s https://api.example.com/data' })\`.

**Template-specific actions are invoked via bash, NOT as direct tools.** In dev mode, the only tools registered as native tool calls are framework-level utilities (bash, read, edit, write, database, resources, chat, teams, jobs). Anything from the template's \`actions/\` directory must be run through bash: \`bash({ command: 'pnpm action <name> --arg value' })\`. The "Available Actions" section below shows the exact CLI syntax for each one — copy that command verbatim and pass it to \`bash\`. Do not try to call template actions by name as if they were tools; they will not appear in your tool list.

When editing code, follow the agent-native architecture:
- Every feature needs all four areas: UI + scripts + skills/instructions + application-state sync
- All SQL must be dialect-agnostic (works on SQLite and Postgres)
- No Node.js-specific APIs in server routes (must work on Cloudflare Workers, etc.)
- Use shadcn/ui components and Tabler Icons for all UI work
${FRAMEWORK_CORE}`;

  const PROD_FRAMEWORK_PROMPT_COMPACT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Plan Mode

If the turn is in Plan mode, plan before anything gets written — including ${planModeArtifactList}. Use read-only tools only and do not call ${planModeBlockedTools} until the user switches back to Act mode.

${extensionInstructionsCompact}

### Code Changes — Call \`connect-builder\`

In Act mode, when a request genuinely needs a source-code edit (per the rules above), do this in order: (1) briefly acknowledge the user's specific ask in their own terms — one short clause, no preamble — then (2) call \`connect-builder\` with the user's request as the \`prompt\`, then (3) inspect \`builderEnabled\` in the result and write one sentence framing the next click around what they asked for, not a Builder pitch. When \`builderEnabled\` is true, Builder Cloud Agents can take the handoff; when \`builderEnabled\` is false, say this requires a code change and they can edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way they like. Do NOT write code, list files, make plans, or spawn sub-agents. Mention \`npx agent-native create <app-name>\`, Agent Native Desktop, or the code-change fallback when Builder Cloud Agents aren't available. Never tell users to enable Builder Cloud Agents from Builder org settings, beta features, "Cloud Agents", or "AI Agents"; they are not self-serve there.
${FRAMEWORK_CORE_COMPACT}`;

  const DEV_FRAMEWORK_PROMPT_COMPACT = `## Agent-Native Framework — Development Mode

You are an AI agent in an agent-native application, running in **development mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via tools/scripts, and vice versa. They share the same SQL database and stay in sync automatically.

**In development mode, you have full local access** — shell, filesystem, database, external APIs, source edits, and package installs. Use it with senior-engineer judgment: read before you edit, keep changes scoped, verify before you claim done.

**Template-specific actions are invoked via bash, NOT as direct tools.** Run them with: \`bash({ command: 'pnpm action <name> --arg value' })\`. See the "Available Actions" section below for CLI syntax.

When editing code, follow the agent-native architecture:
- Every feature needs all four areas: UI + scripts + skills/instructions + application-state sync
- All SQL must be dialect-agnostic (works on SQLite and Postgres)
- No Node.js-specific APIs in server routes (must work on Cloudflare Workers, etc.)
- Use shadcn/ui components and Tabler Icons for all UI work
${FRAMEWORK_CORE_COMPACT}`;

  return {
    FRAMEWORK_CORE,
    FRAMEWORK_CORE_COMPACT,
    PROD_FRAMEWORK_PROMPT,
    DEV_FRAMEWORK_PROMPT,
    PROD_FRAMEWORK_PROMPT_COMPACT,
    DEV_FRAMEWORK_PROMPT_COMPACT,
  };
}

export const _agentChatPromptSectionsForTests = (() => {
  // Built with default (no template-specific) examples for test stability.
  const {
    FRAMEWORK_CORE: frameworkCore,
    FRAMEWORK_CORE_COMPACT: frameworkCoreCompact,
  } = buildFrameworkPrompts();
  return {
    frameworkCore,
    frameworkCoreCompact,
    frameworkContextSections: FRAMEWORK_CONTEXT_SECTIONS,
    buildFrameworkPrompts,
    generateActionsPrompt,
    resolveInitialToolNames,
    createDataWidgetActionEntries,
  };
})();

/**
 * Build the per-request SQL-schema context block. Reads AGENT_ORG_ID live
 * from the environment so scheduler/A2A/HTTP call sites all see whatever
 * org was just resolved for this request.
 */
export async function buildSchemaBlock(
  owner: string,
  databaseTools: DatabaseToolsOption = "read",
): Promise<string> {
  try {
    return await loadSchemaPromptBlock({
      owner,
      orgId: getRequestOrgId() ?? null,
      databaseTools,
    });
  } catch {
    return "";
  }
}

/**
 * Generates a system prompt section describing registered template actions.
 *
 * Two output modes:
 *
 *   - `"tool"` — used in production, where template actions are registered
 *     as native Anthropic tools. The native tool schema already carries each
 *     action's name, full description, and parameters, so this mode does NOT
 *     re-list every action — it only surfaces what the tool list can't:
 *     native-chat-widget annotations and a `tool-search` pointer for actions
 *     omitted from the initial tool set.
 *   - `"cli"` — used in dev, where template actions are NOT registered as
 *     native tools and must be invoked via `bash(command="pnpm action ...")`.
 *     This listing is load-bearing here (there is no tool schema to fall
 *     back on), so it still emits the full
 *     `pnpm action name --arg <type> [--opt <type>] — desc` line per action.
 */
export function generateActionsPrompt(
  registry: Record<string, ActionEntry>,
  mode: "cli" | "tool" = "tool",
  initialToolNames?: string[],
): string {
  if (!registry || Object.keys(registry).length === 0) return "";

  const allActionEntries = Object.entries(registry);
  const initialNames = initialToolNames ? new Set(initialToolNames) : undefined;
  const actionEntries = initialNames
    ? allActionEntries.filter(([name]) => initialNames.has(name))
    : allActionEntries;
  const omittedActionCount = allActionEntries.length - actionEntries.length;
  const nativeWidgetNote = (entry: ActionEntry) =>
    entry.chatUI && typeof entry.chatUI.renderer === "string"
      ? ` Native chat widget: \`${entry.chatUI.renderer}\`.`
      : "";

  if (mode === "tool") {
    // Native tool schemas already carry name + full description + params
    // for every action, so this section only needs to surface what the tool
    // list itself can't: which actions render a native chat widget, and
    // which actions exist but aren't loaded as initial tools yet.
    const widgetLines = actionEntries
      .filter(([, entry]) => typeof entry.chatUI?.renderer === "string")
      .map(
        ([name, entry]) =>
          `- \`${name}\` — Native chat widget: \`${entry.chatUI?.renderer ?? ""}\`.`,
      );

    const sections: string[] = [];
    if (widgetLines.length > 0) {
      sections.push(
        `**Actions that render a native chat widget** — call these directly for their table/chart/insights view instead of recreating it in prose:\n\n${widgetLines.join("\n")}`,
      );
    }
    if (omittedActionCount > 0) {
      sections.push(
        `${omittedActionCount} less-common app action${omittedActionCount === 1 ? " is" : "s are"} available on demand. Use \`tool-search\` with a specific capability query to load the matching schemas when needed.`,
      );
    }
    if (sections.length === 0) return "";

    return `\n\n## Available Actions\n\n${sections.join("\n\n")}`;
  }

  const lines = actionEntries.map(([name, entry]) => {
    const desc = entry.tool.description;
    const params = entry.tool.parameters?.properties;
    const requiredFields = new Set(entry.tool.parameters?.required ?? []);

    // CLI mode: emit `pnpm action <name> --required <type> [--optional <type>]`
    if (!params || Object.keys(params).length === 0) {
      return `- \`pnpm action ${name}\` — ${desc}${nativeWidgetNote(entry)}`;
    }
    const entries = Object.entries(params);
    // Required first (alphabetical), then optional (alphabetical)
    entries.sort(([a], [b]) => {
      const ar = requiredFields.has(a) ? 0 : 1;
      const br = requiredFields.has(b) ? 0 : 1;
      if (ar !== br) return ar - br;
      return a.localeCompare(b);
    });
    const required: string[] = [];
    const optional: string[] = [];
    const requiredNames: string[] = [];
    for (const [k, v] of entries) {
      const type = (v as { type?: string }).type ?? "any";
      const flag = `--${k} <${type}>`;
      if (requiredFields.has(k)) {
        required.push(flag);
        requiredNames.push(`--${k}`);
      } else {
        optional.push(`[${flag}]`);
      }
    }
    const cmd = ["pnpm action " + name, ...required, ...optional].join(" ");
    const requiredNote =
      requiredNames.length > 0 ? ` Required: ${requiredNames.join(", ")}.` : "";
    return `- \`${cmd}\` — ${desc}.${requiredNote}${nativeWidgetNote(entry)}`;
  });

  return `\n\n## Available Actions

**These template actions are NOT exposed as direct tools in dev mode. To run any of them, use the \`bash\` tool with the exact command shown below.** Example: \`bash(command="pnpm action add-slide --deckId abc --content 'Hello'")\`.

Do NOT try to call these by name as if they were tools — they will not exist in your tool list. Always go through \`bash\`.

${lines.join("\n")}`;
}

/**
 * Tool names `generateCorpusToolsPrompt` teaches BY NAME, in the same order
 * it lists them. Exported so callers that build a request's initial
 * engine-tool set can fold in exactly the subset present in a given
 * registry — keeping "what the prompt just told the model exists" and
 * "what tools are actually callable on the first request" in sync. See the
 * corpus-prompt/initial-tools note at this function's call site in
 * agent-chat-plugin.ts.
 */
const CORPUS_TOOL_NAMES = [
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "run-code",
] as const;

export function corpusToolNamesTaughtByPrompt(
  registry: Record<string, ActionEntry>,
): string[] {
  return CORPUS_TOOL_NAMES.filter((name) => name in registry);
}

export function generateCorpusToolsPrompt(
  registry: Record<string, ActionEntry>,
): string {
  const hasProviderApi = "provider-api-request" in registry;
  const hasProviderCorpusJob = "provider-corpus-job" in registry;
  const providerDiscoveryTools = [
    "provider-api-catalog" in registry ? "`provider-api-catalog`" : null,
    "provider-api-docs" in registry ? "`provider-api-docs`" : null,
  ].filter(Boolean);
  const hasRunCode = "run-code" in registry;
  const hasStagedDataset = "query-staged-dataset" in registry;
  if (
    !hasProviderApi &&
    !hasProviderCorpusJob &&
    !hasRunCode &&
    !hasStagedDataset
  )
    return "";

  const available = [
    ...providerDiscoveryTools,
    hasProviderApi ? "`provider-api-request`" : null,
    hasProviderCorpusJob ? "`provider-corpus-job`" : null,
    hasStagedDataset ? "`query-staged-dataset`" : null,
    hasRunCode ? "`run-code`" : null,
  ].filter(Boolean);

  return `\n\n## Broad Provider And Corpus Workflows

Available corpus-capable tools: ${available.join(", ")}.

This workflow does not apply to ordinary structured lookups, bounded aggregates, or counts grouped over one known source. For those requests, use the single most directly authoritative source, run one bounded query, and answer as soon as it succeeds. Do not cross-check or expand into a corpus workflow unless the user asks for multiple sources, exhaustive unstructured-record coverage, or an absence claim.

For broad provider searches, raw API access, multi-page cohorts, cross-source joins, classification over unstructured records, or absence-sensitive answers, do not stop at a bounded shortcut action. Use the provider's broad API/search/list surface, fetch every relevant page or an explicit bounded cohort, stage/save large responses when needed, and reduce the corpus with durable corpus jobs, staged-dataset queries, or code execution.

When \`provider-corpus-job\` is available, prefer it for transcript/message/ticket/issue/document scans that may exceed one turn, need provider-side backoff, or need a defensible "not found" conclusion. Use operation="start" with mode="paginated-search" for any paginated provider endpoint, or mode="batch-search" when a prior cohort of ids/records must feed a second provider endpoint. Continue paused jobs with operation="continue" until status is completed or quota_wait, then read operation="results". In run-code, prefer providerFetchAll() for short cursor/page/offset pagination and providerRequest() when response status, headers, or truncation metadata matters. Report source, filters, row counts, pagination/truncation, failed pages, quota_wait times, and remaining gaps.`;
}

/**
 * Walks the local filesystem (dev mode only) to build a bounded file/folder
 * tree, used by a couple of dev-mode workspace-inspection tools.
 */
export async function collectFiles(
  dir: string,
  prefix: string,
  depth: number,
  results: Array<{ path: string; name: string; type: "file" | "folder" }>,
): Promise<void> {
  if (depth > 4 || results.length >= 500) return;
  const skip = new Set([
    "node_modules",
    ".git",
    ".next",
    ".output",
    "dist",
    ".cache",
    ".turbo",
    "data",
  ]);
  let entries: import("fs").Dirent[];
  try {
    const fs = await lazyFs();
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= 500) return;
    if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();
    results.push({
      path: relPath,
      name: entry.name,
      type: isDir ? "folder" : "file",
    });
    if (isDir)
      await collectFiles(
        nodePath.join(dir, entry.name),
        relPath,
        depth + 1,
        results,
      );
  }
}
