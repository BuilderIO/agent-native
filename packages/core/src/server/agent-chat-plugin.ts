import {
  runWithRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  getRequestRunContext,
  ensureRequestRunContext,
} from "./request-context.js";
import { getSetting, putSetting } from "../settings/store.js";
import { createDbAdminAgentTools } from "../db-admin/agent-tools.js";
import {
  getH3App,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";
import {
  createProductionAgentHandler,
  actionsToEngineTools,
  getActiveRunForThreadAsync,
  abortRun,
  subscribeToRun,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../agent/run-loop-with-resume.js";
import type { AgentEngine, EngineMessage } from "../agent/engine/types.js";
import {
  resolveEngine,
  createAnthropicEngine,
  getStoredModelForEngine,
  normalizeModelForEngine,
  getAgentEngineEntry,
  isAgentEnginePackageInstalled,
  isStoredEngineUsableForRequest,
  listAgentEngines,
  registerBuiltinEngines,
} from "../agent/engine/index.js";
import {
  canUpdateAgentAppModelDefaultSettings,
  normalizeAgentAppModelDefaultAppId,
  readAgentAppModelDefaultSettings,
  resetAgentAppModelDefaultSettings,
  writeAgentAppModelDefaultSettings,
} from "../agent/app-model-defaults.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../agent/default-model.js";
import type {
  AgentChatAttachment,
  AgentChatEvent,
  AgentChatReference,
  ActionTool,
  MentionProvider,
} from "../agent/types.js";
import { attachToolSearch } from "../agent/tool-search.js";
import type { ActionHttpConfig } from "../action.js";
import {
  McpClientManager,
  loadMcpConfig,
  autoDetectMcpConfig,
  mcpToolsToActionEntries,
  syncMcpActionEntries,
  mountMcpServersRoutes,
  mountMcpHubRoutes,
  buildMergedConfig,
  startMcpConfigRefresh,
  areBuiltinMcpCapabilitiesSupported,
  setBuiltinMcpCapabilityEnabled,
  getHubStatus,
  isHubServeEnabled,
  type BuiltinMcpCapabilityId,
} from "../mcp-client/index.js";
import { discoverAgents } from "./agent-discovery.js";
import { loadSchemaPromptBlock } from "./schema-prompt.js";
import {
  buildAssistantMessage,
  buildUserMessage,
  extractThreadMeta,
  foldAssistantTurn,
  mergeThreadDataForClientSave,
  upsertUserMessage,
} from "../agent/thread-data-builder.js";
import {
  createError,
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getQuery,
  getHeader,
  type H3Event,
} from "h3";
import { getSession } from "./auth.js";
import { getOrigin } from "./google-oauth.js";
import {
  createThread,
  forkThread,
  getThread,
  listThreads,
  searchThreads,
  renameThread,
  setThreadArchived,
  setThreadPinned,
  setThreadScope,
  updateThreadData,
  withThreadDataLock,
  deleteThread,
  setThreadQueuedMessages,
  type ChatThreadScope,
  type ForkThreadSourceSnapshot,
} from "../chat-threads/store.js";
import { callerOwnsRun, callerOwnsThread } from "../agent/run-ownership.js";
import {
  resourceList,
  resourceListAccessible,
  resourceGet,
  resourceGetByPath,
  ensurePersonalDefaults,
  SHARED_OWNER,
  WORKSPACE_OWNER,
} from "../resources/store.js";
import {
  getFrontmatterValue,
  getSkillNameFromPath,
  parseFrontmatter,
} from "../resources/metadata.js";
import nodePath from "node:path";
import { readBody } from "./h3-helpers.js";
import {
  AGENT_TEAM_PROCESS_RUN_PATH,
  getCurrentDelegationDepth,
  processAgentTeamRun,
  reconcileAgentTeamRunsForOwner,
} from "./agent-teams.js";
import { setProgressPreListHook } from "../progress/store.js";
import {
  verifyInternalToken,
  extractBearerToken,
} from "../integrations/internal-token.js";
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "../a2a/auth-policy.js";
import {
  getBuilderBrowserConnectUrlForOwner,
  resolveBuilderBranchProjectId,
} from "./builder-browser.js";
import { captureCliOutput } from "./cli-capture.js";
import { withConfiguredAppBasePath } from "./app-base-path.js";
import {
  appendA2AArtifactLinks,
  buildA2ARecoverableArtifactMessage,
  type A2AArtifactResponseOptions,
  type A2AToolResultSummary,
} from "../a2a/artifact-response.js";
import { updateTaskStatusMessage } from "../a2a/task-store.js";
import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import { buildRuntimeContextPrompt } from "../agent/runtime-context.js";
import {
  buildFrameworkCore,
  buildFrameworkCoreCompact,
  FIRST_SESSION_PERSONALIZATION,
  getModelFamilyOverlay,
  type PromptExamples,
} from "./prompts/index.js";

// Lazy fs — loaded via dynamic import() on first use.
// This avoids require() which bundlers convert to createRequire(import.meta.url)
// that crashes on CF Workers where import.meta.url is undefined.
let _fs: typeof import("fs") | undefined;
async function lazyFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}

const SHARED_PROMPT_RESOURCE_MAX_CHARS = 30_000;
const COMPACT_PROMPT_RESOURCE_MAX_CHARS = 12_000;
const MAX_ACTION_SUMMARY_DESCRIPTION_CHARS = 140;

function compactPromptLine(value: string, maxChars: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1)}…`;
}
const SHARED_RESOURCE_INDEX_LIMIT = 40;

function normalizeResourcePathForPrompt(path: string): string {
  return path.replace(/^\/+/, "").trim();
}

function resourceToolHint(
  action: "list" | "read" | "effective" | "write" | "delete" | "promote",
  extra?: string,
): string {
  return `Use the \`resources\` tool with \`action: "${action}"\`${extra ? `, ${extra}` : ""}.`;
}

function skillDocsSlug(name: string): string {
  return `skill-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function truncatePromptResourceContent(
  content: string,
  path: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
  readHint?: string,
): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const omitted = trimmed.length - maxChars;
  const hint =
    readHint ??
    resourceToolHint(
      "read",
      `\`path: "${path}"\` and the resource's \`scope\` for the full content`,
    );
  return `${trimmed.slice(0, maxChars)}\n\n[Resource ${path} truncated after ${maxChars.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted. ${hint}]`;
}

function promptResourceBlock(input: {
  name: string;
  scope: string;
  content: string;
  path?: string;
  maxChars?: number;
  readHint?: string;
}): string | null {
  const normalizedPath = input.path
    ? normalizeResourcePathForPrompt(input.path)
    : undefined;
  const content = truncatePromptResourceContent(
    input.content,
    normalizedPath ?? input.name,
    input.maxChars,
    input.readHint,
  );
  if (!content) return null;
  const pathAttr = normalizedPath
    ? ` path="${escapeXmlAttribute(normalizedPath)}"`
    : "";
  return `<resource name="${escapeXmlAttribute(input.name)}" scope="${escapeXmlAttribute(input.scope)}"${pathAttr}>\n${content}\n</resource>`;
}

function isAutoLoadedInstructionPath(path: string): boolean {
  const normalized = normalizeResourcePathForPrompt(path);
  return normalized.startsWith("instructions/") && normalized.endsWith(".md");
}

function isSpecialPromptResourcePath(path: string): boolean {
  const normalized = normalizeResourcePathForPrompt(path);
  return (
    normalized === "AGENTS.md" ||
    normalized === "LEARNINGS.md" ||
    normalized.startsWith("instructions/") ||
    normalized.startsWith("skills/") ||
    normalized.startsWith("agents/") ||
    normalized.startsWith("remote-agents/") ||
    normalized.startsWith("jobs/") ||
    normalized.startsWith("memory/")
  );
}

function isTextLikeResource(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/yaml" ||
    mimeType === "application/x-yaml"
  );
}

function getResourceSummaryFromContent(content: string): string | null {
  const frontmatter = parseFrontmatter(content);
  const title =
    getFrontmatterValue(frontmatter, "title") ||
    getFrontmatterValue(frontmatter, "name");
  const description = getFrontmatterValue(frontmatter, "description");
  if (title && description) return `${title}: ${description}`;
  if (title) return title;
  if (description) return description;

  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,3}\s+/, "").trim();
  return null;
}

function resourceScopeForOwner(owner: string, currentOwner?: string): string {
  if (owner === WORKSPACE_OWNER) return "workspace";
  if (owner === SHARED_OWNER) return "shared";
  if (currentOwner && owner === currentOwner) return "personal";
  return "resource";
}

async function loadAgentsResourceForPrompt(
  owner: string,
  scope: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
): Promise<string | null> {
  try {
    const agents = await resourceGetByPath(owner, "AGENTS.md");
    if (!agents?.content?.trim()) return null;
    return promptResourceBlock({
      name: "AGENTS.md",
      scope,
      path: "AGENTS.md",
      content: agents.content,
      maxChars,
    });
  } catch {
    return null;
  }
}

async function loadInstructionResourcesForPrompt(
  owner: string,
  scope: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
): Promise<string[]> {
  try {
    const resources = await resourceList(owner, "instructions/");
    const blocks: string[] = [];
    const sorted = resources
      .filter((resource) => isAutoLoadedInstructionPath(resource.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const resource of sorted) {
      const full = await resourceGet(resource.id).catch(() => null);
      if (!full?.content?.trim()) continue;
      const block = promptResourceBlock({
        name: resource.path,
        scope,
        path: resource.path,
        content: full.content,
        maxChars,
      });
      if (block) blocks.push(block);
    }
    return blocks;
  } catch {
    return [];
  }
}

async function loadResourceSkillsPromptBlock(
  owner: string,
): Promise<string | null> {
  try {
    const resources =
      owner === SHARED_OWNER
        ? [
            ...(await resourceList(SHARED_OWNER, "skills/")),
            ...(await resourceList(WORKSPACE_OWNER, "skills/")),
          ]
        : await resourceListAccessible(owner, "skills/");
    const sorted = resources.sort((a, b) => {
      const ownerOrder =
        (a.owner === owner
          ? 0
          : a.owner === SHARED_OWNER
            ? 1
            : a.owner === WORKSPACE_OWNER
              ? 2
              : 3) -
        (b.owner === owner
          ? 0
          : b.owner === SHARED_OWNER
            ? 1
            : b.owner === WORKSPACE_OWNER
              ? 2
              : 3);
      if (ownerOrder !== 0) return ownerOrder;
      return a.path.localeCompare(b.path);
    });
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const resource of sorted) {
      const full = await resourceGet(resource.id).catch(() => null);
      if (!full?.content) continue;
      const meta = parseSkillFrontmatter(full.content);
      if (meta.userInvocable === false) continue;
      const name = meta.name || getSkillNameFromPath(resource.path);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const scope = resourceScopeForOwner(resource.owner, owner);
      const description = meta.description || "(no description)";
      lines.push(
        `- \`${name}\` at resource \`${resource.path}\` (${scope}) - ${ensureSentence(description)} ${resourceToolHint(
          "read",
          `\`path: "${resource.path}"\` and \`scope: "${scope}"\` before starting a task it applies to`,
        )}`,
      );
    }
    if (lines.length === 0) return null;
    return `<resource-skills>\nThe following workspace skills are available in addition to codebase skills. They may come from SQL resources, Dispatch workspace resources, or local file mode. Read a matching skill before starting a task it applies to.\n\n${lines.join("\n")}\n</resource-skills>`;
  } catch {
    return null;
  }
}

async function loadResourceIndexForPrompt(
  owner: string,
  scope: "workspace" | "shared",
): Promise<string | null> {
  try {
    const resources = (await resourceList(owner))
      .filter(
        (resource) =>
          !isSpecialPromptResourcePath(resource.path) &&
          isTextLikeResource(resource.mimeType),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    if (resources.length === 0) return null;

    const listed = resources.slice(0, SHARED_RESOURCE_INDEX_LIMIT);
    const lines: string[] = [];
    for (const resource of listed) {
      const full = await resourceGet(resource.id).catch(() => null);
      const summary = full?.content
        ? getResourceSummaryFromContent(full.content)
        : null;
      lines.push(`- \`${resource.path}\`${summary ? ` - ${summary}` : ""}`);
    }
    if (resources.length > listed.length) {
      lines.push(
        `- ...${resources.length - listed.length} more ${scope} resources. ${resourceToolHint(
          "list",
          `\`scope: "${scope}"\` to inspect them`,
        )}`,
      );
    }

    const label =
      scope === "workspace"
        ? "Workspace reference resources are inherited by every app and are available for company, brand, positioning, persona, product, or domain context."
        : "Shared app/organization reference resources are available for app-specific or team context.";
    return `<workspace-resources scope="${scope}">\n${label} ${resourceToolHint(
      "read",
      `\`path: <path>\` and \`scope: "${scope}"\` when a task may depend on them`,
    )} Do not assume their contents without reading the relevant file.\n\n${lines.join("\n")}\n</workspace-resources>`;
  } catch {
    return null;
  }
}

/**
 * Wraps a core CLI script (that writes to console.log) as a ActionEntry
 * by capturing stdout. Uses an AsyncLocalStorage-backed capture so
 * concurrent tool calls do not corrupt the global console/stdout pointers
 * (see `cli-capture.ts`).
 */
function wrapCliScript(
  tool: ActionTool,
  cliDefault: (args: string[]) => Promise<void>,
  opts?: { readOnly?: boolean },
): ActionEntry {
  return {
    tool,
    ...(opts?.readOnly ? { readOnly: true as const } : {}),
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        const raw = v as unknown;
        const value =
          raw != null && typeof raw === "object"
            ? JSON.stringify(raw)
            : String(raw);
        cliArgs.push(`--${k}`, value);
      }
      return captureCliOutput(() => cliDefault(cliArgs));
    },
  };
}

function filterReadOnlyActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => entry.readOnly === true),
  );
}

/** Drop actions that opted out of agent exposure via `agentTool: false`. They
 *  remain callable from the frontend / HTTP (mounted separately from this
 *  agent tool surface — see `httpActions`) but never appear in any agent tool
 *  list (in-app assistant, MCP, A2A, job/trigger runners) or actions prompt.
 *  Default-allow: only an explicit `false` is excluded. */
function filterAgentTools(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => entry.agentTool !== false),
  );
}

function filterPublicAgentActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).filter(([, entry]) => {
      const config = entry.publicAgent;
      return (
        config?.expose === true &&
        config.readOnly === true &&
        config.requiresAuth !== true &&
        config.isConsequential !== true
      );
    }),
  );
}

export function buildPublicAgentA2ASkills(
  actions: Record<string, ActionEntry>,
): Array<{
  id: string;
  name: string;
  description: string;
  publicAgent: ActionEntry["publicAgent"];
}> {
  return Object.entries(filterPublicAgentActions(actions)).map(
    ([name, entry]) => ({
      id: name,
      name,
      description: entry.tool.description,
      publicAgent: entry.publicAgent,
    }),
  );
}

function resolveArtifactBaseUrl(event: any | undefined): string | undefined {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return withConfiguredAppBasePath(String(fromEnv));

  try {
    const proto = getHeader(event, "x-forwarded-proto") || "https";
    const host = getHeader(event, "host");
    if (host) return withConfiguredAppBasePath(`${proto}://${host}`);
  } catch {}

  return undefined;
}

export function assembleA2AFinalResponse(
  events: readonly AgentChatEvent[],
  toolResults: readonly A2AToolResultSummary[],
  options: A2AArtifactResponseOptions & { event?: any } = {},
): { responseText: string; finalText: string } {
  const responseText = collectFinalResponseTextFromAgentEvents(events);
  const finalText = appendA2AArtifactLinks(responseText, [...toolResults], {
    baseUrl: options.baseUrl ?? resolveArtifactBaseUrl(options.event),
    includeReferencedArtifacts: true,
  });
  return { responseText, finalText };
}

/**
 * Creates the `get-framework-context` tool. Returns detailed instructions
 * for framework capabilities that are summarized in the compact prompt.
 * The agent calls this on-demand when it needs specifics about embeds,
 * agent teams, recurring jobs, etc.
 */
function createFrameworkContextEntry(): Record<string, ActionEntry> {
  const topicList = Object.keys(FRAMEWORK_CONTEXT_SECTIONS).join(", ");
  return {
    "get-framework-context": {
      tool: {
        description: `Read detailed framework instructions for a specific capability. Available topics: ${topicList}. Call with topic="all" to get everything.`,
        parameters: {
          type: "object" as const,
          properties: {
            topic: {
              type: "string",
              description: `Topic to read. One of: ${topicList}, or "all" for everything.`,
            },
          },
          required: ["topic"],
        },
      },
      run: async (args: Record<string, string>) => {
        const topic = String(args.topic ?? "all").toLowerCase();
        if (topic === "all") {
          return Object.values(FRAMEWORK_CONTEXT_SECTIONS).join("\n\n");
        }
        const section = FRAMEWORK_CONTEXT_SECTIONS[topic];
        if (!section) {
          return `Unknown topic "${topic}". Available: ${topicList}`;
        }
        return section;
      },
      readOnly: true,
    },
  };
}

/**
 * Creates the `refresh-screen` tool. Writes a bump to `application_state`
 * under a well-known key; the client's `useDbSync` watches for this and
 * invalidates react-query caches so the on-screen UI re-fetches its data
 * without a full page reload.
 *
 * This is the standard way for the agent to say "the data on the screen
 * just changed, please refresh it" — e.g. after editing a dashboard config,
 * updating a form schema, or mutating a row that the current view renders.
 */
function createRefreshScreenEntry(): Record<string, ActionEntry> {
  return {
    "refresh-screen": {
      // Writes __screen_refresh__ to application_state, which emits its own
      // distinct `screen-refresh` poll event. Don't double-emit a generic
      // `action` event on top of that.
      readOnly: true,
      tool: {
        description:
          "Manually refresh the user's current screen. The framework ALREADY auto-refreshes after any successful mutating action tool call (template actions, db-exec, db-patch) — you do NOT need to call this after a normal action. Use it only when (a) you mutated data via a path the framework can't detect (e.g. a direct write to an external system the app mirrors), or (b) you want to pass a `scope` hint so the UI narrows which queries to refetch. The UI re-fetches its queries without a full page reload.",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description:
                "Optional hint describing what changed (e.g. 'dashboard', 'form', 'settings'). Templates may use it to narrow which queries to invalidate; if omitted, all queries are invalidated.",
            },
          },
        },
      },
      run: async (args) => {
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        const nonce = Date.now();
        const scope = typeof args?.scope === "string" ? args.scope : undefined;
        await writeAppState(SCREEN_REFRESH_KEY, {
          nonce,
          ...(scope ? { scope } : {}),
        });
        return `refreshed${scope ? ` (scope: ${scope})` : ""}`;
      },
    },
  };
}

/** Well-known application-state key used by the refresh-screen tool. */
const SCREEN_REFRESH_KEY = "__screen_refresh__";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function appStateKeyForBrowserTab(key: string, browserTabId: unknown): string {
  if (typeof browserTabId !== "string") return key;
  const trimmed = browserTabId.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? `${key}:${trimmed}` : key;
}

/**
 * In-memory rate-limit tracker for `/generate-title`. Keyed by user email,
 * value is recent invocation timestamps within the rolling window. Stale
 * entries are pruned on read.
 */
const generateTitleRateLimit = new Map<string, number[]>();

/**
 * Creates the `set-search-params` / `set-url-path` tools. Writes a one-shot
 * URL command to application_state; the client's URLSync component applies
 * it via react-router (no full page reload) and then deletes the command.
 *
 * This is how the agent edits URL state — filter query params, route
 * changes, hash — without needing a per-template navigate action. The
 * current URL is visible to the agent via the auto-injected `<current-url>`
 * block, which includes parsed search params.
 */
function createUrlTools(): Record<string, ActionEntry> {
  return {
    "set-search-params": {
      // Writes __set_url__ to application_state, which the app-state watcher
      // already surfaces as a poll event. No need to double-emit.
      readOnly: true,
      tool: {
        description:
          "Update the URL query string on the user's current page. Use this to change dashboard/list filters, search terms, or any other state the app stores in `?foo=bar` style query params. One-shot — the UI applies it in ~1s without a page reload. See the current URL + parsed search params in the auto-injected `<current-url>` block. Keys are the exact query param names as they appear in the URL (e.g. `f_pubDateStart`, not just `pubDateStart`). Set a value to null or empty string to clear that param. By default merges over existing params — pass `merge: false` to replace them all.",
        parameters: {
          type: "object",
          properties: {
            params: {
              type: "object",
              description:
                'Map of query param → value. Each value is a string, or null/"" to clear. Example: {"f_pubDateStart": null, "f_cadence": "MONTH"}.',
            },
            merge: {
              type: "string",
              description:
                '"true" (default) merges over existing params; "false" replaces them entirely.',
              enum: ["true", "false"],
            },
          },
          required: ["params"],
        },
      },
      run: async (args) => {
        const params = (args?.params ?? {}) as unknown as Record<
          string,
          string | null
        >;
        const merge = (args as any)?.merge !== "false";
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "__set_url__",
            getRequestRunContext()?.browserTabId,
          ),
          {
            searchParams: params,
            mergeSearchParams: merge,
            // Unique-per-write token. The client's URLSync hook dedups by this
            // so a fire-and-forget DELETE that loses its race against the next
            // polling refetch can't cause the same URL command to be applied
            // repeatedly (which caused the editor to bounce between slides
            // when an agent turn errored partway through).
            _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
        );
        const keys = Object.keys(params);
        return `set-search-params: ${keys.length} key${keys.length === 1 ? "" : "s"}${merge ? "" : " (replace)"}`;
      },
    },
    "set-url-path": {
      // Same as set-search-params — writes application_state, already emits
      // via the app-state watcher.
      readOnly: true,
      tool: {
        description:
          "Navigate the user to a different pathname, optionally also setting search params. For most template-specific routing prefer the template's `navigate` action if it exists — this is the generic fallback. One-shot, applied by the client without a page reload.",
        parameters: {
          type: "object",
          properties: {
            pathname: {
              type: "string",
              description: "New URL pathname (e.g. '/adhoc/weekly').",
            },
            params: {
              type: "object",
              description:
                'Optional query params to set alongside the path change. String values set, null/"" clears.',
            },
            merge: {
              type: "string",
              description:
                '"true" (default) merges over existing params; "false" starts fresh.',
              enum: ["true", "false"],
            },
          },
          required: ["pathname"],
        },
      },
      run: async (args) => {
        const pathname = String(args?.pathname ?? "");
        if (!pathname.startsWith("/")) {
          return "Error: pathname must start with '/'.";
        }
        const params = (args?.params ?? {}) as unknown as Record<
          string,
          string | null
        >;
        const merge = (args as any)?.merge !== "false";
        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "__set_url__",
            getRequestRunContext()?.browserTabId,
          ),
          {
            pathname,
            searchParams: params,
            mergeSearchParams: merge,
            // See note in set-search-params: unique-per-write dedup token so a
            // race between GET and consume-DELETE in URLSync can't re-apply
            // this command.
            _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
        );
        return `set-url-path: ${pathname}`;
      },
    },
    "ask-question": {
      tool: {
        description:
          "Ask the user a multiple-choice clarifying question and render it inline in the chat. Use this ONLY when you are genuinely blocked on a decision you cannot resolve from context and a wrong guess would be costly — an ambiguous metric, date range, or grain; a real fork in approach. Present 2-5 concrete options and mark the most likely one recommended. Do NOT use it for confirmations, for things the user already specified, or to dodge easy work you could just do. Ask at most once per turn. Calling this yields the turn: stop and wait for the user's answer.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "The complete question to ask the user. Clear, specific, ends with a question mark.",
            },
            header: {
              type: "string",
              description:
                'Optional very short label (max ~12 chars) shown as a chip/heading above the question, e.g. "Date range", "Approach", "Library".',
            },
            options: {
              type: "string",
              description:
                'A JSON array of 2-4 distinct, mutually-exclusive options (unless `allowMultiple` is true), each `{ "label": string, "value"?: string, "description"?: string, "preview"?: string, "recommended"?: boolean }`. `label` is 1-5 words; `description` explains the trade-off; `preview` is optional content (mockup, code snippet, short comparison) rendered under the option. `value` defaults to `label` when omitted. Mark the most likely option `"recommended": true`. Do NOT add an "Other" option — free text is provided automatically when `allowFreeText` is on.',
            },
            allowFreeText: {
              type: "string",
              description:
                'Whether the user may also type a free-text "Other" answer. "true" (default) or "false".',
              enum: ["true", "false"],
            },
            allowMultiple: {
              type: "string",
              description:
                'Whether the user may select more than one option (multi-select). "true" or "false" (default).',
              enum: ["true", "false"],
            },
          },
          required: ["question", "options"],
        },
      },
      run: async (args) => {
        const question = String(args?.question ?? "").trim();
        if (!question) return "Error: 'question' is required.";
        const header = String(args?.header ?? "").trim();
        const allowMultiple = String(args?.allowMultiple ?? "") === "true";
        const allowFreeText = String(args?.allowFreeText ?? "true") !== "false";

        let parsedOptions: unknown;
        try {
          parsedOptions = JSON.parse(String(args?.options ?? "[]"));
        } catch {
          return "Error: 'options' must be a JSON array of { label, value?, description?, recommended? }.";
        }
        if (!Array.isArray(parsedOptions) || parsedOptions.length === 0) {
          return "Error: 'options' must be a non-empty JSON array of { label, value?, description?, recommended? }.";
        }

        type AskOption = {
          label: string;
          value: string;
          description?: string;
          preview?: string;
          recommended?: boolean;
        };
        const options = parsedOptions
          .map((raw): AskOption | null => {
            const opt = (raw ?? {}) as Record<string, unknown>;
            const label =
              typeof opt.label === "string" && opt.label.trim()
                ? opt.label.trim()
                : typeof opt.value === "string"
                  ? String(opt.value).trim()
                  : "";
            if (!label) return null;
            const value =
              typeof opt.value === "string" && opt.value.trim()
                ? opt.value.trim()
                : label;
            const option: AskOption = { label, value };
            if (typeof opt.description === "string" && opt.description.trim()) {
              option.description = opt.description.trim();
            }
            if (typeof opt.preview === "string" && opt.preview.trim()) {
              option.preview = opt.preview;
            }
            if (opt.recommended === true) option.recommended = true;
            return option;
          })
          .filter((opt): opt is AskOption => opt !== null);
        if (options.length === 0) {
          return "Error: 'options' must contain at least one option with a label.";
        }

        // Shape must match the GuidedQuestionFlow renderer in
        // client/guided-questions.tsx: a `text-options` question whose options
        // carry `value`, with `multiSelect` for multi-pick and `allowOther` for
        // free text. The renderer otherwise injects "Explore"/"Decide" options,
        // which would be noise for a focused clarifying question, so disable them.
        const payload = {
          questions: [
            {
              id: "q1",
              type: "text-options" as const,
              question,
              ...(header ? { header } : {}),
              required: !allowFreeText,
              multiSelect: allowMultiple,
              allowOther: allowFreeText,
              includeExplore: false,
              includeDecide: false,
              options,
            },
          ],
        };

        const { writeAppState } =
          await import("../application-state/script-helpers.js");
        await writeAppState(
          appStateKeyForBrowserTab(
            "guided-questions",
            getRequestRunContext()?.browserTabId,
          ),
          payload,
        );
        return "Asked the user a clarifying question and rendered it in the chat. Stop here and wait for their answer — do not proceed or assume an answer.";
      },
    },
  };
}

/**
 * Creates db-* tools (db-query, db-exec, db-patch, db-schema) as native tools.
 * These let the agent read and write the app's own SQL database. Scoping to
 * the current user/org is enforced automatically in production via temp views.
 *
 * In dev mode template actions are invoked via bash and the agent can call
 * `pnpm action db-query ...` — but in production there is no bash, so these
 * must be registered as native tools for the agent to reach the app DB at all.
 */
async function createDbScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const [schemaMod, queryMod, execMod, patchMod] = await Promise.all([
      import("../scripts/db/schema.js"),
      import("../scripts/db/query.js"),
      import("../scripts/db/exec.js"),
      import("../scripts/db/patch.js"),
    ]);

    return {
      "db-schema": wrapCliScript(
        {
          description:
            "Show the app's SQL schema — all tables, columns, types, indexes, and foreign keys. Use this to understand the data model before querying.",
          parameters: {
            type: "object",
            properties: {
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        schemaMod.default,
        { readOnly: true },
      ),
      "db-query": wrapCliScript(
        {
          description:
            "Read from the app's own SQL database ONLY. Runs a SELECT against the app's internal tables (settings, application_state, template tables). Results are auto-scoped to the current user/org. IMPORTANT: This tool CANNOT access external data sources like data warehouses, CRMs, issue trackers, analytics platforms, calendars, mail, docs, or other third-party services. For those, use the relevant template/provider action, MCP connector, or provider-api-catalog/provider-api-docs/provider-api-request when available. If the user names a provider, that named provider wins; do not substitute a warehouse or app database copy unless they explicitly ask for it. If a table isn't in the app schema, don't try db-query — use the data-source-specific action. For extension management, use list-extensions, update-extension, hide-extension, or delete-extension instead of querying the legacy tools table.",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "SELECT query to run, e.g. \"SELECT key, value FROM settings WHERE key LIKE 'sql-dashboard-%'\"",
              },
              args: {
                type: "string",
                description:
                  'Optional JSON array of positional bind args for parameterized placeholders. Example: \'["draft","form-123"]\'',
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
              limit: {
                type: "string",
                description:
                  "Append LIMIT N if the query doesn't already have one",
              },
            },
            required: ["sql"],
          },
        },
        queryMod.default,
        { readOnly: true },
      ),
      "db-exec": wrapCliScript(
        {
          description:
            "Write to the app's own SQL database ONLY. Runs INSERT / UPDATE / DELETE / REPLACE against the app's internal tables. For multiple related writes, pass `statements` so they run sequentially in one transaction instead of issuing several db-exec calls. Writes are auto-scoped to the current user/org, and `owner_email` / `org_id` are auto-injected on INSERT. Schema changes (CREATE/ALTER/DROP) are blocked. Never use this to backfill missing data for a read/analysis request or to create/modify users, members, roles, permissions, admin flags, or ownership; use a dedicated app action or reviewed code. IMPORTANT: This tool CANNOT write to external data sources like BigQuery, HubSpot, etc. For external services, use the appropriate template action.",
          parameters: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "Single INSERT / UPDATE / DELETE / REPLACE statement. Use parameterized placeholders (?) where possible.",
              },
              args: {
                type: "string",
                description:
                  'Optional JSON array of positional bind args for `sql`. Example: \'["published","form-123"]\'',
              },
              statements: {
                type: "string",
                description:
                  'Optional JSON array of write statements to execute in one transaction. Prefer this over multiple db-exec calls. Example: \'[{"sql":"INSERT INTO notes (id,title) VALUES (?,?)","args":["n1","One"]},{"sql":"UPDATE counters SET value = value + 1 WHERE key = ?","args":["notes"]}]\'',
              },
              format: {
                type: "string",
                description: 'Output format: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
            },
          },
        },
        execMod.default,
      ),
      "db-patch": wrapCliScript(
        {
          description:
            "Surgical patch on a large text/JSON column in the app's SQL database. Two modes: (1) text find/replace via `find`/`replace`/`edits` — best for small edits to documents, slide HTML, etc. (2) structural JSON ops via `json-ops` — STRONGLY PREFERRED when the column is JSON (dashboard configs, form schemas, slide decks) because it avoids all the brace/quote/comma surgery that text find/replace requires. Use `json-ops` to set/remove values at a JSON Pointer path, or to move/insert array items — e.g. reorder dashboard panels, add a filter, rename a field. Targets exactly one row (narrow `where` by primary key). Same per-user/org scoping as db-exec.",
          parameters: {
            type: "object",
            properties: {
              table: {
                type: "string",
                description: "Table name (e.g. 'settings')",
              },
              column: {
                type: "string",
                description:
                  "Text/JSON column to patch (e.g. 'value' for settings)",
              },
              where: {
                type: "string",
                description:
                  "WHERE clause that matches exactly one row (e.g. \"key = 'o:org1:sql-dashboard-foo'\")",
              },
              find: {
                type: "string",
                description:
                  "Text mode: substring to find. Must match EXACTLY ONE occurrence by default (like Claude Code's Edit tool). If 0 matches, you get 'NOT FOUND'. If >1 matches, you get surrounding context for each match — widen `find` with unique context and retry. Use `all: \"true\"` to replace every occurrence.",
              },
              replace: {
                type: "string",
                description: "Text mode: replacement substring",
              },
              edits: {
                type: "string",
                description:
                  'Text mode batch: JSON array of {find, replace} pairs. Same uniqueness rule applies to each `find`. Example: \'[{"find":"a","replace":"b"}]\'',
              },
              "json-ops": {
                type: "string",
                description:
                  'JSON mode: JSON array of structural ops. Each op is {op, path, value?, from?}. `op` is one of "set", "remove", "insert", "move", "move-before". `path` / `from` use JSON Pointer ("/panels/3/title"). Examples — reorder: \'[{"op":"move","from":"/panels/7","path":"/panels/1"}]\'; edit field: \'[{"op":"set","path":"/panels/0/title","value":"New"}]\'; delete filter: \'[{"op":"remove","path":"/filters/2"}]\'; add panel: \'[{"op":"insert","path":"/panels/0","value":{"id":"p","title":"..."}}]\'. Much safer than text find/replace for JSON columns.',
              },
              all: {
                type: "string",
                description:
                  'Text mode: set to "true" to replace every occurrence of each `find` (default requires exactly one match)',
                enum: ["true"],
              },
            },
            required: ["table", "column", "where"],
          },
        },
        patchMod.default,
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Creates the docs-search tool so agents can look up framework documentation.
 * Docs are bundled in @agent-native/core and read via fs at runtime.
 */
async function createDocsScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const mod = await import("../scripts/docs/search.js");
    return {
      "docs-search": wrapCliScript(
        {
          description:
            "Search and read agent-native framework documentation, bundled AGENTS.md, and codebase skills. Use --list to see all pages, --query to search, --slug to read a specific page. Codebase skill pages use slugs like skill-<name>.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search term to find relevant docs (e.g. 'actions', 'authentication', 'database')",
              },
              slug: {
                type: "string",
                description:
                  "Read a specific doc page by slug (e.g. 'actions', 'authentication', 'database')",
              },
              list: {
                type: "string",
                description: 'Set to "true" to list all available doc pages',
                enum: ["true"],
              },
            },
          },
        },
        mod.default,
        { readOnly: true },
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Creates resource ScriptEntries available in both prod and dev modes.
 */
function shouldDefaultResourceWriteToWorkspace(path: string): boolean {
  const normalized = path.replace(/^\/+/, "");
  return (
    normalized === "AGENTS.md" ||
    normalized === "LEARNINGS.md" ||
    normalized.startsWith("memory/") ||
    normalized.startsWith("skills/") ||
    normalized.startsWith("jobs/") ||
    normalized.startsWith("agents/") ||
    normalized.startsWith("remote-agents/")
  );
}

async function createResourceScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const [list, read, effective, write, del, saveMem, delMem, store] =
      await Promise.all([
        import("../scripts/resources/list.js"),
        import("../scripts/resources/read.js"),
        import("../scripts/resources/effective.js"),
        import("../scripts/resources/write.js"),
        import("../scripts/resources/delete.js"),
        import("../scripts/resources/save-memory.js"),
        import("../scripts/resources/delete-memory.js"),
        import("../resources/store.js"),
      ]);

    // Wrap each CLI runner so it captures stdout and converts args properly
    const listEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      list.default,
      { readOnly: true },
    );
    const readEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      read.default,
      { readOnly: true },
    );
    const writeEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      write.default,
    );
    const effectiveEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      effective.default,
      { readOnly: true },
    );
    const deleteEntry = wrapCliScript(
      {
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      del.default,
    );

    return {
      resources: {
        tool: {
          description:
            'Manage workspace resources. Actions: "list" (browse visible files), "read" (get contents), "effective" (show workspace -> organization/app -> personal inheritance for a path), "write" (create/update personal or shared; workspace only for local file mode control files), "promote" (make agent scratch visible), "delete" (remove personal or shared; workspace only for local file mode control files). Agent scratch writes are hidden from the Workspace view by default; use visibility="workspace" only for files the user explicitly wants to keep/manage.',
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: [
                  "list",
                  "read",
                  "effective",
                  "write",
                  "promote",
                  "delete",
                ],
              },
              path: {
                type: "string",
                description:
                  "Resource path (e.g. 'LEARNINGS.md', 'notes/ideas.md'). Required for read/write/delete.",
              },
              content: {
                type: "string",
                description: "Content to write. Required for write.",
              },
              scope: {
                type: "string",
                description:
                  "personal, shared, workspace, or all (default varies by action). Workspace is read-only when inherited from Dispatch; in local file mode AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, and skills/ are writable.",
                enum: ["personal", "shared", "workspace", "all"],
              },
              prefix: {
                type: "string",
                description:
                  "Filter by path prefix when listing (e.g. 'notes/')",
              },
              mime: {
                type: "string",
                description:
                  "MIME type for write (default: inferred from extension)",
              },
              format: {
                type: "string",
                description:
                  'Output format for list: "json" or "text" (default: text)',
                enum: ["json", "text"],
              },
              visibility: {
                type: "string",
                description:
                  'Visibility for write: "agent_scratch" for internal working files, "workspace" for user-requested files. Defaults to agent_scratch except durable instruction/skill/job/memory paths.',
                enum: ["workspace", "agent_scratch"],
              },
              includeAgentScratch: {
                type: "boolean",
                description: "Include hidden agent scratch files when listing.",
              },
            },
            required: ["action"],
          },
        },
        run: async (args: Record<string, string>) => {
          const { action: a, ...rest } = args;
          if (a === "list") return listEntry.run(rest);
          if (a === "read") {
            if (!rest.path) return "Error: path is required for read";
            return readEntry.run(rest);
          }
          if (a === "effective") {
            if (!rest.path) return "Error: path is required for effective";
            return effectiveEntry.run(rest);
          }
          if (a === "write") {
            if (
              !rest.path ||
              rest.content === undefined ||
              rest.content === null
            )
              return "Error: path and content are required for write";
            rest.createdBy = "agent";
            rest.visibility =
              rest.visibility ??
              (shouldDefaultResourceWriteToWorkspace(String(rest.path))
                ? "workspace"
                : "agent_scratch");
            const runCtx = getRequestRunContext();
            if (runCtx?.threadId) rest.threadId = runCtx.threadId;
            return writeEntry.run(rest);
          }
          if (a === "promote") {
            if (!rest.path) return "Error: path is required for promote";
            const scope = rest.scope ?? "personal";
            if (scope === "workspace" || scope === "all") {
              return "Error: promote supports personal or shared scope only";
            }
            const owner =
              scope === "shared"
                ? store.SHARED_OWNER
                : (getRequestRunContext()?.owner ??
                  getRequestUserEmail() ??
                  process.env.AGENT_USER_EMAIL);
            if (!owner) {
              return "Error: promote requires an authenticated user";
            }
            const resource = await store.resourceGetByPath(
              owner,
              String(rest.path),
            );
            if (!resource) {
              return `Resource not found: ${rest.path}`;
            }
            const promoted = await store.resourcePut(
              owner,
              resource.path,
              resource.content,
              resource.mimeType,
              {
                createdBy: resource.createdBy,
                visibility: "workspace",
                threadId: resource.threadId,
                runId: resource.runId,
                expiresAt: null,
                metadata: resource.metadata,
              },
            );
            return `Promoted resource: ${promoted.path}`;
          }
          if (a === "delete") {
            if (!rest.path) return "Error: path is required for delete";
            return deleteEntry.run(rest);
          }
          return `Error: unknown action "${a}". Use: list, read, write, promote, delete`;
        },
      },
      "save-memory": wrapCliScript(
        {
          description:
            "Save a memory for future conversations. Creates or updates a memory file and its index entry. Use proactively when you learn preferences, corrections, project context, or references.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Short kebab-case identifier (e.g. 'coding-style', 'deploy-process'). Used as the filename.",
              },
              type: {
                type: "string",
                description: "Memory category",
                enum: ["user", "feedback", "project", "reference"],
              },
              description: {
                type: "string",
                description:
                  "One-line summary shown in the memory index (keep under 80 chars)",
              },
              content: {
                type: "string",
                description:
                  "The memory content in markdown. For updates, read first and provide full updated content.",
              },
            },
            required: ["name", "type", "description", "content"],
          },
        },
        saveMem.default,
      ),
      "delete-memory": wrapCliScript(
        {
          description:
            "Delete a memory entry and remove it from the memory index.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The memory name to delete (e.g. 'coding-style')",
              },
            },
            required: ["name"],
          },
        },
        delMem.default,
      ),
    };
  } catch {
    // Resources not available — skip silently
    return {};
  }
}

/**
 * Creates a unified chat-history ActionEntry that dispatches to search, open,
 * rename, or lightweight organization actions.
 */
async function createChatScriptEntries(): Promise<Record<string, ActionEntry>> {
  try {
    const [searchMod, openMod] = await Promise.all([
      import("../scripts/chat/search-chats.js"),
      import("../scripts/chat/open-chat.js"),
    ]);

    const searchEntry = wrapCliScript(
      {
        description: "Search or list past agent chat threads.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search term to find chats by title, preview, or content",
            },
            limit: {
              type: "string",
              description: "Max number of results (default: 20)",
            },
            format: {
              type: "string",
              description: "Output format",
              enum: ["json", "text"],
            },
          },
        },
      },
      searchMod.default,
    );

    const openEntry = wrapCliScript(
      {
        description: "Open a chat thread in the UI.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The chat thread ID to open",
            },
          },
          required: ["id"],
        },
      },
      openMod.default,
    );

    return {
      "chat-history": {
        tool: {
          description:
            "Manage past agent chat threads. Use action 'search' to find previous conversations by keyword, 'open' to open a thread in the UI, or 'rename'/'pin'/'unpin'/'archive' to organize history.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The operation to perform",
                enum: ["search", "open", "rename", "pin", "unpin", "archive"],
              },
              query: {
                type: "string",
                description:
                  "(search) Search term to find chats by title, preview, or content",
              },
              limit: {
                type: "string",
                description: "(search) Max number of results (default: 20)",
              },
              format: {
                type: "string",
                description: "(search) Output format",
                enum: ["json", "text"],
              },
              id: {
                type: "string",
                description:
                  "(open, rename, pin, unpin, archive) The chat thread ID to manage",
              },
              title: {
                type: "string",
                description: "(rename) New chat title",
              },
            },
            required: ["action"],
          },
        },
        run: async (args) => {
          if (args?.action === "open") {
            return openEntry.run(args);
          }
          if (
            args?.action === "rename" ||
            args?.action === "pin" ||
            args?.action === "unpin" ||
            args?.action === "archive"
          ) {
            const id = typeof args?.id === "string" ? args.id : "";
            if (!id) return "Missing required id.";
            const owner =
              getRequestRunContext()?.owner ?? getRequestUserEmail() ?? "";
            if (!owner) return "No authenticated user is available.";
            const thread = await getThread(id);
            if (!thread || thread.ownerEmail !== owner) {
              return `Chat thread "${id}" not found.`;
            }
            const title = thread.title || thread.preview || "(untitled)";
            if (args.action === "rename") {
              const nextTitle =
                typeof args?.title === "string"
                  ? args.title.replace(/\s+/g, " ").trim().slice(0, 160)
                  : "";
              if (!nextTitle) return "Missing required title.";
              const renamed = await renameThread(id, nextTitle, {
                ownerEmail: owner,
              });
              if (!renamed) return `Chat thread "${id}" could not be renamed.`;
              return `Renamed chat "${title}" to "${nextTitle}".`;
            }
            if (args.action === "archive") {
              const archived = await setThreadArchived(id, true, {
                ownerEmail: owner,
              });
              if (!archived)
                return `Chat thread "${id}" could not be archived.`;
              return `Archived chat: ${title}`;
            }
            const pinned = await setThreadPinned(id, args.action === "pin", {
              ownerEmail: owner,
            });
            if (!pinned) return `Chat thread "${id}" could not be updated.`;
            return `${args.action === "pin" ? "Pinned" : "Unpinned"} chat: ${title}`;
          }
          return searchEntry.run(args);
        },
      },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the consolidated manage-agent-engine tool (list / set / test).
 * Let the agent inspect and configure the active LLM engine.
 */
async function createAgentEngineScriptEntries(
  appId?: string,
): Promise<Record<string, ActionEntry>> {
  try {
    const mod = await import("../scripts/agent-engines/manage-agent-engine.js");

    return {
      "manage-agent-engine": {
        tool: mod.tool,
        run: (args) =>
          mod.run({
            ...args,
            appId:
              typeof args.appId === "string" && args.appId.trim()
                ? args.appId
                : (appId ?? ""),
          }),
      },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the manage-agent-loop-settings tool. Lets the agent inspect and
 * configure the loop step limit it may hit on long-running work.
 */
async function createAgentLoopSettingsScriptEntries(): Promise<
  Record<string, ActionEntry>
> {
  try {
    const mod = await import("../scripts/manage-agent-loop-settings.js");

    return {
      "manage-agent-loop-settings": { tool: mod.tool, run: mod.run },
    };
  } catch {
    return {};
  }
}

/**
 * Creates the call-agent ActionEntry for cross-agent A2A communication.
 * Binds selfAppId so the agent cannot call itself via call-agent.
 */
async function createCallAgentScriptEntry(
  selfAppId?: string,
): Promise<Record<string, ActionEntry>> {
  try {
    const mod = await import("../scripts/call-agent.js");
    return {
      "call-agent": {
        tool: mod.tool,
        run: (args, context) => mod.run(args, context, selfAppId),
      },
    };
  } catch {
    return {};
  }
}

function createBuilderBrowserTool(deps: {
  getOrigin: () => string;
  getOwner?: () => string | null | undefined;
}): Record<string, ActionEntry> {
  const setBuiltinForCurrentUser = async (
    id: BuiltinMcpCapabilityId,
    enabled: boolean,
  ) => {
    const email = getRequestUserEmail();
    if (!email) {
      return {
        ok: false,
        error: "not-signed-in",
        message: "You must be signed in to change built-in MCP tools.",
      };
    }
    const enabledIds = await setBuiltinMcpCapabilityEnabled(
      "user",
      email,
      id,
      enabled,
    );
    const manager = getGlobalMcpManager();
    if (manager) {
      await manager.reconfigure(await buildMergedConfig());
    }
    return { ok: true, enabledIds: enabledIds ?? [] };
  };

  const entries: Record<string, ActionEntry> = {
    "connect-builder": {
      tool: {
        description:
          "Render a Builder.io card inline in the chat. Call this as the first step (no code exploration or planning needed) when the user asks to modify the APP'S OWN SOURCE CODE: add a feature, change the UI chrome, edit a React component, add a route, add an integration, fix a bug in the app itself, or anything else that requires source-file edits while in hosted/production mode. Do NOT call this for creating or editing extensions/widgets/dashboards/calculators/mini-apps; those are sandboxed extension data and must use create-extension/update-extension instead. Do NOT call this for content the app is meant to produce — creating a video, generating a design, drafting an email, building a slide deck, making a dashboard, etc. — those run through the app's own domain actions, not Builder. Do NOT mention 'click Send to Builder' in your response unless this card is already in the conversation. If Builder is connected and Builder Cloud Agents are available, the card shows a 'Send to Builder' button that hands the work off to Builder's cloud agent and returns a branch URL. If `builderEnabled` is false, the card shows a waitlist/local-dev fallback instead; never tell the user to enable Builder Cloud Agents in Builder org settings or beta settings, and do not claim the Builder card has everything, is pre-loaded for handoff, or can run the cloud agent. When you call this for a code-change request, pass the user's request verbatim as the `prompt` arg so the card can forward it to Builder unchanged when cloud agents are available.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The user's feature / change request, verbatim. Forwarded to Builder's cloud agent when the user clicks Send. Omit only for generic 'connect Builder' requests that aren't tied to a specific code change.",
            },
          },
        },
      },
      run: async (args) => {
        const { getBuilderCredentialAuthFailure, resolveBuilderCredentials } =
          await import("./credential-provider.js");
        const creds = await resolveBuilderCredentials();
        const authFailure = await getBuilderCredentialAuthFailure(creds);
        const configured = !!(
          creds.privateKey &&
          creds.publicKey &&
          !authFailure
        );
        const branchProjectId = await resolveBuilderBranchProjectId();
        const prompt = typeof args?.prompt === "string" ? args.prompt : "";
        const origin = deps.getOrigin();
        const ownerEmail = deps.getOwner?.() ?? getRequestUserEmail();
        return JSON.stringify({
          kind: "connect-builder-card",
          configured,
          builderEnabled: !!branchProjectId,
          connectUrl: getBuilderBrowserConnectUrlForOwner(origin, ownerEmail),
          orgName: creds.orgName || null,
          prompt,
        });
      },
    },
    "set-browser-control": {
      tool: {
        description:
          "Enable or disable built-in browser-control MCP tools for the current user. Call this when the user asks to test, screenshot, inspect, or interact with a web page and browser tools are not available; confirm once before enabling. Prefer the chrome-devtools backend for live logged-in Chrome, and use playwright when an isolated browser is better.",
        parameters: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether browser-control tools should be enabled.",
            },
            backend: {
              type: "string",
              enum: ["chrome-devtools", "playwright"],
              description:
                "Browser backend to enable. Defaults to chrome-devtools.",
            },
          },
          required: ["enabled"],
        },
      },
      run: async (args) => {
        const parsed =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const enabled = parsed.enabled !== false;
        const requestedBackend =
          typeof parsed.backend === "string" ? parsed.backend : undefined;
        const backend =
          requestedBackend === "playwright" ? "playwright" : "chrome-devtools";
        const targetId: BuiltinMcpCapabilityId =
          backend === "playwright"
            ? "browser-playwright"
            : "browser-chrome-devtools";

        if (!enabled) {
          const chrome = await setBuiltinForCurrentUser(
            "browser-chrome-devtools",
            false,
          );
          if (!chrome.ok) return JSON.stringify(chrome);
          const playwright = await setBuiltinForCurrentUser(
            "browser-playwright",
            false,
          );
          return JSON.stringify({
            ...playwright,
            enabled: false,
            message: "Browser-control MCP tools are disabled.",
          });
        }

        const result = await setBuiltinForCurrentUser(targetId, true);
        return JSON.stringify({
          ...result,
          enabled: true,
          backend,
          message:
            backend === "chrome-devtools"
              ? "Chrome DevTools MCP is enabled. Browser tools will be available on the next action when Chrome remote debugging is available."
              : "Playwright MCP is enabled. Browser tools will be available on the next action in an isolated Playwright browser.",
        });
      },
    },
    "set-computer-use": {
      tool: {
        description:
          "Enable or disable built-in Computer Use MCP tools for the current user. Call only after the user explicitly asks to let the agent control local desktop apps. macOS may require Screen Recording and Accessibility permissions.",
        parameters: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether Computer Use tools should be enabled.",
            },
          },
          required: ["enabled"],
        },
      },
      run: async (args) => {
        const parsed =
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {};
        const enabled = parsed.enabled !== false;
        if (enabled && process.platform !== "darwin") {
          return JSON.stringify({
            ok: false,
            error: "unsupported-platform",
            message: "Computer Use is currently available only on macOS.",
          });
        }
        const result = await setBuiltinForCurrentUser("computer-use", enabled);
        return JSON.stringify({
          ...result,
          enabled,
          message: enabled
            ? "Computer Use MCP is enabled. If macOS prompts, grant Screen Recording and Accessibility permission in System Settings > Privacy & Security."
            : "Computer Use MCP is disabled.",
        });
      },
    },
    "activate-browser": {
      tool: {
        description:
          "Activate browser automation tools. Call this when you need to interact with a real browser — e.g. to extract design tokens from a rendered page, take screenshots, read computed styles from JS-heavy sites, or test a live URL. After activation, chrome-devtools MCP tools (navigate, click, evaluate_script, take_screenshot, etc.) become available on your next action. Requires Builder.io connection.",
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description:
                "Optional session identifier for the browser connection. Auto-generated if omitted.",
            },
          },
        },
      },
      run: async (args) => {
        const { resolveBuilderCredentials } =
          await import("./credential-provider.js");
        const creds = await resolveBuilderCredentials();
        if (!creds.privateKey || !creds.publicKey) {
          return JSON.stringify({
            error: "builder-not-connected",
            message:
              "Builder.io is not connected. Call `connect-builder` first to enable browser automation.",
          });
        }

        const { requestBuilderBrowserConnection } =
          await import("./builder-browser.js");
        const sessionId =
          (typeof args?.sessionId === "string" && args.sessionId) ||
          `an-browser-${Date.now()}`;

        let connection: Record<string, unknown>;
        try {
          connection = await requestBuilderBrowserConnection({ sessionId });
        } catch (err: any) {
          return JSON.stringify({
            error: "browser-connection-failed",
            message: `Failed to get browser connection: ${err?.message ?? err}`,
          });
        }

        const wsUrl = connection.wsUrl as string;
        if (!wsUrl) {
          return JSON.stringify({
            error: "no-ws-url",
            message: "Browser connection did not return a WebSocket URL.",
          });
        }

        const manager = getGlobalMcpManager();
        if (!manager) {
          return JSON.stringify({
            error: "no-mcp-manager",
            message: "MCP manager is not available.",
          });
        }

        // Add chrome-devtools-mcp server pointing at the provisioned browser
        const currentConfig = manager.getConfig();
        const servers = { ...(currentConfig?.servers ?? {}) };
        servers["chrome-devtools"] = {
          command: "npx",
          args: [
            "-y",
            "chrome-devtools-mcp@0.26.0",
            "--wsEndpoint",
            wsUrl,
            "--categoryEmulation=false",
          ],
          type: "stdio",
        } as any;

        await manager.reconfigure({
          servers,
          source: currentConfig?.source ?? "runtime",
        });

        return JSON.stringify({
          success: true,
          message:
            "Browser activated. Chrome DevTools MCP tools (mcp__chrome-devtools__*) are now available. Use them on your next action to navigate pages, read DOM, take screenshots, evaluate JavaScript, etc.",
          wsUrl,
          sessionId,
        });
      },
    },
  };

  if (!areBuiltinMcpCapabilitiesSupported()) {
    delete entries["set-browser-control"];
    delete entries["set-computer-use"];
  }

  return entries;
}

/**
 * Creates the unified `agent-teams` tool that consolidates all sub-agent
 * orchestration behind a single tool with an `action` parameter.
 */
function createTeamTools(deps: {
  getOwner: () => string;
  getSystemPrompt: () => string;
  getActions: () => Record<string, ActionEntry>;
  getEngine: () => AgentEngine;
  getModel: () => string;
  getParentThreadId: () => string;
  getSend: () =>
    | ((event: import("../agent/types.js").AgentChatEvent) => void)
    | null;
}): Record<string, ActionEntry> {
  return {
    "agent-teams": {
      tool: {
        description:
          "Manage background sub-agent tasks. Use action 'spawn' to start a new sub-agent, 'status' to check progress, 'read-result' to get a finished task's output, 'send' to message a running sub-agent, or 'list' to see all tasks. A successful spawn only means the task started and is running; do not report it as finished until status/read-result shows a terminal status.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["spawn", "status", "read-result", "send", "list"],
              description: "The operation to perform",
            },
            task: {
              type: "string",
              description:
                "(spawn) Clear description of what the sub-agent should accomplish",
            },
            instructions: {
              type: "string",
              description:
                "(spawn) Optional additional instructions or context for the sub-agent",
            },
            name: {
              type: "string",
              description:
                "(spawn) Short name for the sub-agent tab (e.g. 'Research', 'Draft email'). If omitted, derived from the task.",
            },
            agent: {
              type: "string",
              description:
                "(spawn) Optional custom agent profile from agents/*.md to use for this task.",
            },
            taskId: {
              type: "string",
              description:
                "(status, read-result, send) The task ID returned by a previous spawn",
            },
            message: {
              type: "string",
              description: "(send) Message to send to the sub-agent",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, string>) => {
        const action = args.action;

        // ── spawn ──────────────────────────────────────────────
        if (action === "spawn") {
          if (!args.task) throw new Error("'task' is required for spawn");
          // Capture the send function NOW (at spawn time) so that
          // concurrent runs don't clobber each other's send reference.
          const capturedSend = deps.getSend();
          const { spawnTask } = await import("./agent-teams.js");
          // Filter out the team tool so sub-agents can't spawn sub-agents
          const subAgentActions = Object.fromEntries(
            Object.entries(deps.getActions()).filter(
              ([name]) => name !== "agent-teams",
            ),
          );
          let instructions = args.instructions;
          let selectedModel = deps.getModel();
          let selectedName = args.name || "";
          if (args.agent) {
            const { findAccessibleCustomAgent } =
              await import("../resources/agents.js");
            const profile = await findAccessibleCustomAgent(
              deps.getOwner(),
              args.agent,
            );
            if (!profile) {
              throw new Error(`Custom agent not found: ${args.agent}`);
            }
            const profileInstructions =
              `## Custom Agent Profile: ${profile.name}\n\n` +
              (profile.description ? `${profile.description}\n\n` : "") +
              profile.instructions;
            instructions = instructions
              ? `${profileInstructions}\n\n## Extra Task Context\n\n${instructions}`
              : profileInstructions;
            selectedModel = profile.model ?? selectedModel;
            selectedName = selectedName || profile.name;
          }
          const task = await spawnTask({
            description: args.task,
            instructions,
            ownerEmail: deps.getOwner(),
            systemPrompt: deps.getSystemPrompt(),
            actions: subAgentActions,
            engine: deps.getEngine(),
            model: selectedModel,
            name: selectedName || undefined,
            parentThreadId: deps.getParentThreadId(),
            parentSend: (event) => {
              if (capturedSend) capturedSend(event);
            },
          });
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            runId: task.runId,
            status: task.status,
            parentThreadId: task.parentThreadId,
            state: "launched_pending_completion",
            message:
              "Sub-agent launched and is still running. Use status or read-result later; do not describe this task as completed from the spawn response alone.",
            description: task.description,
            name: task.name ?? selectedName,
          });
        }

        // ── status ─────────────────────────────────────────────
        if (action === "status") {
          if (!args.taskId) throw new Error("'taskId' is required for status");
          const { getTask } = await import("./agent-teams.js");
          const task = await getTask(args.taskId);
          if (!task) return JSON.stringify({ error: "Task not found" });
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            parentThreadId: task.parentThreadId,
            status: task.status,
            description: task.description,
            name: task.name,
            preview: task.preview,
            currentStep: task.currentStep,
            summary: task.summary,
          });
        }

        // ── read-result ────────────────────────────────────────
        if (action === "read-result") {
          if (!args.taskId)
            throw new Error("'taskId' is required for read-result");
          const { getTask } = await import("./agent-teams.js");
          const task = await getTask(args.taskId);
          if (!task) return JSON.stringify({ error: "Task not found" });
          if (task.status === "running") {
            return JSON.stringify({
              status: "running",
              taskId: task.taskId,
              threadId: task.threadId,
              parentThreadId: task.parentThreadId,
              name: task.name,
              preview: task.preview,
              message:
                "Task is still running. Do not report it as complete; use status/read-result later.",
            });
          }
          return JSON.stringify({
            taskId: task.taskId,
            threadId: task.threadId,
            parentThreadId: task.parentThreadId,
            name: task.name,
            status: task.status,
            summary: task.summary,
            preview: task.preview,
          });
        }

        // ── send ───────────────────────────────────────────────
        if (action === "send") {
          if (!args.taskId) throw new Error("'taskId' is required for send");
          if (!args.message) throw new Error("'message' is required for send");
          const { sendToTask } = await import("./agent-teams.js");
          const result = await sendToTask(args.taskId, args.message);
          return JSON.stringify(result);
        }

        // ── list ───────────────────────────────────────────────
        if (action === "list") {
          const { listTasks } = await import("./agent-teams.js");
          const tasks = await listTasks();
          if (tasks.length === 0) {
            return "No sub-agent tasks.";
          }
          return JSON.stringify(
            tasks.map((t) => ({
              taskId: t.taskId,
              threadId: t.threadId,
              parentThreadId: t.parentThreadId,
              name: t.name,
              description: t.description,
              status: t.status,
              currentStep: t.currentStep,
              hasResult: t.summary.length > 0,
            })),
            null,
            2,
          );
        }

        throw new Error(
          `Unknown action '${action}'. Use one of: spawn, status, read-result, send, list`,
        );
      },
    },
  };
}

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  /** Template-specific actions (email ops, booking ops, etc.) */
  actions?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  /** @deprecated Use `actions` instead */
  scripts?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  /** System prompt for the agent. A sensible default is provided. */
  systemPrompt?: string;
  /** Additional system prompt prepended in dev mode */
  devSystemPrompt?: string;
  /** Model to use. Defaults to the resolved engine's default model. */
  model?: string;
  /** Optional per-app agent run chunk budget in milliseconds. Defaults to
   * AGENT_RUN_SOFT_TIMEOUT_MS when set, otherwise no framework-imposed
   * timeout. When reached, long runs continue through the hidden continuation
   * path instead of surfacing a timeout warning. */
  runSoftTimeoutMs?: number;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /**
   * Agent engine to use. Can be a pre-constructed AgentEngine, a registered
   * engine name (e.g. "anthropic", "ai-sdk:openai"), or an object with name
   * and config. Defaults to the "anthropic" engine using ANTHROPIC_API_KEY.
   */
  engine?:
    | import("../agent/engine/types.js").AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  /** Route path. Default: /_agent-native/agent-chat */
  path?: string;
  /** Custom mention providers for @-tagging template entities */
  mentionProviders?:
    | Record<string, MentionProvider>
    | (() =>
        | Record<string, MentionProvider>
        | Promise<Record<string, MentionProvider>>);
  /** App ID used to exclude self from agent discovery (e.g., "mail", "calendar") */
  appId?: string;
  /** Optional MCP server branding surfaced during the initialize handshake. */
  mcpServerInfo?: {
    /** Human-facing title. Defaults to the capitalized app id/name. */
    title?: string;
    /** Host-facing description. Defaults to "Agent-native <app> agent". */
    description?: string;
    /** Canonical app URL. Relative URLs are resolved against the request origin. */
    websiteUrl?: string;
    /** App icons. Relative `src` values are resolved against the request origin. */
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
      theme?: "light" | "dark";
    }>;
  };
  /**
   * Optional callback to resolve the org ID for the current request.
   * When provided, the resolved value is set as AGENT_ORG_ID env var so
   * that db-query/db-exec automatically scope by org_id in addition to
   * owner_email.
   *
   * If not provided, the framework automatically uses `session.orgId` from
   * Better Auth's active organization. Only provide this callback when you
   * need custom org resolution logic (e.g., Atlassian org mapping).
   */
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
  /**
   * Optional owner resolver for public/anonymous chat surfaces. When the
   * normal app session is missing, this callback may return a synthetic
   * owner id for a narrowly-scoped public request (for example, a public
   * shared document page). Anonymous requests use a read-only tool set by
   * default so public viewers cannot mutate app data through the agent.
   */
  anonymousOwner?: (event: any) => string | null | Promise<string | null>;
  /**
   * Keep anonymous-owner requests on read-only template actions. Defaults to
   * true. Only disable for single-tenant apps that intentionally allow public
   * agent mutations.
   */
  anonymousReadOnly?: boolean;
  /**
   * Optional callback to append template-specific context to the system
   * prompt on each request. Runs after AGENTS.md / skills / memory are
   * loaded and before the schema block — use it to inject dynamic SQL
   * context like a data dictionary, active feature flags, or whatever
   * the agent should know about *right now* for this user/org.
   *
   * Return `null` or an empty string to skip. The string you return is
   * appended verbatim, so wrap it in your own XML tags (e.g.
   * `<data-dictionary>…</data-dictionary>`) to keep the prompt scannable.
   *
   * Called on every request in every prompt variant (lean, lazy, full).
   * Templates that want to suppress it in a particular mode should return
   * `null` from the callback based on their own logic.
   */
  extraContext?: (
    event: any,
    owner: string,
  ) => string | null | Promise<string | null>;
  /**
   * Optional final-answer guard. Templates can use this to require a
   * corrective retry before accepting a text-only final answer, e.g. forcing
   * real data-source tool calls for analytics requests.
   */
  finalResponseGuard?: import("../agent/production-agent.js").AgentLoopFinalResponseGuard;
  /**
   * Optional per-template request normalizer. Runs after authentication and
   * before the model sees the message, so apps can translate chat attachments
   * into template-native file handles while preserving the user's visible text.
   */
  prepareRequest?: (details: {
    event: any;
    ownerEmail: string | null;
    message: string;
    displayMessage?: string;
    attachments: AgentChatAttachment[];
    references: AgentChatReference[];
    threadId?: string;
    internalContinuation?: boolean;
    mode: "act" | "plan";
  }) =>
    | void
    | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }
    | Promise<void | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }>;
  /**
   * Use ONLY the template's `systemPrompt` and the actions list — skip the
   * framework prompt wrapper, resource loading (AGENTS.md/LEARNINGS.md/
   * memory), the SQL schema block, and the workspace files/skills/agents
   * inventory. Intended for minimal or voice-first apps where a long,
   * generic preamble adds latency and iteration noise without adding value.
   *
   * When set, the same lean prompt is used in both dev and prod modes. In
   * dev mode the tool registry is ALSO swapped to the template's actions
   * (same set as prod) — the dev-only bash/db-exec/file-system tools
   * and the resource/docs/chat/team/job/browser scripts are dropped. The
   * lean system prompt has no bash-usage guidance, so routing actions
   * through bash would break. If you need the full dev tool surface,
   * leave this off.
   */
  leanPrompt?: boolean;
  /**
   * Use a compact system prompt with on-demand context loading. The system
   * prompt includes essential behavioral rules and action signatures, but
   * defers verbose framework details, SQL schema, skills, learnings, and
   * memory behind tools (`get-framework-context`, `db-schema`,
   * `resources` (action: read)). The agent fetches these on-demand when needed.
   *
   * This reduces the system prompt by ~60-70%, significantly improving
   * time-to-first-token and reducing "thinking" time. The agent retains
   * all capabilities — it just loads context lazily instead of upfront.
   *
   * Defaults to `true`. Set to `false` to use the original full prompt.
   * Ignored when `leanPrompt` is set (lean mode is even more minimal).
   */
  lazyContext?: boolean;
  /**
   * In dev mode, register the template's actions as native tools the agent
   * can call directly with structured JSON args — skipping the default
   * `bash(command="pnpm action <name> ...")` indirection.
   *
   * The default dev behavior shells out because it "mirrors how Claude Code
   * works locally" and reduces empty-object tool calls for templates with
   * simple string args. But templates whose actions take structured data
   * (objects, arrays, nested JSON) can't round-trip those cleanly through
   * the CLI parser — stringified JSON on the way in, loss of type fidelity
   * on the way out.
   *
   * Set to `true` to get the same tool surface in dev that production uses.
   * `leanPrompt: true` implies this already (lean mode has no bash-usage
   * guidance, so actions must be native). Set this flag without
   * `leanPrompt` when you want native actions AND the full system prompt.
   *
   * Defaults to `false`.
   */
  nativeActionsInDev?: boolean;
  /**
   * Optional A2A-only deterministic response path. Runs after inbound A2A text
   * and user context are resolved, but before an agent engine/model is loaded.
   * Return a message to complete the A2A task without invoking the LLM, or
   * null/undefined to continue through the normal agent loop.
   */
  a2aMessageFallback?: (details: {
    message: import("../a2a/types.js").Message;
    text: string;
    context: import("../a2a/types.js").A2AHandlerContext;
    userEmail: string | undefined;
  }) =>
    | import("../a2a/types.js").Message
    | string
    | null
    | undefined
    | Promise<import("../a2a/types.js").Message | string | null | undefined>;
  /**
   * Optional injectable prompt examples for core rules (rule 5 auto-refresh
   * examples and rule 8 external provider names). When absent, generic
   * placeholders are used so no template-specific names appear in the core
   * prompt by default.
   *
   * - `providerActions`: external provider action names this template exposes
   *   (e.g. `["warehouse-query", "crm-records"]` for a template).
   * - `appActions`: representative template action names for rule 5's refresh
   *   examples (e.g. `["log-meal", "update-form"]` for a forms template).
   */
  promptExamples?: PromptExamples;
  /**
   * Curated allow-list of action names to serve external **connector** clients
   * on a hosted multi-tenant deployment.
   *
   * Whenever this list is non-empty it is active by default for **every**
   * caller (hosted connectors, code/stdio clients, and the local CLI): external
   * MCP clients see (and can call) only these actions plus the builtin
   * cross-app tools (`list_apps`, `open_app`, `ask_app`, `create_embed_session`).
   * Calls to any tool outside the list are rejected with "Unknown tool".
   * This prevents the full ~105-tool catalog from bloating external-agent
   * context windows and removes footguns (db-exec, seed-*, extension suite,
   * browser-session tools) from connectors. It is no longer gated behind an
   * environment variable, and the catalog is never inferred from the client.
   *
   * `tool-search` stays available so any trimmed tool is reachable on demand.
   * Callers who need the full surface up front opt in explicitly with
   * `agent-native connect --full-catalog` (embeds a `catalog_scope: "full"`
   * claim in their connect-minted JWT) or the deployment-wide
   * `AGENT_NATIVE_MCP_FULL_CATALOG=1` env override.
   *
   * Declare here rather than in MCPConfig directly; the plugin copies it through.
   */
  connectorCatalog?: string[];

  /**
   * Skip mounting the remote MCP protocol route.
   *
   * Most apps should leave this off so agent chat, A2A, and MCP share one
   * runtime. Hosted apps with a dedicated early MCP plugin can set this to
   * true so their external connector does not depend on the heavier chat
   * plugin initialization path.
   */
  disableMcp?: boolean;

  /**
   * Code-execution capability for the production agent.
   *
   * - `"off"` (default) — no code-execution tools in production.
   * - `"sandboxed"` — registers the `run-code` tool (isolated Node.js sandbox
   *   with a bridge to allowlisted registered tools). Safe for shared or
   *   hosted deployments.
   * - `"trusted"` — registers both the full coding tool registry
   *   (bash / read / edit / write) and the `run-code` sandbox. Only use in
   *   single-tenant or operator-controlled deployments where full shell access
   *   to the host machine is intentional.
   *
   * The `AGENT_PROD_CODE_EXECUTION` environment variable (`"trusted"`,
   * `"sandboxed"`, or `"off"`) takes precedence over this option, allowing
   * per-deployment overrides without code changes.
   *
   * Dev-mode behavior is unchanged — both the coding tools and `run-code` are
   * always available when the environment allows toggling.
   */
  codeExecution?: {
    production?: "off" | "sandboxed" | "trusted";
    /**
     * Extra registered-tool names the sandbox bridge may forward (beyond the
     * default allowlist: provider-api-request, provider-api-docs,
     * provider-api-catalog, web-request).
     */
    bridgeTools?: string[];
  };

  /**
   * App-level default tool-call limits. Individual actions override these with
   * their own `timeoutMs` / `maxResultChars` declarations.
   */
  toolLimits?: { timeoutMs?: number; maxResultChars?: number };
}

/**
 * Verbose framework sections returned by the `get-framework-context` tool.
 * Keyed by topic so the agent can request specific sections.
 * Not template-specific — lives outside buildFrameworkPrompts().
 */
const FRAMEWORK_CONTEXT_SECTIONS: Record<string, string> = {
  embeds: `### Inline Embeds

You can embed an interactive view inline in your chat reply by writing an \`embed\` fenced code block. The chat renderer swaps the fence for a sandboxed iframe pointing at a route inside this app.

Syntax:

\`\`\`\`
\`\`\`embed
src: /some/path?param=value
aspect: 16/9
title: Optional label
\`\`\`
\`\`\`\`

Keys:
- \`src\` (required) — **must be a same-origin path starting with \`/\`**. Cross-origin URLs are blocked. No \`javascript:\` or \`data:\` URLs.
- \`aspect\` (optional) — one of \`16/9\` (default), \`4/3\`, \`3/2\`, \`2/1\`, \`21/9\`, \`1/1\`.
- \`title\` (optional) — accessible label / hover tooltip.
- \`height\` (optional) — fixed pixel height when aspect ratio isn't a good fit.

Use for charts, visualizations, previews. Don't use for simple text/tables or external sites.`,

  "chat-history": `### Chat History

You can search and restore previous chat conversations using \`chat-history\`:
- \`chat-history\` (action: "search") — Search or list past chat threads by keyword
- \`chat-history\` (action: "open") — Open a chat thread in the UI as a new tab and focus it
- \`chat-history\` (actions: "rename", "pin", "unpin", "archive") — Organize a known chat thread by ID

When the user asks to find a previous conversation, use \`chat-history\` with action "search" first to find matching threads, then action "open" to restore the one they want.`,

  "agent-teams": `### Agent Teams — Orchestration

You can delegate to background sub-agents with the \`agent-teams\` tool:
- \`agent-teams\` (action: "spawn") — Launch a sub-agent on a task. It runs in its own thread with a clean context while you stay available; a live preview card appears in the chat. The spawn result confirms launch only, not completion. Optionally pass a custom agent profile from \`agents/*.md\` via the \`agent\` parameter.
- \`agent-teams\` (action: "status") — Check a running sub-agent's progress.
- \`agent-teams\` (action: "read-result") — Read a finished sub-agent's output.
- \`agent-teams\` (action: "send") — Message a running sub-agent.
- \`agent-teams\` (action: "list") — List sub-agent tasks.

Sub-agents inherit all of your template tools but **cannot spawn sub-agents themselves** — only you orchestrate.

**User intent phrases.** If the user asks you to use a "sub-agent" or "background agent", that is explicit delegation intent. Also treat phrases like "run these in the background", "kick off the rest", "run the queued items", "batch run these jobs", "parallelize this", or "start the next batch" as delegation intent when the context is a set of independent work items.

**Spawn is not completion.** A successful \`spawn\` call means the sub-agent started and is running. Tell the user it started, show the task id if useful, and then use \`status\`/\`list\`/\`read-result\` to monitor it. Never say the delegated task "completed", "ran successfully", or "finished" until \`status\` or \`read-result\` reports \`completed\` or \`errored\`. If a task is still running, say that plainly.

**Default to doing the work yourself in this thread.** A sub-agent costs real tokens and adds a merge step, so reach for one only when delegation clearly pays for that overhead.

**Delegate ONE sub-agent** when a task is self-contained and heavy: deep research, long multi-step content generation, or a noisy scan whose intermediate steps would clutter this thread. The sub-agent gets its own clean context and hands you back a distilled result.

**Fan out to MULTIPLE sub-agents ONLY** for units of work that are genuinely independent and don't depend on each other's decisions — e.g. research three unrelated competitors, summarize five separate threads, draft sections that don't reference one another. Each gets a distinct slice.

**Do NOT parallelize tightly-coupled work** — one cohesive artifact, edits that must agree with each other, or anything needing a single consistent voice or style. Parallel sub-agents can't see each other's choices and their outputs will clash. For coupled work, do it yourself, or chain sub-agents one at a time, feeding each result into the next.

**Cap fan-out:** aim for 1, use up to ~3, and go beyond that only for clearly independent bulk work. More sub-agents means more tokens and a harder merge.

**Briefing contract.** A sub-agent starts in a fresh thread and can only see the brief you give it — it cannot see this conversation or ask you to clarify before it runs. Make every brief self-contained:
1. **Objective** — what "done" looks like, in a sentence or two.
2. **Context** — the specific facts it needs from this conversation: IDs, names, the user's actual goal, constraints, prior decisions. Paste the specifics; don't assume it knows them.
3. **Output format** — what to return and how (e.g. "a 3-bullet summary with source links", "the drafted email body only") so the result drops cleanly into your synthesis.
4. **Boundaries** — what NOT to do, and for parallel sub-agents, which slice is theirs so they don't overlap.

Put the objective and output format in \`task\`; put longer context in \`instructions\`.

**Synthesis discipline.** After the sub-agents you depend on finish, poll \`status\`/\`list\` until they're complete, then pull each one's output with \`read-result\`. Do NOT paste their outputs back to back. Read all results, reconcile any disagreements, de-duplicate, and write ONE integrated answer in your own voice. If two sub-agents conflict, resolve it or flag the discrepancy explicitly rather than presenting both. When findings came from distinct investigations, briefly note which finding came from where so the user can trust the merge.`,

  "recurring-jobs": `### Recurring Jobs

You can create recurring jobs that run on a cron schedule. Jobs are resource files under \`jobs/\`.

- \`manage-jobs\` (action: "create") — Create a new recurring job with a cron schedule and instructions
- \`manage-jobs\` (action: "list") — List all recurring jobs and their status
- \`manage-jobs\` (action: "update") — Update a job's schedule, instructions, or toggle enabled/disabled
- Delete a job with the \`resources\` tool: \`action: "delete"\`, \`path: "jobs/<name>.md"\`

Convert natural language to 5-field cron format:
- "every morning" / "daily at 9am" → \`0 9 * * *\`
- "every weekday at 9am" → \`0 9 * * 1-5\`
- "every hour" → \`0 * * * *\`
- "every monday at 9am" → \`0 9 * * 1\`

#### Suggesting "Save as automation"

When you finish a task that has obvious recurring value — daily inbox triage, weekly metrics summaries, archive sweeps, status digests, anything the user would plausibly want re-run on a fresh cadence — close the response with ONE short line offering to save it. Examples:

- After "Summarize my unread emails": _"Want me to run this every morning?"_
- After "What's our top traffic source this week": _"Want a weekly digest on Mondays?"_
- After "Archive emails older than 30 days": _"Should I run this every Sunday?"_

If the user says yes, call \`manage-jobs\` (action: "create") with the original prompt as the job's instructions and the cadence they confirmed.

Do NOT add this offer for one-shot work: lookups (find Alice, what's the schema, who reported X), single drafts/replies, navigation requests, or any task whose value is in the moment. Skip it when the prompt is already explicitly recurring (the user said "every morning…" — you'd be asking what they already told you). One short sentence at most; do not turn it into a list of cadence options.`,

  builder: `### Connecting Builder.io

When the user asks to connect Builder.io or you hit a "Builder not configured" error, call the \`connect-builder\` tool. It renders a one-click Connect card inline — do NOT write out multi-step setup instructions yourself. If Builder Cloud Agents are not available for this workspace, never send the user to Builder org settings or beta settings; use the card's waitlist/local-dev fallback.`,

  browser: `### Browser Automation

You can activate a real Chrome browser via Builder.io for tasks that need full page rendering:
- Extracting design tokens from JS-heavy or SPA websites (computed styles, rendered colors/fonts)
- Taking screenshots of live pages
- Testing interactive flows on deployed URLs
- Reading content from pages that require JavaScript execution

**How to use:**
1. In local development, call \`set-browser-control\` with \`{"enabled":true,"backend":"chrome-devtools"}\` after confirming once with the user. In production, use \`activate-browser\` for Builder-provisioned Chrome.
2. On your next action, use \`mcp__chrome-devtools__navigate_page\`, \`mcp__chrome-devtools__evaluate_script\`, \`mcp__chrome-devtools__take_screenshot\`, etc.
3. If Builder is not connected, call \`connect-builder\` first

**When to recommend browser automation:**
- User wants to import a design system from a URL (JS-rendered sites give almost no useful data from plain HTML fetch)
- User asks you to check how a deployed site looks or behaves
- Any task involving reading computed/rendered page state
- When \`web-request\` returns minimal/skeleton HTML from a modern SPA

Prefer \`web-request\` for simple API calls and static pages. Use browser automation when you need the real rendered page.`,

  "call-agent": `### call-agent — External Apps Only

The \`call-agent\` tool sends a message to a DIFFERENT, separately-deployed app's agent (A2A protocol). It is **not** for calling actions within the current app.

**NEVER use \`call-agent\` to:**
- Call your own app by name
- Perform tasks you can accomplish with your own registered tools

**ONLY use \`call-agent\` when:**
- The user explicitly asks you to communicate with a different app
- You need data that only another deployed app can provide
- You need brand-consistent generated media and this app does not have a native generation action; call agent "assets" and keep returned asset IDs and URLs verbatim

If \`call-agent\` says a downstream agent accepted the subtask and will post its result separately, do not call that same agent again for the same subtask. Continue any remaining work and answer with the completed results you have.`,

  memory: `### Structured Memory

Your memory index (\`memory/MEMORY.md\`) is loaded at the start of every conversation.

**Tools:**
- \`save-memory\` — Create or update a memory (name, type, description, content)
- \`delete-memory\` — Remove a memory and its index entry
- \`resources\` with \`action: "read"\` and \`path: "memory/<name>.md"\` — Read the full content of a specific memory

**Memory types:** user, feedback, project, reference

**When to save (proactively):**
- User corrects your approach → \`feedback\`
- User shares preferences → \`user\`
- Non-obvious pattern or gotcha → \`feedback\`
- Personal context (contacts, team) → \`user\`
- Project context to track → \`project\`

**Rules:**
- Don't save things obvious from code or standard framework behavior
- When updating, read first and merge — don't overwrite
- Keep descriptions concise
- One memory per logical topic`,

  "sql-tools": `### SQL Tools

- \`db-schema\` — refresh the full schema with indexes and foreign keys
- \`db-query\` — run a SELECT (read-only; results already filtered to the current user/org)
- \`db-exec\` — run INSERT / UPDATE / DELETE / REPLACE (writes already scoped; owner_email and org_id are auto-injected on INSERT). For multiple related writes, use \`statements\` so they run in one transaction instead of separate tool calls. Schema changes are blocked.
- \`db-patch\` — surgical search-and-replace on a large text column. Use for edits to large fields instead of re-sending multi-kilobyte strings.

### When to pick which SQL tool
- Set a short column outright, update multiple columns, or do computed updates → \`db-exec UPDATE\`
- Insert/update several rows as one logical operation → \`db-exec\` with \`statements: '[{"sql":"...","args":[...]}]'\`
- Change a small slice of a large text/JSON column → \`db-patch\`
- A template-specific action exists for the table → use that action (it encodes business rules and pushes live Yjs updates)
- Read data → \`db-query\`. Never re-add \`WHERE owner_email = ...\` — scoping already applies it.

### External data sources vs the app database
The \`db-*\` tools ONLY query the app's own SQL database. They do NOT reach external data warehouses. If the user asks about tables NOT in the schema, use the appropriate template action instead.`,
};

/**
 * Framework-level instructions injected into every agent's system prompt.
 * Prompt text lives in packages/core/src/server/prompts/ so this file stays
 * focused on routing and assembly logic.
 *
 * buildFrameworkPrompts() is called once per plugin instantiation (not per
 * request) with the template's promptExamples, producing the four assembled
 * prompt strings used at request time.
 */
function buildFrameworkPrompts(examples?: PromptExamples): {
  FRAMEWORK_CORE: string;
  FRAMEWORK_CORE_COMPACT: string;
  PROD_FRAMEWORK_PROMPT: string;
  DEV_FRAMEWORK_PROMPT: string;
  PROD_FRAMEWORK_PROMPT_COMPACT: string;
  DEV_FRAMEWORK_PROMPT_COMPACT: string;
} {
  // Note: FIRST_SESSION_PERSONALIZATION is NOT appended here — it is injected
  // at per-request prompt-assembly time only for new threads (no prior messages).
  // This prevents the ~1.5KB block from appearing on every request forever.
  const FRAMEWORK_CORE = buildFrameworkCore(examples);
  const FRAMEWORK_CORE_COMPACT = buildFrameworkCoreCompact(examples);

  const PROD_FRAMEWORK_PROMPT = `## Agent-Native Framework — Production Mode

You are an AI agent in an agent-native application, running in **production mode**.

The agent and the UI are equal partners — everything the UI can do, you can do via your tools, and vice versa. They share the same SQL database and stay in sync automatically.

**In production mode, you operate through registered actions exposed as tools.** These are your capabilities — use them to read data, take actions, and help the user. You cannot edit source code or access the filesystem directly. Your tools are the app's API.

### Plan Mode

If the current turn is in Plan mode, plan before anything gets written. This applies to source-code handoffs and to app-created artifacts such as extensions, widgets, dashboards, calculators, mini-apps, documents, designs, slides, or videos. Use only read-only tools, clarify the goal when needed, and return a concrete plan for approval. Do not call \`create-extension\`, \`update-extension\`, \`connect-builder\`, or any action that creates, updates, deletes, sends, publishes, or persists data until the user switches back to Act mode.

### Extensions (Mini-Apps) — Use \`create-extension\` for extensions / widgets / dashboards

In Act mode, if the user asks you to create, build, or make an **extension**, **widget**, **dashboard**, **calculator**, **mini-app**, or any small self-contained interactive utility — call \`create-extension\` immediately with a self-contained Alpine.js HTML body. This is **NOT** a code change and does **NOT** go through \`connect-builder\`. Extensions are sandboxed mini-apps stored in the database — no source files are touched, no PR is opened, no build is required. The extension appears in the Extensions view and can be edited later via \`update-extension\`.

Keep \`create-extension\` payloads compact enough to finish quickly. For complex extensions, create a useful working v1 first, then call \`update-extension\` with focused edits for refinements instead of trying to assemble one enormous initial tool input.

If the user asks to change, edit, fix, style, rename, or add behavior to an existing extension/widget/dashboard/calculator/mini-app, use the current extension id from \`<current-screen>\` or \`<current-url>\` when present. Call \`get-extension\` only if you need to inspect its content, then \`update-extension\` with that id. Use \`list-extensions\` only when no current id/name is available. Existing extension edits are SQL data updates, not source-code changes, even when the request says "change the UI" or "fix this". Do **NOT** call \`connect-builder\` for existing extension edits.

In Act mode, when in doubt — if the request mentions creating an extension, widget, dashboard, calculator, or asks for a new small interactive utility — choose \`create-extension\`. If it references an existing one or the current extension page, choose \`update-extension\`. Do **not** preface the call with planning text like "let me build the dashboard…" — just call the right extension action directly.

Note: "extension" is the user-facing primitive (the sandboxed Alpine.js mini-app). Don't confuse it with the LLM concept of "tools" (function calls) — those are how you invoke ANY action, including \`create-extension\` itself.

For existing extensions, use \`get-extension\` or \`update-extension\` directly when \`<current-screen>\` or \`<current-url>\` provides an \`extensionId\`. Use \`list-extensions\` only to browse or resolve an unknown name. If the user wants a shared extension removed only from their view, use \`hide-extension\` — do not query or mutate the legacy \`tools\` table directly.

### Extensions vs. Code Changes — Pick the Right Path

Route by what the request changes, not how it is phrased. Extensions render in their own sandboxed iframe and CANNOT change the host app's nav, restyle existing components, or replace built-in views.

<routing>
| The request is for…                                              | Path                          |
| ---------------------------------------------------------------- | ----------------------------- |
| A new self-contained surface (widget, dashboard, calculator, viewer, list, tracker) | \`create-extension\` — ships instantly, no PR |
| Editing an existing extension (fix, restyle, rename, add behavior) | \`update-extension\`           |
| The host app's own chrome (nav bar, sidebar, layout, routes, shipped components, existing styles, business logic) | \`connect-builder\` — a real source-code change |
| Ambiguous, satisfiable either way (e.g. "give me an unread view") | \`create-extension\` (prefer the instant path) |
</routing>

Worked examples: "a widget showing unread emails grouped by sender", "a dashboard summarizing my pipeline", "a tracker for my newsletter subscriptions" → \`create-extension\`. "Add an Unread tab to the left navigation", "make the subject lines wrap", "change the inbox grouping logic", "add a field to the compose form" → \`connect-builder\`.

### Code Changes Not Available — Call \`connect-builder\` Immediately

If the request matches the Extensions section above, use \`create-extension\` or \`update-extension\` instead — do NOT route it to \`connect-builder\`.

In Act mode, when the user asks you to change the UI, modify code, add a feature, fix a bug in the app itself, change styles, add a hook, create a component, add a route, add an integration, or anything else that requires editing source files — you MUST take exactly these steps, in order:

1. Briefly acknowledge the user's specific request in their own terms — one short clause naming what they asked for (e.g. "Got it — wider subject lines in the email list."). Do NOT restate the request verbatim, do NOT add a generic preamble, and do NOT promise outcomes. Skip this step entirely if the user already knows you're handing off (e.g. they said "send this to Builder").
2. Call the \`connect-builder\` tool, passing the user's full request verbatim as the \`prompt\` argument. This renders an inline card. If Builder is connected and \`builderEnabled\` is true, the card hands the prompt off to Builder's cloud agent on one click and returns a branch URL. If Builder is not connected, it shows the Connect Builder flow. If \`builderEnabled\` is false, it shows a waitlist/local-dev fallback instead of a cloud handoff.
3. After the card renders, inspect the tool result and write one sentence that frames the next click around what the user just asked — not as a Builder pitch. Examples: "Click Send to Builder and it'll wire that up for you." / "Connect Builder once and it'll handle this and future changes." / "Builder Cloud Agents aren't available here yet — join the waitlist in the card, or use the Agent Native Desktop app for local code changes: https://www.agent-native.com/download." Do NOT say the card is pre-loaded, has everything, or lead with "Builder Cloud Agents are…" as if it were the headline.

When \`builderEnabled\` is false, Builder Cloud Agents are not self-serve from Builder org settings. Do NOT tell the user to go to Builder org settings, beta features, "Cloud Agents", or "AI Agents" to enable them. The only allowed guidance is the card's waitlist/local-dev fallback: join the waitlist when the card offers it, use Agent Native Desktop, or edit from a local clone.

**Act-mode handoff — do exactly this:** The moment a code change is requested, call \`connect-builder\` with the user's verbatim request, then write one sentence framing the next click. That is the whole job: Builder plans and edits in its own sandbox, so the planning, file-mapping, and code all happen there, not here. Keep your turn to the call plus that one sentence — skip code exploration, implementation plans, \`resources\` writes of specs, and sub-agents (they have no code-editing tools either). You don't need filesystem access to recommend Builder, so don't reach for it or list tools you lack.

Builder Cloud Agents are the recommended path when available because they are one-click and run in the cloud. Local dev and the desktop app are the fallback when cloud agent access is waitlisted or unavailable.
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

If the turn is in Plan mode, plan before anything gets written — including extensions, widgets, dashboards, calculators, mini-apps, documents, designs, slides, videos, and code-change handoffs. Use read-only tools only and do not call \`create-extension\`, \`update-extension\`, \`connect-builder\`, or other write actions until the user switches back to Act mode.

### Extensions (Mini-Apps) — Use \`create-extension\`

In Act mode, if the user asks for an **extension**, **widget**, **dashboard**, **calculator**, or **mini-app**, call \`create-extension\` immediately with a self-contained Alpine.js HTML body. This is NOT a code change — extensions are sandboxed mini-apps stored in the database. Do not preface with "let me build…" — just call \`create-extension\`.

Keep the first \`create-extension\` call compact and working. If the request is complex, create the v1 first and then refine with focused \`update-extension\` edits.

If the user asks to change, edit, fix, style, rename, or add behavior to an existing extension/widget/dashboard/calculator/mini-app, use the current extension id from \`<current-screen>\` or \`<current-url>\` when present. Call \`get-extension\` only if you need to inspect its content, then \`update-extension\` with that id. Use \`list-extensions\` only when no current id/name is available. Existing extension edits are SQL data updates, not source-code changes. Do NOT call \`connect-builder\` for them.

For existing extensions, use \`get-extension\` or \`update-extension\` directly when \`<current-screen>\` or \`<current-url>\` provides an \`extensionId\`. Use \`list-extensions\` only to browse or resolve an unknown name. Use \`hide-extension\` when the user wants a shared extension removed only from their own view. Do not query the legacy \`tools\` table directly.

### Extensions vs. Code Changes — Pick the Right Path

If the user wants a **new self-contained surface** (custom widget, dashboard, list, viewer, calculator), use \`create-extension\` — extensions ship instantly without a PR. Use \`connect-builder\` only when the request **modifies the host app's existing chrome** (nav bar, sidebar, current components, layout, styles, routes). Extensions cannot change the host nav or restyle existing components.

### Code Changes — Call \`connect-builder\`

In Act mode, when a request genuinely needs a source-code edit (per the rules above), do this in order: (1) briefly acknowledge the user's specific ask in their own terms — one short clause, no preamble — then (2) call \`connect-builder\` with the user's request as the \`prompt\`, then (3) write one sentence framing the next click around what they asked for, not a Builder pitch. Do NOT write code, list files, make plans, or spawn sub-agents. Mention \`npx agent-native create <app-name>\`, Agent Native Desktop, or the waitlist card as the fallback when Builder Cloud Agents aren't available. Never tell users to enable Builder Cloud Agents from Builder org settings, beta features, "Cloud Agents", or "AI Agents"; they are not self-serve there.
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
  };
})();

/**
 * Pre-load the agent's context: AGENTS.md (workspace/template/runtime
 * instructions), the skills index, shared LEARNINGS.md (team notes), a shared
 * resource index, and memory/MEMORY.md (personal structured memory index).
 * These all get appended to the system prompt so the agent has everything it
 * needs from the first turn.
 *
 * Six sources are layered:
 *
 *   1. `<workspace>` — AGENTS.md from the enterprise workspace core.
 *   2. `<template>` — AGENTS.md + skills index from the Vite plugin bundle.
 *   3. `<workspace>` — SQL workspace AGENTS.md and instructions/*.md.
 *      Runtime global defaults managed from Dispatch and inherited by apps.
 *   4. `<shared>` — SQL shared AGENTS.md and instructions/*.md. App/team/org
 *      guidance that can override or narrow workspace defaults.
 *   5. `<shared>` — LEARNINGS.md from the SQL shared scope. Team-level notes.
 *   6. `<personal>` — memory/MEMORY.md from the SQL personal scope. The
 *      current user's structured memory index.
 *
 * Each source is read independently — no copying between them. Editing
 * AGENTS.md and restarting the server is all it takes; Vite HMR invalidates
 * the bundle in dev so changes land instantly.
 */
export async function loadResourcesForPrompt(
  owner: string,
  compact = false,
  selfAppId?: string,
): Promise<string> {
  await ensurePersonalDefaults(owner);

  const sections: string[] = [];
  const promptResourceMaxChars = compact
    ? COMPACT_PROMPT_RESOURCE_MAX_CHARS
    : SHARED_PROMPT_RESOURCE_MAX_CHARS;

  // 1. Workspace AGENTS.md + skills merged into the template bundle.
  try {
    const { loadAgentsBundle, generateSkillsPromptBlock, getRuntimeSkills } =
      await import("./agents-bundle.js");
    const bundle = await loadAgentsBundle();

    // Workspace-core AGENTS.md (enterprise-wide instructions), if present.
    if (bundle.workspaceAgentsMd && bundle.workspaceAgentsMd.trim()) {
      const block = promptResourceBlock({
        name: "AGENTS.md",
        scope: "workspace",
        path: "AGENTS.md",
        content: bundle.workspaceAgentsMd,
        maxChars: promptResourceMaxChars,
        readHint:
          'Use docs-search --slug "agents-workspace" to read the full workspace AGENTS.md.',
      });
      if (block) sections.push(block);
    }

    // 2. Template AGENTS.md — always included (critical template instructions).
    if (bundle.agentsMd.trim()) {
      const block = promptResourceBlock({
        name: "AGENTS.md",
        scope: "template",
        path: "AGENTS.md",
        content: bundle.agentsMd,
        maxChars: promptResourceMaxChars,
        readHint:
          'Use docs-search --slug "agents-template" to read the full template AGENTS.md.',
      });
      if (block) sections.push(block);
    }

    // In compact mode, skip the full skills block — the agent can use
    // `docs-search` to find skills when it needs them. Either way, `scope: dev`
    // skills are excluded: they're for the human's coding agent, not runtime.
    const runtimeSkills = getRuntimeSkills(bundle);
    if (!compact) {
      const skillsBlock = generateSkillsPromptBlock(bundle);
      if (skillsBlock) sections.push(skillsBlock);
    } else if (runtimeSkills.length > 0) {
      const lines = runtimeSkills.map((s) => {
        const description = s.meta.description?.trim()
          ? ` - ${ensureSentence(s.meta.description)}`
          : "";
        return `- \`${s.meta.name}\`${description} Read with \`docs-search --slug "${skillDocsSlug(s.meta.name)}"\` before starting a task it applies to.`;
      });
      sections.push(
        `<skills-summary>\nCodebase skills bundled from \`.agents/skills/\` (or legacy \`.agent/skills/\`) are available as docs-search pages. Do not use MCP resource reads for these skills.\n\n${lines.join("\n")}\n</skills-summary>`,
      );
    }
  } catch {}

  // 3. Runtime workspace resources. These are global defaults inherited by
  // every app in the workspace, not copied into app scopes. They may come from
  // SQL, Dispatch, or local file mode.
  const workspaceAgents = await loadAgentsResourceForPrompt(
    WORKSPACE_OWNER,
    "workspace",
    promptResourceMaxChars,
  );
  if (workspaceAgents) sections.push(workspaceAgents);
  sections.push(
    ...(await loadInstructionResourcesForPrompt(
      WORKSPACE_OWNER,
      "workspace-instruction",
      promptResourceMaxChars,
    )),
  );

  // 4. Runtime shared/app/org resources from SQL. These come after workspace
  // defaults so app/team-specific guidance can override or narrow them.
  const sharedAgents = await loadAgentsResourceForPrompt(
    SHARED_OWNER,
    "shared",
    promptResourceMaxChars,
  );
  if (sharedAgents) sections.push(sharedAgents);
  sections.push(
    ...(await loadInstructionResourcesForPrompt(
      SHARED_OWNER,
      "shared-instruction",
      promptResourceMaxChars,
    )),
  );

  // 5. Personal SQL resources. These come last in the instruction stack so a
  // user can narrow or override organization/app and workspace defaults.
  if (owner !== SHARED_OWNER && owner !== WORKSPACE_OWNER) {
    const personalAgents = await loadAgentsResourceForPrompt(
      owner,
      "personal",
      promptResourceMaxChars,
    );
    if (personalAgents) sections.push(personalAgents);
    sections.push(
      ...(await loadInstructionResourcesForPrompt(
        owner,
        "personal-instruction",
        promptResourceMaxChars,
      )),
    );
  }

  const resourceSkillsBlock = await loadResourceSkillsPromptBlock(owner);
  if (resourceSkillsBlock) sections.push(resourceSkillsBlock);

  if (compact) {
    // In compact mode, skip learnings and memory in the prompt.
    // The agent can access them via the resources tool when needed.
    // Add a brief pointer so the agent knows they exist.
    sections.push(
      `<context-note>Shared learnings (LEARNINGS.md) and your personal memory (memory/MEMORY.md) are available via the \`resources\` tool with \`action: "read"\`. Check them when making decisions that might benefit from prior context.</context-note>`,
    );
  } else {
    // LEARNINGS.md from SQL (template-level instructions are in AGENTS.md above).
    // 2. Shared SQL scope
    try {
      const shared = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");
      if (shared?.content?.trim()) {
        sections.push(
          `<resource name="LEARNINGS.md" scope="shared">\n${shared.content.trim()}\n</resource>`,
        );
      }
    } catch {}

    // 3. Personal memory index (skip if owner is the shared sentinel)
    if (owner !== SHARED_OWNER) {
      try {
        const memoryIndex = await resourceGetByPath(owner, "memory/MEMORY.md");
        if (memoryIndex?.content?.trim()) {
          sections.push(
            `<resource name="memory/MEMORY.md" scope="personal">\n${memoryIndex.content.trim()}\n</resource>`,
          );
        }
      } catch {}
    }
  }

  const workspaceResourceIndex = await loadResourceIndexForPrompt(
    WORKSPACE_OWNER,
    "workspace",
  );
  if (workspaceResourceIndex) sections.push(workspaceResourceIndex);

  const sharedResourceIndex = await loadResourceIndexForPrompt(
    SHARED_OWNER,
    "shared",
  );
  if (sharedResourceIndex) sections.push(sharedResourceIndex);

  try {
    const agents = (await discoverAgents(selfAppId)).slice(0, 30);
    if (agents.length > 0) {
      const lines = agents.map(
        (agent) =>
          `- ${agent.name} (${agent.id}) — ${agent.description || "Connected A2A app"}`,
      );
      sections.push(
        `<available-apps>\nWorkspace apps available over A2A/call-agent:\n${lines.join("\n")}\n\nUse \`call-agent\` with the app id when another app owns the work or data. Use tool-search or app-specific actions for details only when needed.\n</available-apps>`,
      );
    }
  } catch {
    // Agent discovery is helpful context, not required for the run.
  }

  if (sections.length === 0) return "";
  return (
    "\n\nThe following resources contain template-specific instructions and user context. Use the information in them to help the user.\n\n" +
    sections.join("\n\n")
  );
}

/**
 * Build the per-request SQL-schema context block. Reads AGENT_ORG_ID live
 * from the environment so scheduler/A2A/HTTP call sites all see whatever
 * org was just resolved for this request.
 */
async function buildSchemaBlock(
  owner: string,
  _legacyHasRawDbTools?: boolean,
): Promise<string> {
  // db-* tools are always registered (see createDbScriptEntries), in both dev
  // and prod. The legacy boolean is kept for call-site compatibility but
  // ignored — always advertise the tools to the agent.
  try {
    return await loadSchemaPromptBlock({
      owner,
      orgId: getRequestOrgId() ?? null,
      hasRawDbTools: true,
    });
  } catch {
    return "";
  }
}

/**
 * Generates a system prompt section describing registered template actions.
 * This helps the agent prefer template-specific actions over raw db-query/db-exec.
 *
 * Two output modes:
 *
 *   - `"tool"` — used in production, where template actions are registered
 *     as native Anthropic tools. Output reads `name(arg*: type; ...) — desc`.
 *   - `"cli"` — used in dev, where template actions are NOT registered as
 *     native tools and must be invoked via `bash(command="pnpm action ...")`.
 *     Output reads `pnpm action name --arg <type> [--opt <type>] — desc`.
 */
function generateActionsPrompt(
  registry: Record<string, ActionEntry>,
  mode: "cli" | "tool" = "tool",
): string {
  if (!registry || Object.keys(registry).length === 0) return "";

  const actionEntries = Object.entries(registry);

  if (mode === "tool") {
    const summaryLines = actionEntries.map(([name, entry]) => {
      const desc = compactPromptLine(
        entry.tool.description,
        MAX_ACTION_SUMMARY_DESCRIPTION_CHARS,
      );
      return `- \`${name}\` — ${desc}`;
    });

    return `\n\n## Available Actions

**Use these actions directly as tool calls.** They handle database access, validation, and business logic internally. The native tool schemas contain the full parameter details.

${summaryLines.join("\n")}`;
  }

  const lines = actionEntries.map(([name, entry]) => {
    const desc = entry.tool.description;
    const params = entry.tool.parameters?.properties;
    const requiredFields = new Set(entry.tool.parameters?.required ?? []);

    // CLI mode: emit `pnpm action <name> --required <type> [--optional <type>]`
    if (!params || Object.keys(params).length === 0) {
      return `- \`pnpm action ${name}\` — ${desc}`;
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
    return `- \`${cmd}\` — ${desc}.${requiredNote}`;
  });

  return `\n\n## Available Actions

**These template actions are NOT exposed as direct tools in dev mode. To run any of them, use the \`bash\` tool with the exact command shown below.** Example: \`bash(command="pnpm action add-slide --deckId abc --content 'Hello'")\`.

Do NOT try to call these by name as if they were tools — they will not exist in your tool list. Always go through \`bash\`.

${lines.join("\n")}`;
}

function generateCorpusToolsPrompt(
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

For broad provider searches, raw API access, multi-page cohorts, cross-source joins, classification/counting over records, or absence-sensitive answers, do not stop at a bounded shortcut action. Use the provider's broad API/search/list surface, fetch every relevant page or an explicit bounded cohort, stage/save large responses when needed, and reduce the corpus with durable corpus jobs, staged-dataset queries, or code execution.

When \`provider-corpus-job\` is available, prefer it for transcript/message/ticket/issue/document scans that may exceed one turn, need provider-side backoff, or need a defensible "not found" conclusion. Use operation="start" with mode="paginated-search" for any paginated provider endpoint, or mode="batch-search" when a prior cohort of ids/records must feed a second provider endpoint. Continue paused jobs with operation="continue" until status is completed or quota_wait, then read operation="results". In run-code, prefer providerFetchAll() for short cursor/page/offset pagination and providerRequest() when response status, headers, or truncation metadata matters. Report source, filters, row counts, pagination/truncation, failed pages, quota_wait times, and remaining gaps.`;
}

/**
 * Creates a Nitro plugin that mounts the agent chat endpoint.
 *
 * In dev mode (NODE_ENV !== "production"), automatically includes
 * file system, bash, and database tools alongside any template-specific actions.
 *
 * Usage in templates:
 * ```ts
 * // server/plugins/agent-chat.ts
 * import { readBody, createAgentChatPlugin } from "@agent-native/core/server";
 * import { scriptRegistry } from "../../scripts/registry.js";
 *
 * export default createAgentChatPlugin({
 *   scripts: scriptRegistry,
 *   systemPrompt: "You are an email assistant...",
 * });
 * ```
 */
async function collectFiles(
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

function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  userInvocable?: boolean;
} {
  const frontmatter = parseFrontmatter(content);
  const userInvocable = getFrontmatterValue(frontmatter, "user-invocable");
  return {
    name: getFrontmatterValue(frontmatter, "name"),
    description: getFrontmatterValue(frontmatter, "description"),
    userInvocable:
      userInvocable === undefined
        ? undefined
        : userInvocable.toLowerCase() === "true",
  };
}

function isLocalhost(event: any): boolean {
  try {
    const host =
      event.node?.req?.headers?.host || event.headers?.get?.("host") || "";
    const hostname = host.split(":")[0];
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

type AgentChatRequestSurface = "app" | "dev-frame" | "desktop";

function normalizeAgentChatRequestSurface(
  value: string | null | undefined,
): AgentChatRequestSurface | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (
    normalized === "app" ||
    normalized === "dev-frame" ||
    normalized === "desktop"
  ) {
    return normalized;
  }
  return null;
}

function isBrowserUserAgent(userAgent: string | null | undefined): boolean {
  return /Mozilla\/|Chrome\/|Safari\/|Firefox\/|Edg\//i.test(userAgent ?? "");
}

export function shouldBlockInProductCodeEditingSurface(input: {
  surface?: string | null;
  userAgent?: string | null;
  host?: string | null;
}): boolean {
  const surface = normalizeAgentChatRequestSurface(input.surface);
  if (surface === "dev-frame") return false;
  if (surface === "desktop") return false;
  if (surface === "app") return true;

  // Legacy clients used to send `frame` for any iframe, which includes the
  // app-rendered sidebar inside preview frames. Treat unknown explicit surface
  // values as app-owned so they cannot accidentally receive dev code tools.
  if (input.surface && input.surface.trim()) return true;

  const userAgent = input.userAgent ?? "";
  if (/AgentNativeDesktop/i.test(userAgent)) return false;

  // Missing header from an older browser client. Be conservative for browser
  // UAs on any host, because preview URLs can be non-local while still running
  // a dev-mode app whose in-product chat would be reloaded by source edits.
  if (isBrowserUserAgent(userAgent)) return true;

  const host = (input.host ?? "").toLowerCase();
  const hostname = host.split(":")[0] ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function createAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "agent-chat");
    // Nitro v3 calls plugins synchronously and doesn't await async return
    // values. We track the async init so the framework's readiness gate
    // holds /_agent-native requests until routes are registered.
    const initPromise = (async () => {
      const { awaitBootstrap } = await import("./framework-request-handler.js");
      await awaitBootstrap(nitroApp);

      // Reap phantom runs left over from the previous process (HMR restart,
      // process crash, isolate eviction). Any run whose heartbeat is already
      // stale by startup time had a dead producer; mark it errored so the
      // next /runs/active check returns a terminal status and reconnecting
      // clients don't spin on "Thinking...". Runs owned by OTHER live
      // isolates are protected by their fresh heartbeats.
      try {
        const { reapAllStaleRuns } = await import("../agent/run-store.js");
        const reaped = await reapAllStaleRuns();
        if (reaped > 0) {
          console.log(`[agent-chat] reaped ${reaped} stale run(s) on startup`);
        }
      } catch {
        // Best effort — don't block plugin init if SQL isn't ready yet.
      }

      const env = process.env.NODE_ENV;
      // AGENT_MODE=production forces production agent constraints even in dev
      const canToggle =
        (env === "development" || env === "test") &&
        process.env.AGENT_MODE !== "production";
      const routePath = options?.path ?? "/_agent-native/agent-chat";

      // Mutable mode flag — persisted to the `settings` table so a user who
      // toggles to "Production" stays in prod mode across server restarts.
      // Hoisted here (before any tool-registry / handler closures are built)
      // so every runtime decision point can close over it and see live changes
      // when the user toggles the Environment dropdown.
      const AGENT_MODE_SETTING_KEY = "agent-chat.mode";
      let currentDevMode = canToggle;
      if (canToggle) {
        try {
          const persisted = await getSetting(AGENT_MODE_SETTING_KEY);
          if (persisted && typeof persisted.devMode === "boolean") {
            currentDevMode = persisted.devMode;
          }
        } catch {
          // Settings table may not be ready yet — fall back to default.
        }
      }
      // Every closure that picks between dev/prod tools, prompts, or handlers
      // at request time should call this getter instead of reading `canToggle`.
      // `canToggle` means "this environment allows toggling" (static); this
      // function means "the user currently has dev mode ON" (live).
      const isDevMode = () => currentDevMode;

      // Build the four assembled system prompt strings. These are static for the
      // lifetime of this plugin instance — examples come from options once at
      // startup, not per-request.
      const {
        PROD_FRAMEWORK_PROMPT,
        DEV_FRAMEWORK_PROMPT,
        PROD_FRAMEWORK_PROMPT_COMPACT,
        DEV_FRAMEWORK_PROMPT_COMPACT,
      } = buildFrameworkPrompts(options?.promptExamples);

      // Initialize MCP client. Merges file/env config + auto-detected binaries
      // + any remote servers users have added through the settings UI (persisted
      // in the settings table, scanned across all scopes so we never drop
      // another user's entries). Graceful-degrade: any failure yields zero MCP
      // tools and agent-chat keeps working as before.
      let mcpConfig = await buildMergedConfig().catch((err) => {
        console.warn(
          `[mcp-client] buildMergedConfig failed: ${err?.message ?? err}`,
        );
        return null;
      });
      if (!mcpConfig) {
        const fileOrEnv = loadMcpConfig() ?? autoDetectMcpConfig();
        mcpConfig = fileOrEnv;
        if (mcpConfig?.source) {
          console.log(
            `[mcp-client] loaded config from ${mcpConfig.source} (${Object.keys(mcpConfig.servers).length} server(s))`,
          );
        } else if (process.env.DEBUG) {
          console.log(
            "[mcp-client] no configured MCP servers — skipping MCP tools",
          );
        }
      } else if (mcpConfig.source) {
        console.log(
          `[mcp-client] merged config (${Object.keys(mcpConfig.servers).length} server(s), source: ${mcpConfig.source})`,
        );
      }
      const mcpManager = new McpClientManager(mcpConfig);
      try {
        await mcpManager.start();
      } catch (err: any) {
        console.warn(
          `[mcp-client] start() failed: ${err?.message ?? err}. Continuing without MCP tools.`,
        );
      }
      setGlobalMcpManager(mcpManager);
      const mcpActionEntries = mcpToolsToActionEntries(mcpManager);

      // Mount status + management routes so the settings UI can list / add /
      // remove remote MCP servers and hot-reload the running manager.
      mountMcpStatusRoute(nitroApp, mcpManager);
      mountMcpServersRoutes(nitroApp, mcpManager);
      startMcpConfigRefresh(mcpManager);
      // Hub-serve: expose org-scope servers to other agent-native apps in the
      // workspace when `AGENT_NATIVE_MCP_HUB_TOKEN` is set (dispatch, by
      // convention). Gated by the env var so mounting is a no-op otherwise.
      if (isHubServeEnabled()) {
        mountMcpHubRoutes(nitroApp);
        console.log(
          "[mcp-client] hub serve enabled — other apps can pull org servers via /_agent-native/mcp/hub/servers",
        );
      }
      const hubStatus = getHubStatus();
      if (hubStatus.consuming) {
        console.log(
          `[mcp-client] hub consume enabled — pulling from ${hubStatus.hubUrl}`,
        );
      }
      mountMcpHubStatusRoute(nitroApp);

      // Ensure we tear down child processes if the host shuts down cleanly.
      if (
        typeof process !== "undefined" &&
        typeof process.once === "function" &&
        !(globalThis as any).__agentNativeMcpExitHooked
      ) {
        (globalThis as any).__agentNativeMcpExitHooked = true;
        const stop = () => {
          const mgr = getGlobalMcpManager();
          // Shutdown is best-effort — a rejection here must not surface as
          // an unhandled promise rejection during process exit.
          if (mgr) mgr.stop().catch(() => {});
        };
        process.once("exit", stop);
        process.once("SIGTERM", stop);
        process.once("SIGINT", stop);
      }

      // Resolve actions — prefer explicit `actions`, fall back to deprecated
      // `scripts`. When neither is provided, auto-discover from the filesystem
      // so templates that forget to pass `actions` still work in non-serverless
      // deployments (serverless bundles need explicit imports).
      const rawActions = options?.actions ?? options?.scripts;
      // `*All` holds every discovered action including those that opted out of
      // agent exposure with `agentTool: false`. The agent-facing surfaces below
      // use the `filterAgentTools`-filtered `templateScripts`/`discoveredActions`
      // derived after discovery; `httpActions` keeps the full `*All` sets so
      // agent-hidden actions stay callable from the frontend / HTTP.
      let templateScriptsAll: Record<string, ActionEntry> =
        typeof rawActions === "function"
          ? await rawActions()
          : (rawActions ?? {});
      if (!rawActions && Object.keys(templateScriptsAll).length === 0) {
        try {
          const { autoDiscoverActions } = await import("./action-discovery.js");
          templateScriptsAll = await autoDiscoverActions("auto");
        } catch {
          // Filesystem discovery unavailable (serverless bundle) — skip.
        }
      }

      // Resource, chat, docs, db, and cross-agent scripts are available in both prod and dev modes
      const resourceScripts = await createResourceScriptEntries();
      const docsScripts = await createDocsScriptEntries();
      const dbScripts = await createDbScriptEntries();
      const refreshScreenTool = createRefreshScreenEntry();
      const frameworkContextTool = createFrameworkContextEntry();
      const leanPrompt = options?.leanPrompt === true;
      const lazyContext = options?.lazyContext !== false && !leanPrompt;
      const urlTools = createUrlTools();
      const engineScripts = await createAgentEngineScriptEntries(
        options?.appId,
      );
      const loopSettingsScripts = await createAgentLoopSettingsScriptEntries();
      const chatScripts = {
        ...(await createChatScriptEntries()),
        ...engineScripts,
        ...loopSettingsScripts,
      };
      const callAgentScript = await createCallAgentScriptEntry(options?.appId);
      const browserTools = createBuilderBrowserTool({
        getOrigin: () =>
          getRequestRunContext()?.requestOrigin ?? "http://localhost:3000",
        getOwner: () => getRequestRunContext()?.owner ?? getRequestUserEmail(),
      });

      // Auto-mount A2A protocol endpoints so every app is discoverable
      // and callable by other agents via the standard protocol.
      // In dev mode, include dev scripts (filesystem-discovered) so the A2A agent
      // has access to the same tools as the interactive agent.
      let devScriptsForA2A: Record<string, ActionEntry> = {};
      let discoveredActionsAll: Record<string, ActionEntry> = {};
      if (canToggle) {
        try {
          const { createDevScriptRegistry } =
            await import("../scripts/dev/index.js");
          devScriptsForA2A = await createDevScriptRegistry();
        } catch {}

        // Auto-discover template action files and register as bash-based tools.
        // This ensures templates without a custom agent-chat plugin (e.g., analytics)
        // still have their domain actions available as tools.
        try {
          const pathMod = await import("path");
          const cwd = process.cwd();
          const skipFiles = new Set([
            "helpers",
            "run",
            "registry",
            "_utils",
            "db-connect",
            "db-status",
          ]);

          for (const dir of ["actions", "scripts"]) {
            const actionsDir = pathMod.join(cwd, dir);
            const _fs = await lazyFs();
            if (!_fs.existsSync(actionsDir)) continue;
            const files = _fs
              .readdirSync(actionsDir)
              .filter(
                (f: string) =>
                  f.endsWith(".ts") &&
                  !f.startsWith("_") &&
                  !skipFiles.has(f.replace(/\.ts$/, "")),
              );
            for (const file of files) {
              const name = file.replace(/\.ts$/, "");
              if (templateScriptsAll[name] || devScriptsForA2A[name]) continue;

              // Try to load the action module directly so we get the real
              // run function (not a shell wrapper). This makes HTTP endpoints
              // work correctly. Only fall back to shell wrapper if the import
              // fails (e.g., CLI-style scripts that throw at top level).
              const filePath = pathMod.join(actionsDir, file);
              try {
                const mod = await import(/* @vite-ignore */ filePath);
                const def =
                  mod.default && typeof mod.default === "object"
                    ? mod.default
                    : mod;
                if (def?.tool && typeof def.run === "function") {
                  discoveredActionsAll[name] = {
                    tool: def.tool,
                    run: def.run,
                    ...(def.http !== undefined ? { http: def.http } : {}),
                    ...(typeof def.agentTool === "boolean"
                      ? { agentTool: def.agentTool }
                      : {}),
                  };
                  continue;
                }
              } catch {
                // Fall through to shell wrapper for CLI-style scripts
                // (and .ts files Node can't parse natively).
              }

              // Static-parse the source for `http: false` or
              // `http: { method: "GET" }` so the shell-wrapper fallback still
              // mounts HTTP routes with the correct method. We can't load the
              // .ts module to read the real defineAction object in this Node
              // context, so this regex sniff is the best we can do until the
              // discovery is moved into a Vite-aware codepath.
              let httpConfig: ActionHttpConfig | false | undefined;
              // Sniff `agentTool: false` the same way so a CLI-style action can
              // opt out of agent exposure even on the shell-wrapper fallback path.
              let agentToolFlag: boolean | undefined;
              try {
                const src = _fs.readFileSync(filePath, "utf-8");
                if (/\bagentTool\s*:\s*false\b/.test(src)) {
                  agentToolFlag = false;
                }
                if (/\bhttp\s*:\s*false\b/.test(src)) {
                  httpConfig = false;
                } else {
                  const httpStart = src.search(/\bhttp\s*:\s*\{/);
                  if (httpStart >= 0) {
                    const window = src.slice(httpStart, httpStart + 200);
                    const m = window.match(
                      /method\s*:\s*['"`](GET|POST|PUT|DELETE)['"`]/,
                    );
                    const p = window.match(/path\s*:\s*['"`]([^'"`]+)['"`]/);
                    if (m || p) {
                      httpConfig = {
                        ...(m
                          ? {
                              method: m[1] as "GET" | "POST" | "PUT" | "DELETE",
                            }
                          : {}),
                        ...(p ? { path: p[1] } : {}),
                      };
                    }
                  }
                }
              } catch {
                // File read failed — leave httpConfig undefined (default POST)
              }

              // Fallback: bash-based wrapper for CLI-style scripts
              discoveredActionsAll[name] = {
                tool: {
                  description: `Run the ${name} action. Use: pnpm action ${name} --arg=value`,
                  parameters: {
                    type: "object",
                    properties: {
                      args: {
                        type: "string",
                        description:
                          "CLI arguments as a string (e.g., --metrics=sessions --days=7)",
                      },
                    },
                  },
                },
                run: async (input: Record<string, string>) => {
                  const bashEntry =
                    devScriptsForA2A.bash ?? devScriptsForA2A.shell;
                  if (!bashEntry) return "Error: bash not available";
                  return bashEntry.run({
                    command: `pnpm action ${name} ${input.args || ""}`.trim(),
                  });
                },
                ...(httpConfig !== undefined ? { http: httpConfig } : {}),
                ...(typeof agentToolFlag === "boolean"
                  ? { agentTool: agentToolFlag }
                  : {}),
              };
            }
          }
          if (Object.keys(discoveredActionsAll).length > 0 && process.env.DEBUG)
            console.log(
              `[agent-chat] Auto-discovered ${Object.keys(discoveredActionsAll).length} action(s): ${Object.keys(discoveredActionsAll).join(", ")}`,
            );
        } catch {}
      }

      // Agent-facing views of the discovered actions: actions that opted out of
      // agent exposure with `agentTool: false` are dropped from every tool
      // surface, prompt, MCP/A2A list, and job/trigger runner below. The full
      // `*All` sets are reserved for `httpActions`, which keeps agent-hidden
      // actions reachable from the frontend / HTTP.
      const templateScripts = filterAgentTools(templateScriptsAll);
      const discoveredActions = filterAgentTools(discoveredActionsAll);
      // Per-request owner is read from the AsyncLocalStorage run context
      // (populated by prepareRun). Module-scope `let` would race across
      // concurrent requests on a long-lived Node process — overlapping
      // tool calls would observe whichever request wrote last. ALS gives
      // each async call-chain its own view of the owner.
      //
      // Falls back to `getRequestUserEmail()` so callers that wrap work
      // in `runWithRequestContext({ userEmail }, …)` without going through
      // `prepareRun` (recurring jobs, trigger dispatcher) still see the
      // correct owner.
      //
      // SECURITY: returns `null` when neither the run context nor the
      // request user-email is populated. Consumers MUST short-circuit
      // with an explicit error rather than fall back to a sentinel
      // identity (e.g. DEV_MODE_USER_EMAIL). The previous fallback to
      // `local@localhost` slipped past `guard-no-localhost-fallback`
      // because the literal was hidden behind a symbolic alias —
      // any agent loop that reached this code without a populated
      // session would resolve `${keys.NAME}` against the dev-shim's
      // `app_secrets WHERE scope_id='local@localhost'` rows. See
      // audit 02 (HIGH: getCurrentRunOwner) and the
      // 2026-04-29 credentials-leak incident for the prior shape.
      const getCurrentRunOwner = (): string | null =>
        getRequestRunContext()?.owner ?? getRequestUserEmail() ?? null;
      const requireCurrentRunOwner = (operation: string): string => {
        const owner = getCurrentRunOwner();
        if (!owner) {
          throw new Error(
            `[agent-chat] No authenticated owner in run context — ` +
              `refusing to ${operation}. Ensure the request goes through ` +
              `prepareRun() or is wrapped in runWithRequestContext({ userEmail, ... }).`,
          );
        }
        return owner;
      };

      // Automation tools + fetch tool — depend on owner via callback.
      // Each callback short-circuits with a clear error when the run context
      // has no authenticated owner (see SECURITY note on getCurrentRunOwner).
      let automationTools: Record<string, ActionEntry> = {};
      try {
        const { createAutomationToolEntries } =
          await import("../triggers/actions.js");
        automationTools = createAutomationToolEntries(() =>
          requireCurrentRunOwner("manage automations"),
        );
      } catch {}
      let notificationTools: Record<string, ActionEntry> = {};
      try {
        const { createNotificationToolEntries } =
          await import("../notifications/actions.js");
        notificationTools = createNotificationToolEntries(() =>
          requireCurrentRunOwner("manage notifications"),
        );
      } catch {}
      let progressTools: Record<string, ActionEntry> = {};
      try {
        const { createProgressToolEntries } =
          await import("../progress/actions.js");
        progressTools = createProgressToolEntries(() =>
          requireCurrentRunOwner("manage progress"),
        );
      } catch {}
      let fetchTool: Record<string, ActionEntry> = {};
      try {
        const { createFetchToolEntry } =
          await import("../extensions/fetch-tool.js");
        const { resolveKeyReferences, validateUrlAllowlist, getKeyAllowlist } =
          await import("../secrets/substitution.js");
        fetchTool = createFetchToolEntry({
          resolveKeys: async (text) =>
            resolveKeyReferences(
              text,
              "user",
              requireCurrentRunOwner("resolve key references"),
            ),
          validateUrl: async (url, usedKeys) => {
            for (const keyName of usedKeys) {
              const allowlist = await getKeyAllowlist(
                keyName,
                "user",
                requireCurrentRunOwner("validate URL allowlist"),
              );
              if (allowlist && !validateUrlAllowlist(url, allowlist)) {
                return false;
              }
            }
            return true;
          },
        });
      } catch {}
      let webSearchTool: Record<string, ActionEntry> = {};
      try {
        const { createWebSearchToolEntry } =
          await import("../extensions/web-search-tool.js");
        const {
          getBuilderWebSearchBaseUrl,
          resolveBuilderCredentials,
          resolveSecret,
        } = await import("./credential-provider.js");
        const { getBuilderGatewayRequestHeaders } =
          await import("../agent/engine/builder-gateway-headers.js");
        webSearchTool = createWebSearchToolEntry({
          resolveSecret,
          resolveBuilderCredentials,
          getBuilderWebSearchBaseUrl,
          getBuilderRequestHeaders: getBuilderGatewayRequestHeaders,
        });
      } catch {}
      let workspaceFilesTool: Record<string, ActionEntry> = {};
      try {
        const { createWorkspaceFilesTool } =
          await import("../workspace-files/tool.js");
        workspaceFilesTool = createWorkspaceFilesTool();
      } catch {}
      let toolActions: Record<string, ActionEntry> = {};
      try {
        const { createExtensionActionEntries } =
          await import("../extensions/actions.js");
        toolActions = createExtensionActionEntries();
      } catch {}
      let browserSessionTools: Record<string, ActionEntry> = {};
      try {
        const { createBrowserSessionActionEntries } =
          await import("../browser-sessions/actions.js");
        browserSessionTools = createBrowserSessionActionEntries({
          getOwnerEmail: () => requireCurrentRunOwner("use browser sessions"),
        });
      } catch {}

      // Core send-email tool — only registered when RESEND_API_KEY or
      // SENDGRID_API_KEY is set. Keyed "core-send-email" to avoid colliding
      // with the mail template's richer "send-email" action (template wins
      // when both surfaces spread into the same object, but distinct keys
      // keep both visible and avoid silent shadowing).
      let coreEmailTools: Record<string, ActionEntry> = {};
      try {
        const { createCoreEmailActionEntries } =
          await import("./email-actions.js");
        coreEmailTools = createCoreEmailActionEntries();
      } catch {}

      // Core read-attachment tool — always registered so the agent can page
      // through large text/CSV/code attachments that were truncated in context.
      let coreAttachmentTools: Record<string, ActionEntry> = {};
      try {
        const { createCoreAttachmentActionEntries } =
          await import("./attachment-actions.js");
        coreAttachmentTools = createCoreAttachmentActionEntries();
      } catch {}

      // -----------------------------------------------------------------------
      // Production code-execution mode resolution.
      //
      // Priority (highest -> lowest):
      //   1. AGENT_PROD_CODE_EXECUTION env var ("trusted" | "sandboxed" | "off")
      //   2. options.codeExecution.production
      //   3. Default: "off"
      //
      // Dev mode ignores this entirely: dev always gets the run-code sandbox.
      // Build these tools before A2A/MCP registries so every agent-loop surface
      // has the same code execution capability when enabled.
      // -----------------------------------------------------------------------
      const rawEnvCodeExec = (process.env.AGENT_PROD_CODE_EXECUTION ?? "")
        .toLowerCase()
        .trim();
      const resolvedProdCodeExec: "off" | "sandboxed" | "trusted" =
        rawEnvCodeExec === "trusted"
          ? "trusted"
          : rawEnvCodeExec === "sandboxed"
            ? "sandboxed"
            : rawEnvCodeExec === "off"
              ? "off"
              : (options?.codeExecution?.production ?? "off");

      // Forward-declaration for the production run-code bridge supplier.
      // Must come before createRunCodeEntry so the closure can capture it.
      let prodRunCodeToolActions: Record<string, ActionEntry> = {};
      let leanRunCodeToolActions: Record<string, ActionEntry> = {};

      // Sandboxed run-code tool: available in "sandboxed" or "trusted" prod
      // modes and always in dev mode.
      const runCodeTool: Record<string, ActionEntry> = {};
      const leanRunCodeTool: Record<string, ActionEntry> = {};
      try {
        const { createRunCodeEntry } =
          await import("../coding-tools/run-code.js");
        runCodeTool["run-code"] = createRunCodeEntry(
          // Supplier is evaluated at invocation time so runtime additions to
          // prodActions (e.g. MCP sync) are visible to the bridge.
          () => prodRunCodeToolActions,
          { bridgeTools: options?.codeExecution?.bridgeTools },
        );
        leanRunCodeTool["run-code"] = createRunCodeEntry(
          // Lean prompt mode intentionally exposes a much smaller action
          // surface; keep sandbox appAction() calls scoped to that same surface.
          () => leanRunCodeToolActions,
          { bridgeTools: options?.codeExecution?.bridgeTools },
        );
      } catch {
        // Module unavailable (e.g. bundled browser build) — skip silently.
      }

      // Full coding tool registry (bash/read/edit/write) for "trusted" prod.
      // In dev mode this is handled separately via devHandler below.
      const prodCodingTools: Record<string, ActionEntry> = {};
      if (resolvedProdCodeExec === "trusted" && !canToggle) {
        try {
          const { createCodingToolRegistry } =
            await import("../coding-tools/index.js");
          const codingRegistry = createCodingToolRegistry({
            cwd: process.cwd(),
            beforeBash: async ({ command: _command }) => {
              // In plan mode the agent loop blocks via isPlanModeToolCallAllowed;
              // this hook is a belt-and-suspenders guard inside trusted production.
              return null;
            },
          });
          Object.assign(prodCodingTools, codingRegistry);
        } catch {
          // Coding tools unavailable — skip silently.
        }
      }

      // Forward-declaration: populated after devActions is assembled below.
      // Must be declared before devRunCodeTool so the closure can close over it.
      let devRunCodeToolActions: Record<string, ActionEntry> = {};

      // Always register run-code in dev mode (when the coding module loads).
      const devRunCodeTool: Record<string, ActionEntry> = {};
      if (canToggle) {
        try {
          const { createRunCodeEntry } =
            await import("../coding-tools/run-code.js");
          // devActions is not yet defined at this point; we use a late-binding
          // supplier so devRunCodeTool can reference the devActions registry
          // once it is built below (see devHandler block).
          devRunCodeTool["run-code"] = createRunCodeEntry(
            () => devRunCodeToolActions,
            { bridgeTools: options?.codeExecution?.bridgeTools },
          );
        } catch {}
      }

      const resolveExtraContext = async (
        event: any,
        owner: string,
      ): Promise<string> => {
        if (!options?.extraContext) return "";
        try {
          const extra = await options.extraContext(event, owner);
          return extra ? `\n\n${extra}` : "";
        } catch (err) {
          console.warn(
            "[agent-chat] extraContext threw:",
            err instanceof Error ? err.message : err,
          );
          return "";
        }
      };

      // In dev mode, template actions (templateScripts and discoveredActions) are
      // NOT registered as native tools — the agent invokes them via bash instead.
      // This avoids degenerate empty-object tool calls that Anthropic models
      // sometimes emit for actions with complex schemas. Production keeps the
      // native registration since it has no shell access.
      const allScripts = attachToolSearch(
        canToggle
          ? {
              ...filterPublicAgentActions(templateScripts),
              ...resourceScripts,
              ...docsScripts,
              ...(lazyContext ? frameworkContextTool : {}),
              ...urlTools,
              ...chatScripts,
              ...callAgentScript,
              ...automationTools,
              ...notificationTools,
              ...progressTools,
              ...fetchTool,
              ...webSearchTool,
              ...workspaceFilesTool,
              ...toolActions,
              ...browserSessionTools,
              ...coreEmailTools,
              ...coreAttachmentTools,
              ...browserTools,
              ...devScriptsForA2A,
              ...devRunCodeTool,
            }
          : {
              ...discoveredActions,
              ...templateScripts,
              ...resourceScripts,
              ...docsScripts,
              ...dbScripts,
              ...refreshScreenTool,
              ...(lazyContext ? frameworkContextTool : {}),
              ...urlTools,
              ...chatScripts,
              ...callAgentScript,
              ...automationTools,
              ...notificationTools,
              ...progressTools,
              ...fetchTool,
              ...webSearchTool,
              ...workspaceFilesTool,
              ...toolActions,
              ...browserSessionTools,
              ...coreEmailTools,
              ...coreAttachmentTools,
              ...browserTools,
              ...devScriptsForA2A,
              ...(resolvedProdCodeExec !== "off" ? runCodeTool : {}),
              ...prodCodingTools,
            },
      );

      // Full ("production") MCP surface served to an authenticated *real
      // caller* — a connect-minted token, an `agent-native mcp install` stdio
      // proxy, or a deployed / AGENT_MODE=production app — even in local dev.
      // `allScripts` above is intentionally the sparse, dev-toggled surface
      // (builtins + read-only public-agent actions) used by the local agent
      // chat and unauthenticated dev probes; per the external-agents contract
      // a caller that connected with a token MUST get the full surface (so
      // `create-document` etc. are callable over MCP). Only needed when
      // `canToggle` (dev/test): in production `allScripts` already IS this
      // composition, so leave it undefined and `mountMCP` skips the swap.
      const mcpFullActions = canToggle
        ? attachToolSearch({
            ...discoveredActions,
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...dbScripts,
            ...refreshScreenTool,
            ...(lazyContext ? frameworkContextTool : {}),
            ...urlTools,
            ...chatScripts,
            ...callAgentScript,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
            ...webSearchTool,
            ...workspaceFilesTool,
            ...toolActions,
            ...browserSessionTools,
            ...coreEmailTools,
            ...coreAttachmentTools,
            ...browserTools,
            ...devScriptsForA2A,
            ...devRunCodeTool,
          })
        : undefined;

      const { mountA2A } = await import("../a2a/server.js");
      mountA2A(nitroApp, {
        name: options?.appId
          ? options.appId.charAt(0).toUpperCase() + options.appId.slice(1)
          : "Agent",
        description: `Agent-native ${options?.appId ?? "app"} agent`,
        skills: buildPublicAgentA2ASkills(allScripts),
        publicSkillsOnly: true,
        streaming: true,
        handler: async function* (message, context) {
          // Resolve the caller's identity for user-scoped data access.
          // Priority: A2A-JWT verified email (set by the A2A handler in
          // request-context) > dev session DB (dev only) > Google OAuth
          // tokeninfo (prod only). Without the JWT-verified-email path,
          // cross-app A2A calls landed owned by `local@localhost` (dev) or
          // `dispatch@shared`, which made resources invisible to the actual
          // signed-in user.
          //
          // SECURITY: we deliberately do NOT trust `context.metadata.userEmail`
          // as a fallback. The A2A endpoint runs in three modes — JWT-signed
          // (verified email lands in request context), API-key (caller is
          // app-authenticated but NOT user-authenticated), and unsigned
          // (no auth at all). Trusting caller-supplied metadata on the latter
          // two paths would let any reachable caller forge `metadata.userEmail`
          // and impersonate an arbitrary user. The JWT path already populates
          // the request context, so the metadata fallback was only ever used
          // on the unauthenticated paths — exactly where it's unsafe.
          const isDev = process.env.NODE_ENV !== "production";
          let userEmail: string | undefined;

          // 1. JWT-verified email from A2A receiver (auth boundary already
          //    enforced upstream). Works in dev AND prod.
          try {
            const { getRequestUserEmail } =
              await import("./request-context.js");
            userEmail = getRequestUserEmail();
          } catch {}

          // Dev-mode-only: when no JWT-verified email is present, fall back
          // to the most recently logged-in session. This is convenient for a
          // single-developer dev box but is a silent-impersonation hole if
          // it ever fires in production or on an exposed dev environment
          // (preview deploys, ngrok tunnels, etc.).
          //
          // SECURITY: gate this fallback narrowly:
          //   - NODE_ENV strictly === "development" (not "test", not unset).
          //   - AUTH_MODE === "local" (the dev-only auth shim).
          //   - Request host is localhost / 127.0.0.1 (best-effort: when the
          //     A2A handler doesn't have direct H3 event access, we rely on
          //     env-based shape checks).
          //
          // In production this MUST never fire — the runtime assertion
          // below crashes loud if NODE_ENV === "production" somehow reaches
          // this block.
          if (!userEmail && isDev) {
            if (process.env.NODE_ENV === "production") {
              throw new Error(
                "[agent-chat] Dev-mode 'latest session' fallback reached in production — refusing.",
              );
            }
            const strictlyDev = process.env.NODE_ENV === "development";
            const localAuthMode = process.env.AUTH_MODE === "local";
            // Request host check: rely on the request-context request origin
            // which prepareRun() / mountActionRoutes populate. The A2A
            // handler doesn't have direct H3 event access, but on a
            // misconfigured non-localhost dev box we still want to refuse.
            let isLocalHost = false;
            try {
              const origin = getRequestRunContext()?.requestOrigin;
              if (origin) {
                const url = new URL(origin);
                isLocalHost =
                  url.hostname === "localhost" ||
                  url.hostname === "127.0.0.1" ||
                  url.hostname === "::1";
              } else {
                // No origin in context — the A2A handler runs without an
                // explicit request origin. Treat absence as permissive only
                // when we're confident the process is dev-only (NODE_ENV
                // strictly "development" + AUTH_MODE=local). Otherwise
                // refuse.
                isLocalHost = strictlyDev && localAuthMode;
              }
            } catch {
              isLocalHost = false;
            }
            if (strictlyDev && localAuthMode && isLocalHost) {
              try {
                const { getDbExec } = await import("../db/client.js");
                const db = getDbExec();
                const { rows } = await db.execute({
                  sql: "SELECT email FROM sessions ORDER BY created_at DESC LIMIT 1",
                  args: [],
                });
                if (rows[0]) userEmail = rows[0].email as string;
              } catch {}
            }
          }

          if (!userEmail && !isDev) {
            const googleToken = context.metadata?.googleToken as string;
            if (googleToken) {
              try {
                const res = await fetch(
                  `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`,
                );
                if (res.ok) {
                  const info = (await res.json()) as {
                    email?: string;
                    email_verified?: string;
                  };
                  if (info.email && info.email_verified === "true") {
                    userEmail = info.email;
                  }
                }
              } catch {}
            }
          }

          const text = message.parts
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )
            .map((p) => p.text)
            .join("\n");

          if (!text) {
            yield {
              role: "agent" as const,
              parts: [
                { type: "text" as const, text: "No text content in message" },
              ],
            };
            return;
          }

          if (!userEmail) throw new Error("no authenticated user");

          const fallbackResponse = await options?.a2aMessageFallback?.({
            message,
            text,
            context,
            userEmail,
          });
          if (fallbackResponse) {
            yield typeof fallbackResponse === "string"
              ? {
                  role: "agent" as const,
                  parts: [{ type: "text" as const, text: fallbackResponse }],
                }
              : fallbackResponse;
            return;
          }

          // Use the SAME agent setup as the interactive chat — identical tools,
          // prompt, and capabilities. The A2A agent IS the app's agent.
          const a2aEngine = await resolveEngine({
            engineOption: options?.engine,
            apiKey: options?.apiKey,
            appId: options?.appId,
          });

          const devActive = isDevMode();

          // Build the same system prompt the interactive agent uses
          const owner = userEmail;
          const resources = await loadResourcesForPrompt(
            owner,
            lazyContext,
            options?.appId,
          );
          const schemaBlock = lazyContext
            ? ""
            : await buildSchemaBlock(owner, devActive);
          const extra = await resolveExtraContext(context.event, owner);
          const runtimeContext = runtimeContextForEvent(context.event);
          const systemPrompt = devActive
            ? devPrompt + runtimeContext + resources + schemaBlock + extra
            : basePrompt + runtimeContext + resources + schemaBlock + extra;

          const a2aModelCandidate =
            options?.model ??
            (await getStoredModelForEngine(a2aEngine, {
              appId: options?.appId,
            })) ??
            a2aEngine.defaultModel;
          const model = normalizeModelForEngine(a2aEngine, a2aModelCandidate);

          // Build tools — same as interactive handler but WITHOUT call-agent
          // to prevent infinite recursive A2A loops (agent calling itself).
          // In dev mode, template actions are invoked via bash (not native tools),
          // so they're omitted from the tool registry — see allScripts comment.
          const a2aActions = attachToolSearch(
            devActive
              ? {
                  ...resourceScripts,
                  ...docsScripts,
                  ...(lazyContext ? frameworkContextTool : {}),
                  ...urlTools,
                  ...chatScripts,
                  ...fetchTool,
                  ...webSearchTool,
                  ...workspaceFilesTool,
                  ...toolActions,
                  ...browserSessionTools,
                  ...coreEmailTools,
                  ...coreAttachmentTools,
                  ...browserTools,
                  ...mcpActionEntries,
                  ...devScriptsForA2A,
                  ...devRunCodeTool,
                }
              : {
                  ...templateScripts,
                  ...resourceScripts,
                  ...docsScripts,
                  ...dbScripts,
                  ...refreshScreenTool,
                  ...(lazyContext ? frameworkContextTool : {}),
                  ...urlTools,
                  ...chatScripts,
                  ...fetchTool,
                  ...webSearchTool,
                  ...workspaceFilesTool,
                  ...toolActions,
                  ...browserSessionTools,
                  ...coreEmailTools,
                  ...coreAttachmentTools,
                  ...browserTools,
                  ...mcpActionEntries,
                  ...(resolvedProdCodeExec !== "off" ? runCodeTool : {}),
                  ...prodCodingTools,
                },
          );

          const a2aTools = actionsToEngineTools(a2aActions);

          const a2aMessages: EngineMessage[] = [
            { role: "user", content: [{ type: "text", text }] },
          ];

          // Run the SAME agent loop, then extract the final answer from the
          // event stream so pre-tool narration never leaks as the A2A result.
          const a2aEvents: AgentChatEvent[] = [];
          const a2aToolResults: Array<{ tool: string; result: string }> = [];
          let lastRecoverableArtifactText = "";
          const controller = new AbortController();

          console.log(
            `[A2A] Starting agent loop: ${a2aTools.length} tools, prompt ${systemPrompt.length} chars`,
          );

          await runAgentLoopDirectWithSoftTimeout(
            {
              engine: a2aEngine,
              model,
              systemPrompt,
              tools: a2aTools,
              messages: a2aMessages,
              actions: a2aActions,
              send: (event) => {
                a2aEvents.push(event);
                if (event.type === "tool_start") {
                  console.log(`[A2A] Tool call: ${event.tool}`);
                } else if (event.type === "tool_done") {
                  a2aToolResults.push({
                    tool: event.tool,
                    result: event.result,
                  });
                  const recoverableArtifactText =
                    buildA2ARecoverableArtifactMessage(a2aToolResults, {
                      baseUrl: resolveArtifactBaseUrl(context.event),
                    });
                  if (
                    recoverableArtifactText &&
                    recoverableArtifactText !== lastRecoverableArtifactText
                  ) {
                    lastRecoverableArtifactText = recoverableArtifactText;
                    updateTaskStatusMessage(context.taskId, {
                      role: "agent",
                      metadata: { agentNativeRecoverableArtifacts: true },
                      parts: [
                        {
                          type: "text",
                          text: recoverableArtifactText,
                        },
                      ],
                    }).catch((err) => {
                      console.error(
                        `[A2A] Failed to persist recoverable artifact message for task ${context.taskId}:`,
                        err,
                      );
                    });
                  }
                } else if (event.type === "error") {
                  console.error(`[A2A] Error: ${event.error}`);
                } else if (event.type === "done") {
                  console.log(`[A2A] Done. Events: ${a2aEvents.length}`);
                }
              },
              signal: controller.signal,
            },
            options?.runSoftTimeoutMs,
          );

          const { responseText, finalText } = assembleA2AFinalResponse(
            a2aEvents,
            a2aToolResults,
            { event: context.event },
          );

          console.log(
            `[A2A] Loop complete. Text: ${responseText.slice(0, 100)}...`,
          );

          // Yield the final accumulated text
          yield {
            role: "agent" as const,
            parts: [
              {
                type: "text" as const,
                text: finalText || "(no response)",
              },
            ],
          };
        },
      });

      // Generate an "Available Actions" section from template-specific actions
      // so the agent knows to use them instead of raw SQL.
      //
      // Production: actions are native tools — emit `name(arg*: type) — desc`
      // Dev: actions are invoked via bash — emit `pnpm action name --arg <type>`
      //      and include discoveredActions too, since those are also missing
      //      from the dev tool registry.
      const corpusToolsPrompt = generateCorpusToolsPrompt({
        ...templateScripts,
        ...(canToggle
          ? devRunCodeTool
          : resolvedProdCodeExec !== "off"
            ? runCodeTool
            : {}),
      });
      const prodActionsPrompt =
        generateActionsPrompt(templateScripts, "tool") + corpusToolsPrompt;
      const devActionsPrompt =
        generateActionsPrompt(
          { ...discoveredActions, ...templateScripts },
          "cli",
        ) + corpusToolsPrompt;

      // Build system prompts — dynamic functions that pre-load resources per-request.
      // Production gets PROD_FRAMEWORK_PROMPT, dev gets DEV_FRAMEWORK_PROMPT.
      // Custom systemPrompt from options overrides the framework default entirely.
      const prodPrompt =
        (options?.systemPrompt ??
          (lazyContext
            ? PROD_FRAMEWORK_PROMPT_COMPACT
            : PROD_FRAMEWORK_PROMPT)) + prodActionsPrompt;
      // When template actions are registered as native tools in dev (via
      // `nativeActionsInDev` or `leanPrompt`), the dev prompt's "invoke
      // template actions via bash" guidance is wrong — use the prod prompt
      // + tool-format action list instead, same as production.
      const devNative = options?.nativeActionsInDev === true || leanPrompt;
      const devPrompt = devNative
        ? prodPrompt
        : (options?.devSystemPrompt
            ? options.devSystemPrompt +
              (options?.systemPrompt ??
                (lazyContext
                  ? PROD_FRAMEWORK_PROMPT_COMPACT
                  : PROD_FRAMEWORK_PROMPT))
            : lazyContext
              ? DEV_FRAMEWORK_PROMPT_COMPACT
              : DEV_FRAMEWORK_PROMPT) + devActionsPrompt;
      // Keep legacy names for the composition below
      const basePrompt = prodPrompt;

      if (options?.disableMcp !== true) {
        // Mount MCP remote server — same action registry as A2A + agent chat
        const { mountMCP } = await import("../mcp/server.js");
        mountMCP(nitroApp, {
          name: options?.appId
            ? options.appId.charAt(0).toUpperCase() + options.appId.slice(1)
            : "Agent",
          title: options?.mcpServerInfo?.title,
          appId: options?.appId,
          description:
            options?.mcpServerInfo?.description ??
            `Agent-native ${options?.appId ?? "app"} agent`,
          websiteUrl: options?.mcpServerInfo?.websiteUrl,
          icons: options?.mcpServerInfo?.icons,
          actions: allScripts,
          productionActions: mcpFullActions,
          ...(options?.connectorCatalog
            ? { connectorCatalog: options.connectorCatalog }
            : {}),
          askAgent: async (message: string) => {
            const mcpEngine = await resolveEngine({
              engineOption: options?.engine,
              apiKey: options?.apiKey,
              appId: options?.appId,
            });
            const mcpModelCandidate =
              options?.model ??
              (await getStoredModelForEngine(mcpEngine, {
                appId: options?.appId,
              })) ??
              mcpEngine.defaultModel;
            const model = normalizeModelForEngine(mcpEngine, mcpModelCandidate);

            // Same actions as A2A — without call-agent to prevent loops.
            // In dev mode, template actions go through bash, not native tools.
            const devActiveMcp = isDevMode();
            const mcpActions = attachToolSearch(
              devActiveMcp
                ? {
                    ...resourceScripts,
                    ...docsScripts,
                    ...(lazyContext ? frameworkContextTool : {}),
                    ...urlTools,
                    ...chatScripts,
                    ...fetchTool,
                    ...webSearchTool,
                    ...workspaceFilesTool,
                    ...toolActions,
                    ...mcpActionEntries,
                    ...devScriptsForA2A,
                    ...devRunCodeTool,
                  }
                : {
                    ...templateScripts,
                    ...resourceScripts,
                    ...docsScripts,
                    ...dbScripts,
                    ...refreshScreenTool,
                    ...(lazyContext ? frameworkContextTool : {}),
                    ...urlTools,
                    ...chatScripts,
                    ...fetchTool,
                    ...webSearchTool,
                    ...workspaceFilesTool,
                    ...toolActions,
                    ...mcpActionEntries,
                    ...(resolvedProdCodeExec !== "off" ? runCodeTool : {}),
                    ...prodCodingTools,
                  },
            );

            const mcpTools = actionsToEngineTools(mcpActions);

            const resources = await loadResourcesForPrompt(
              SHARED_OWNER,
              lazyContext,
              options?.appId,
            );
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(SHARED_OWNER, devActiveMcp);
            // Build the MCP handler's own prompt — always use the bash-based
            // dev prompt in dev mode because mcpActions routes template actions
            // through bash (`devScriptsForA2A`), regardless of `nativeActionsInDev`.
            const mcpDevPrompt =
              (options?.devSystemPrompt
                ? options.devSystemPrompt +
                  (options?.systemPrompt ??
                    (lazyContext
                      ? PROD_FRAMEWORK_PROMPT_COMPACT
                      : PROD_FRAMEWORK_PROMPT))
                : lazyContext
                  ? DEV_FRAMEWORK_PROMPT_COMPACT
                  : DEV_FRAMEWORK_PROMPT) + devActionsPrompt;
            const systemPrompt = devActiveMcp
              ? mcpDevPrompt +
                buildRuntimeContextPrompt() +
                resources +
                schemaBlock
              : basePrompt +
                buildRuntimeContextPrompt() +
                resources +
                schemaBlock;

            let accumulatedText = "";
            const controller = new AbortController();

            await runAgentLoopDirectWithSoftTimeout(
              {
                engine: mcpEngine,
                model,
                systemPrompt,
                tools: mcpTools,
                messages: [
                  { role: "user", content: [{ type: "text", text: message }] },
                ],
                actions: mcpActions,
                send: (event) => {
                  if (event.type === "text") accumulatedText += event.text;
                },
                signal: controller.signal,
              },
              options?.runSoftTimeoutMs,
            );

            return accumulatedText || "(no response)";
          },
        });
      }

      type OwnerContext = {
        owner: string;
        anonymous: boolean;
        name?: string;
      };
      const OWNER_CONTEXT_KEY = "__agentNativeOwnerContext";

      // Resolve owner from the H3 event's session, with an optional
      // template-provided anonymous owner for public read-only surfaces.
      const resolveOwnerContext = async (event: any): Promise<OwnerContext> => {
        const eventContext = event?.context as
          | (Record<string, unknown> & { [OWNER_CONTEXT_KEY]?: OwnerContext })
          | undefined;
        if (eventContext?.[OWNER_CONTEXT_KEY]) {
          return eventContext[OWNER_CONTEXT_KEY];
        }

        const session = await getSession(event);
        if (session?.email) {
          const resolved = {
            owner: session.email,
            anonymous: false,
            name: session.name,
          };
          if (eventContext) eventContext[OWNER_CONTEXT_KEY] = resolved;
          return resolved;
        }

        const anonymousOwner = await options?.anonymousOwner?.(event);
        if (anonymousOwner) {
          const resolved = { owner: anonymousOwner, anonymous: true };
          if (eventContext) eventContext[OWNER_CONTEXT_KEY] = resolved;
          return resolved;
        }

        const { createError } = await import("h3");
        throw createError({
          statusCode: 401,
          statusMessage: "Unauthenticated",
        });
      };

      const getOwnerFromEvent = async (event: any): Promise<string> => {
        return (await resolveOwnerContext(event)).owner;
      };
      const getUserNameFromEvent = async (
        event: any,
      ): Promise<string | undefined> => {
        return (await resolveOwnerContext(event)).name;
      };

      // Auto-mount template actions as HTTP endpoints under /_agent-native/actions/
      // Include engine management script so the UI can call manage-agent-engine.
      // HTTP/frontend surface keeps the full `*All` sets so actions with
      // `agentTool: false` (hidden from every agent tool list) remain callable
      // via `useActionMutation` / `callAction` / `/_agent-native/actions/<name>`.
      const httpActions: Record<string, ActionEntry> = {
        ...discoveredActionsAll,
        ...templateScriptsAll,
        ...engineScripts,
        ...loopSettingsScripts,
      };
      // Framework-level sharing actions — merged with skipExisting semantics so
      // any template that provides a same-named action wins. When templates use
      // `loadActionsFromStaticRegistry`, `autoDiscoverActions` never runs, so
      // this is the single point that guarantees share-resource, unshare-resource,
      // list-resource-shares, and set-resource-visibility are always mounted.
      try {
        const { mergeCoreSharingActions } =
          await import("./action-discovery.js");
        await mergeCoreSharingActions(httpActions);
      } catch {
        // Ignore — templates without sharing still work.
      }
      if (Object.keys(httpActions).length > 0) {
        const { mountActionRoutes } = await import("./action-routes.js");
        mountActionRoutes(nitroApp, httpActions, {
          getOwnerFromEvent,
          getUserNameFromEvent,
          resolveOrgId: options?.resolveOrgId,
        });
      }

      const preRunGitStatusByThread = new Map<string, string | null>();

      async function recordPreRunGitStatus(threadId: string): Promise<void> {
        if (!isDevMode()) return;
        try {
          const { getUncommittedStatus, isGitRepo } =
            await import("../checkpoints/service.js");
          const cwd = process.cwd();
          preRunGitStatusByThread.set(
            threadId,
            isGitRepo(cwd) ? getUncommittedStatus(cwd) : null,
          );
        } catch {
          preRunGitStatusByThread.set(threadId, null);
        }
      }

      // Callback to persist agent response when run finishes (even if client disconnected).
      // Reconstructs the assistant message from buffered events and appends to thread_data.
      const onRunComplete = async (run: any, threadId: string | undefined) => {
        const runThreadId = String(run?.threadId ?? threadId ?? "");
        if (!threadId) {
          if (runThreadId) preRunGitStatusByThread.delete(runThreadId);
          return;
        }
        // Serialize the read-modify-write against the same thread's other
        // `thread_data` writers (setThreadQueuedMessages, setThreadEngineMeta,
        // the frontend-triggered saves below). Without the lock, a concurrent
        // queued-message save can clobber the assistant message we just
        // appended here, or vice versa.
        await withThreadDataLock(threadId, async () => {
          try {
            const thread = await getThread(threadId);
            if (!thread) {
              throw new Error(
                `Agent chat thread ${threadId} was not found while saving run ${run.runId}.`,
              );
            }
            const runOwner =
              getRequestRunContext()?.owner ?? getRequestUserEmail();
            if (runOwner && thread.ownerEmail !== runOwner) {
              throw createError({
                statusCode: 404,
                statusMessage: "Thread not found",
              });
            }

            const assistantMsg = buildAssistantMessage(
              run.events ?? [],
              run.runId,
              {
                suppressInternalContinuation: true,
                turnId:
                  typeof run.turnId === "string" && run.turnId
                    ? run.turnId
                    : undefined,
              },
            );
            if (!assistantMsg) {
              // No content produced — just bump timestamp
              await updateThreadData(
                threadId,
                thread.threadData,
                thread.title,
                thread.preview,
                thread.messageCount,
              );
              return;
            }

            // Parse existing thread_data, append assistant message only if
            // the frontend hasn't already saved it (avoids duplicates when
            // the client is still connected during a normal flow).
            let repo: any;
            try {
              repo = JSON.parse(thread.threadData || "{}");
            } catch {
              repo = {};
            }
            if (!Array.isArray(repo.messages)) repo.messages = [];

            repo = foldAssistantTurn(repo, assistantMsg, {
              runId: run.runId,
              turnId:
                typeof run.turnId === "string" && run.turnId
                  ? run.turnId
                  : undefined,
            });

            // Store debug metadata so we can inspect what the LLM actually
            // received (system prompt, model, engine) when diagnosing issues.
            const runCtx = getRequestRunContext();
            const debug = {
              runId: run.runId,
              systemPrompt: runCtx?.systemPrompt,
              model: runCtx?.model ?? resolvedModel,
              engine: runCtx?.engine?.name ?? "unknown",
              timestamp: Date.now(),
            };
            repo._debug = debug;
            const debugRuns = Array.isArray(repo._debugRuns)
              ? repo._debugRuns
              : [];
            repo._debugRuns = [...debugRuns, debug].slice(-50);

            const meta = extractThreadMeta(repo);
            await updateThreadData(
              threadId,
              JSON.stringify(repo),
              meta.title || thread.title,
              meta.preview || thread.preview,
              repo.messages.length,
            );
          } catch (err) {
            // Run completion is only successful once thread_data is durable.
            throw err;
          }
        });

        // Keep SQL run completion gated only on durable thread data. Follow-up
        // hooks are useful, but they should never leave agent_runs stuck
        // "running" if an automation/checkpoint path stalls.
        void (async () => {
          // Emit agent.turn.completed for automation triggers.
          //
          // SECURITY: include `owner` so the trigger dispatcher's tenant-scope
          // check engages (see triggers/dispatcher.ts:212-218). Without an
          // owner, every user's matching `agent.turn.completed` trigger
          // would fire when ANY user's chat turn completes — cross-tenant
          // fan-out (audit 12 #9). Owner comes from the thread row when
          // available (most reliable; persisted at thread create time),
          // falling back to the current run context's owner. If neither
          // resolves we skip emission entirely rather than emit unowned.
          try {
            let ownerEmail: string | undefined;
            try {
              const ownerThread = await getThread(threadId);
              ownerEmail = ownerThread?.ownerEmail;
            } catch {
              // ignore — fall through to run-context owner
            }
            if (!ownerEmail) {
              ownerEmail = getRequestRunContext()?.owner;
            }
            if (ownerEmail) {
              const { emit } = await import("../event-bus/index.js");
              emit(
                "agent.turn.completed",
                { threadId, model: resolvedModel },
                { owner: ownerEmail },
              );
            }
          } catch {
            // Event bus not available — skip
          }

          // Auto-checkpoint in dev mode after file-modifying agent turns
          if (isDevMode()) {
            try {
              const {
                createCheckpoint: gitCheckpoint,
                isGitRepo,
                hasUncommittedChanges,
                getChangedFileNames,
                getUncommittedStatus,
              } = await import("../checkpoints/service.js");
              const cwd = process.cwd();
              const preRunStatus = runThreadId
                ? preRunGitStatusByThread.get(runThreadId)
                : undefined;
              if (runThreadId) preRunGitStatusByThread.delete(runThreadId);

              // Only auto-commit checkpoints for changes produced by this run.
              // If the tree was already dirty, a checkpoint commit would sweep
              // up the user's unrelated work when a reconnect/refresh finishes.
              const postRunStatus = getUncommittedStatus(cwd);
              if (
                preRunStatus === "" &&
                postRunStatus?.trim() &&
                isGitRepo(cwd) &&
                hasUncommittedChanges(cwd)
              ) {
                let summary = "";

                // Try to extract the first sentence of the assistant's text response
                let assistantText = "";
                for (const { event } of run.events ?? []) {
                  if (event.type === "text" && typeof event.text === "string") {
                    assistantText += event.text;
                  }
                }
                assistantText = assistantText.trim();
                if (assistantText) {
                  const firstSentence = assistantText
                    .split(/(?<=[.!?\n])\s/)[0]
                    ?.replace(/\n/g, " ")
                    .trim();
                  if (firstSentence && firstSentence.length <= 120) {
                    summary = firstSentence;
                  } else if (firstSentence) {
                    summary = firstSentence.slice(0, 117) + "...";
                  }
                }

                // Fall back to listing changed files
                if (!summary) {
                  const files = getChangedFileNames(cwd);
                  if (files.length > 0) {
                    summary = `Update ${files.join(", ")}`;
                  }
                }

                if (!summary) summary = "Agent turn";
                if (summary.length > 120)
                  summary = summary.slice(0, 117) + "...";

                const sha = gitCheckpoint(cwd, summary);
                if (sha) {
                  const { insertCheckpoint } =
                    await import("../checkpoints/store.js");
                  const cpId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  await insertCheckpoint(
                    cpId,
                    threadId,
                    run.runId,
                    sha,
                    summary,
                  );
                }
              }
            } catch {
              // Checkpointing is best-effort — never break the run
            }
          }
        })();
      };

      const persistSubmittedUserMessage = async (details: {
        runId: string;
        threadId: string | undefined;
        message: string;
        attachments?: AgentChatAttachment[];
      }) => {
        const threadId = details.threadId;
        if (!threadId) return;
        const ownerEmail =
          getRequestRunContext()?.owner ?? getRequestUserEmail();
        if (!ownerEmail) return;

        await withThreadDataLock(threadId, async () => {
          let thread = await getThread(threadId);
          if (!thread) {
            try {
              thread = await createThread(ownerEmail, { id: threadId });
            } catch {
              thread = await getThread(threadId);
            }
          }
          if (!thread || thread.ownerEmail !== ownerEmail) {
            throw createError({
              statusCode: 404,
              statusMessage: "Thread not found",
            });
          }

          let repo: any;
          try {
            repo = JSON.parse(thread.threadData || "{}");
          } catch {
            repo = {};
          }

          repo = upsertUserMessage(
            repo,
            buildUserMessage({
              text: details.message,
              attachments: details.attachments,
              runId: details.runId,
            }),
          );

          const meta = extractThreadMeta(repo);
          await updateThreadData(
            threadId,
            JSON.stringify(repo),
            meta.title || thread.title,
            meta.preview || thread.preview,
            Array.isArray(repo.messages)
              ? repo.messages.length
              : thread.messageCount,
          );
        });
      };

      // ─── Agent Teams: per-run send reference ─────────────────────────
      // Team tools need to emit events to the parent chat's SSE stream.
      // Each run gets its own send function, keyed by threadId so concurrent
      // requests for different threads don't clobber each other.
      const _runSendByThread = new Map<
        string,
        (event: import("../agent/types.js").AgentChatEvent) => void
      >();
      const resolvedModel = options?.model ?? DEFAULT_ANTHROPIC_MODEL;

      // The action set a sub-agent inherits. Shared between the spawn-time team
      // tool and the `_process-run` processor route below so the durable run
      // executes with exactly the tools the orchestrator intended.
      const buildSubAgentActions = (): Record<string, ActionEntry> =>
        isDevMode()
          ? {
              // Sub-agents spawned in dev mode also invoke template actions
              // via bash, so omit them from the native tool registry.
              ...resourceScripts,
              ...docsScripts,
              ...(lazyContext ? frameworkContextTool : {}),
              ...chatScripts,
              ...devScriptsForA2A,
            }
          : {
              ...templateScripts,
              ...resourceScripts,
              ...docsScripts,
              ...dbScripts,
              ...refreshScreenTool,
              ...(lazyContext ? frameworkContextTool : {}),
              ...urlTools,
              ...chatScripts,
            };

      const teamTools = createTeamTools({
        getOwner: () => requireCurrentRunOwner("spawn or manage sub-agents"),
        getSystemPrompt: () =>
          getRequestRunContext()?.systemPrompt ?? basePrompt,
        getActions: buildSubAgentActions,
        getEngine: () => {
          const runCtx = getRequestRunContext();
          return (
            runCtx?.engine ??
            createAnthropicEngine({
              // Sub-agents must inherit the parent run's resolved key so
              // delegations spawned by agent-teams don't silently fall back
              // to the platform key while the parent uses BYO credentials.
              apiKey:
                runCtx?.userApiKey ??
                options?.apiKey ??
                process.env.ANTHROPIC_API_KEY,
            })
          );
        },
        getModel: () => getRequestRunContext()?.model ?? resolvedModel,
        getParentThreadId: () => getRequestRunContext()?.threadId ?? "",
        getSend: () => {
          // Return the send for the current run's thread
          const threadId = getRequestRunContext()?.threadId ?? "";
          const send = _runSendByThread.get(threadId);
          return send ?? null;
        },
      });

      // Hook into the run lifecycle to set/clear the send reference.
      // Job management tool (manage-jobs)
      let jobTools: Record<string, ActionEntry> = {};
      try {
        const { createJobTools } = await import("../jobs/tools.js");
        jobTools = createJobTools();
      } catch {}

      // Lean mode: only template actions + essential framework tools. Drop
      // web-request, browser tools, teams, jobs, automations, notifications,
      // progress, call-agent, and MCP entries to keep the tool list tight and
      // prevent the LLM from reaching for web-request instead of the
      // template's native actions (e.g. log-meal).
      const leanActionEntries: Record<string, ActionEntry> = {
        ...templateScripts,
        ...resourceScripts,
        ...refreshScreenTool,
        ...urlTools,
        ...chatScripts,
        ...toolActions,
      };
      const anonymousReadOnlyActions = attachToolSearch(
        filterReadOnlyActions(templateScripts),
      );

      // Full-database admin tools. Gated on NODE_ENV=development to match the
      // DB-admin UI + HTTP routes (which gate on the environment, not the
      // Code-mode toggle), so the agent has the same DB-admin capability the UI
      // does whenever it is available — true agent/UI parity, in App or Code mode.
      const dbAdminScripts =
        process.env.NODE_ENV === "development" ? createDbAdminAgentTools() : {};

      const prodActions = attachToolSearch({
        ...templateScripts,
        ...resourceScripts,
        ...docsScripts,
        ...dbScripts,
        ...dbAdminScripts,
        ...refreshScreenTool,
        ...(lazyContext ? frameworkContextTool : {}),
        ...urlTools,
        ...chatScripts,
        ...callAgentScript,
        ...teamTools,
        ...jobTools,
        ...automationTools,
        ...notificationTools,
        ...progressTools,
        ...fetchTool,
        ...webSearchTool,
        ...workspaceFilesTool,
        ...toolActions,
        ...browserSessionTools,
        ...coreEmailTools,
        ...coreAttachmentTools,
        ...browserTools,
        ...mcpActionEntries,
        // Sandboxed run-code for hosted production when enabled, and for the
        // app-rendered production-style handler in local dev.
        ...(canToggle || resolvedProdCodeExec !== "off" ? runCodeTool : {}),
        // Full coding tools in production when mode is "trusted".
        ...(!canToggle ? prodCodingTools : {}),
      });

      // Wire the prod run-code bridge supplier so it sees the fully-assembled
      // prodActions registry (including MCP entries added at runtime).
      prodRunCodeToolActions = prodActions;

      const leanActions = attachToolSearch({
        ...leanActionEntries,
        // Lean mode still needs run-code when code execution is enabled.
        // Otherwise templates with a minimal prompt can advertise sandboxed
        // execution in the system prompt while the actual tool registry omits
        // it.
        ...(canToggle || resolvedProdCodeExec !== "off" ? leanRunCodeTool : {}),
      });
      leanRunCodeToolActions = leanActions;

      // Keep the prod action dict's MCP entries in sync when the manager's
      // server set changes at runtime (e.g. a user adds a remote MCP server
      // through the settings UI). getEngineTools() in production-agent re-reads
      // the registry per request, so updates here propagate without restart.
      mcpManager.onChange(() => {
        syncMcpActionEntries(mcpManager, prodActions);
      });

      // Always build the production handler (includes resource tools + call-agent + team tools)
      // In production mode (!canToggle), resolve the owner from the request session.
      const isHostedProd = !canToggle;

      // Lean mode: use only the template's systemPrompt + actions list.
      // Skip resource loading and schema block — those add DB round-trips
      // and tokens that minimal/voice apps don't need.
      const leanBasePrompt = (options?.systemPrompt ?? "") + prodActionsPrompt;
      const anonymousReadOnlyPrompt =
        (options?.systemPrompt ?? PROD_FRAMEWORK_PROMPT_COMPACT) +
        generateActionsPrompt(filterReadOnlyActions(templateScripts), "tool") +
        "\n\nYou are answering from a public shared page. Treat the visible resource as read-only: do not create, edit, delete, comment on, share, or otherwise mutate app data. If the user asks for a change, describe what you would change or suggest signing in to edit.";

      // Per-request preamble shared by both prod and dev handlers. Resolves
      // owner + user API key onto the AsyncLocalStorage run context so
      // downstream tool closures (automation, fetch, team) read the
      // current request's identity without racing against concurrent
      // requests. `extraContext` runs in every prompt variant (lean, lazy,
      // full) — if a template defined it, they opted in; framework-provided
      // content is what the token-saving modes strip.
      const prepareRun = async (event: any) => {
        const owner = await getOwnerFromEvent(event);
        const { getOwnerActiveApiKey } =
          await import("../agent/production-agent.js");
        const userApiKey = await getOwnerActiveApiKey(owner);
        const runCtx = ensureRequestRunContext();
        if (runCtx) {
          runCtx.requestOrigin = getOrigin(event);
          runCtx.owner = owner;
          runCtx.userApiKey = userApiKey;
        }
        const extra = await resolveExtraContext(event, owner);
        return { owner, extra };
      };

      const setSystemPromptOnContext = (prompt: string): string => {
        const runCtx = ensureRequestRunContext();
        if (runCtx) runCtx.systemPrompt = prompt;
        return prompt;
      };

      /**
       * Read the model family overlay for the currently-resolved model.
       * onEngineResolved sets runCtx.model before systemPrompt is called, so
       * this returns a non-empty string for GPT/Gemini engines.
       */
      const resolveModelOverlay = (): string => {
        const runCtx = ensureRequestRunContext();
        const model = runCtx?.model;
        if (!model) return "";
        return getModelFamilyOverlay(model);
      };

      /**
       * Returns whether this request is for a brand-new thread (no prior
       * messages). Used to gate the First-Session Personalization block:
       * once a thread has history the block is dead weight on every request.
       *
       * prepareRequest stashes `details.threadId` as `_requestThreadId` on
       * runCtx before systemPrompt is assembled. A new thread has no threadId
       * (the UI passes undefined until the first message creates the thread).
       */
      const isNewThread = (): boolean => {
        const runCtx = ensureRequestRunContext();
        return !(runCtx as any)?._requestThreadId;
      };

      const runtimeContextForEvent = (event: any): string => {
        const tzRaw = getHeader(event, "x-user-timezone");
        const timezone =
          typeof tzRaw === "string" &&
          tzRaw.trim().length > 0 &&
          tzRaw.trim().length < 64
            ? tzRaw.trim()
            : undefined;
        // Thread the ambient sub-agent delegation depth so a sub-agent running
        // at the depth cap is told in its runtime context that it cannot
        // delegate further. The depth-guard already enforces the cap
        // server-side (`evaluateSubagentDepth`); this only surfaces it to the
        // model. 0 (the top-level chat) emits no delegation line.
        const delegationDepth = getCurrentDelegationDepth();
        return buildRuntimeContextPrompt({ timezone, delegationDepth });
      };

      // The app-rendered sidebar must never edit the app's source code
      // directly. Source-file edits can trigger HMR or full reloads of the
      // same React tree that is hosting the chat, interrupting the run and
      // losing in-progress UI state. Code edits are allowed only from the
      // outer dev frame (x-agent-native-surface: dev-frame) or from separate
      // agent surfaces such as Builder/A2A/MCP handoffs.
      const shouldBlockInProductCodeEditing = (event: any): boolean =>
        shouldBlockInProductCodeEditingSurface({
          surface: getHeader(event, "x-agent-native-surface"),
          userAgent: getHeader(event, "user-agent"),
          host: getHeader(event, "host"),
        });

      const APP_RENDERED_CHAT_NO_DIRECT_CODE_PROMPT = `

<app-rendered-chat-no-direct-code-edits>
This chat is rendered by the app itself. It must never edit this app's source files directly, because source edits can hot-reload or replace the same UI that is hosting the chat.

When the user asks to add a feature, edit a component, fix a bug in the app itself, change styles, add a route, scaffold a new app, run shell commands that modify code, or do anything else that requires touching source files:

1. Do NOT use dev shell/filesystem tools, write code inline, list source files, propose patches, or describe file-level implementation steps from this chat.
2. For host-app source changes in Act mode, call \`connect-builder\` when that tool is available so a separate Builder/cloud agent can do the work. If Builder is unavailable, give a short handoff to the outer dev frame, Agent Native Desktop, Claude Code, or Codex in the project directory.
3. If the request is specifically to add or scaffold a new workspace app and no Builder handoff is available, mention \`npx @agent-native/core@latest add-app\` in this workspace directory as the CLI path.

Non-code requests are still fine on this surface: read data, navigate the UI, summarize, search, create/update extensions (sandboxed Alpine.js mini-apps stored in SQL), and call template actions. The restriction is specifically about direct edits to the host app's own source files.
</app-rendered-chat-no-direct-code-edits>`;

      // System-prompt note appended when production code execution is enabled.
      const prodCodeExecPromptNote =
        !canToggle && resolvedProdCodeExec !== "off"
          ? resolvedProdCodeExec === "trusted"
            ? "\n\n<code-execution-mode>Full shell access is enabled (trusted mode). You have bash, read, edit, write, and run-code tools available. Use bash for file discovery, running tests and builds, and project CLIs. Use run-code for sandboxed JavaScript data processing: provider/API pagination, joins, classification, aggregation, and large-response reduction. Use `pnpm action <name>` in bash to invoke registered app actions from the shell.</code-execution-mode>"
            : "\n\n<code-execution-mode>Sandboxed code execution is enabled. The run-code tool lets you execute isolated JavaScript (ESM, top-level await) to fetch, aggregate, and reduce data. Use providerFetch(), providerFetchAll(), providerRequest(), and webFetch() inside run-code for authenticated provider calls.</code-execution-mode>"
          : "";

      const prodHandler = createProductionAgentHandler({
        actions: leanPrompt ? leanActions : prodActions,
        systemPrompt: async (event: any) => {
          const { owner, extra } = await prepareRun(event);
          const runtimeContext = runtimeContextForEvent(event);
          const codeEditingSurfaceRestriction = shouldBlockInProductCodeEditing(
            event,
          )
            ? APP_RENDERED_CHAT_NO_DIRECT_CODE_PROMPT
            : "";
          // Personalization block: only include on new threads (no prior messages).
          // Once a thread exists, the agent has already run (or skipped) the flow.
          const personalizationBlock = isNewThread()
            ? FIRST_SESSION_PERSONALIZATION
            : "";
          // Per-model overlay: nudge GPT/Gemini engines toward our behavioral norms.
          const modelOverlay = resolveModelOverlay();
          if (leanPrompt) {
            return setSystemPromptOnContext(
              leanBasePrompt +
                runtimeContext +
                codeEditingSurfaceRestriction +
                prodCodeExecPromptNote +
                extra +
                modelOverlay,
            );
          }
          const resources = await loadResourcesForPrompt(
            owner,
            lazyContext,
            options?.appId,
          );
          // In lazy context mode, skip embedding the full schema — the agent
          // calls `db-schema` on demand. This saves ~1-2K tokens per request.
          const schemaBlock = lazyContext
            ? ""
            : await buildSchemaBlock(owner, false);
          return setSystemPromptOnContext(
            basePrompt +
              personalizationBlock +
              runtimeContext +
              resources +
              schemaBlock +
              codeEditingSurfaceRestriction +
              prodCodeExecPromptNote +
              extra +
              modelOverlay,
          );
        },
        model: options?.model,
        appId: options?.appId,
        apiKey: options?.apiKey,
        runSoftTimeoutMs: options?.runSoftTimeoutMs,
        finalResponseGuard: options?.finalResponseGuard,
        prepareRequest: async (details) => {
          // Stash the threadId on runCtx so systemPrompt can check isNewThread().
          // prepareRequest fires before systemPromptPromise starts, so this is safe.
          const runCtxForPrepare = ensureRequestRunContext();
          if (runCtxForPrepare && details.threadId) {
            (runCtxForPrepare as any)._requestThreadId = details.threadId;
          }

          // Drain any parent-completion injections queued by finished sub-agents
          // and prepend them to the user message so the orchestrator sees results
          // at the start of this turn rather than only after a manual poll.
          const threadId = details.threadId;
          let completionPrefix = "";
          if (threadId && !details.internalContinuation) {
            try {
              const {
                drainParentCompletionInjections,
                formatParentCompletionInjections,
              } = await import("./agent-teams.js");
              const injections =
                await drainParentCompletionInjections(threadId);
              if (injections.length > 0) {
                completionPrefix = formatParentCompletionInjections(injections);
              }
            } catch {
              // best-effort — never break the run
            }
          }
          // Also run the template-provided prepareRequest (if any).
          const templateResult = await options?.prepareRequest?.(details);
          if (!completionPrefix) return templateResult ?? undefined;
          const baseMessage =
            typeof templateResult === "object" &&
            templateResult &&
            typeof templateResult.message === "string"
              ? templateResult.message
              : details.message;
          const message = `${completionPrefix}\n\n${baseMessage}`;
          return {
            ...(typeof templateResult === "object" && templateResult
              ? templateResult
              : {}),
            message,
          };
        },
        skipFilesContext: leanPrompt,
        ...(options?.toolLimits ? { toolLimits: options.toolLimits } : {}),
        onEngineResolved: (engine, model) => {
          const runCtx = ensureRequestRunContext();
          if (runCtx) {
            runCtx.engine = engine;
            runCtx.model = model;
          }
        },
        onRunPrepared: persistSubmittedUserMessage,
        onRunStart: async (
          send: (event: import("../agent/types.js").AgentChatEvent) => void,
          threadId: string,
        ) => {
          await recordPreRunGitStatus(threadId);
          _runSendByThread.set(threadId, send);
          const runCtx = ensureRequestRunContext();
          if (runCtx) runCtx.threadId = threadId;
        },
        onRunComplete: async (run: any, threadId: string | undefined) => {
          if (threadId) _runSendByThread.delete(threadId);
          await onRunComplete(run, threadId);
        },
        // Resolve owner from session for usage attribution in hosted prod
        resolveOwnerEmail: isHostedProd ? getOwnerFromEvent : undefined,
      });

      const anonymousHandler =
        options?.anonymousOwner && options.anonymousReadOnly !== false
          ? createProductionAgentHandler({
              actions: anonymousReadOnlyActions,
              systemPrompt: async (event: any) => {
                const { extra } = await prepareRun(event);
                return setSystemPromptOnContext(
                  anonymousReadOnlyPrompt +
                    runtimeContextForEvent(event) +
                    extra,
                );
              },
              model: options?.model,
              appId: options?.appId,
              apiKey: options?.apiKey,
              runSoftTimeoutMs: options?.runSoftTimeoutMs,
              finalResponseGuard: options?.finalResponseGuard,
              prepareRequest: options?.prepareRequest,
              skipFilesContext: true,
              onEngineResolved: (engine, model) => {
                const runCtx = ensureRequestRunContext();
                if (runCtx) {
                  runCtx.engine = engine;
                  runCtx.model = model;
                }
              },
              onRunPrepared: persistSubmittedUserMessage,
              onRunStart: async (
                send: (
                  event: import("../agent/types.js").AgentChatEvent,
                ) => void,
                threadId: string,
              ) => {
                await recordPreRunGitStatus(threadId);
                _runSendByThread.set(threadId, send);
                const runCtx = ensureRequestRunContext();
                if (runCtx) runCtx.threadId = threadId;
              },
              onRunComplete: async (run: any, threadId: string | undefined) => {
                if (threadId) _runSendByThread.delete(threadId);
                await onRunComplete(run, threadId);
              },
              resolveOwnerEmail: getOwnerFromEvent,
            })
          : null;

      // Build the dev handler (with filesystem/bash/db tools) if environment allows toggling
      let devHandler: ReturnType<typeof createProductionAgentHandler> | null =
        null;
      if (canToggle) {
        const { createDevScriptRegistry } =
          await import("../scripts/dev/index.js");
        // Dev mode: template actions (templateScripts and discoveredActions) are
        // intentionally OMITTED from the native tool registry. The agent invokes
        // them via `bash(command="pnpm action <name> ...")` instead. This mirrors
        // how Claude Code works locally and dramatically reduces the rate of
        // degenerate empty-object tool calls. The CLI syntax for each action is
        // listed in the dev system prompt's "Available Actions" section.
        // In lean mode — or when `nativeActionsInDev` is set — expose the
        // template's actions as native tools instead of routing through bash.
        // Templates with structured-arg actions (objects/arrays) need this to
        // avoid round-tripping JSON through the CLI parser.
        const devActions = attachToolSearch(
          leanPrompt
            ? leanActions
            : devNative
              ? prodActions
              : {
                  ...resourceScripts,
                  ...docsScripts,
                  ...(lazyContext ? frameworkContextTool : {}),
                  ...chatScripts,
                  ...callAgentScript,
                  ...teamTools,
                  ...jobTools,
                  ...automationTools,
                  ...notificationTools,
                  ...progressTools,
                  ...fetchTool,
                  ...webSearchTool,
                  ...workspaceFilesTool,
                  ...toolActions,
                  ...browserSessionTools,
                  ...coreEmailTools,
                  ...coreAttachmentTools,
                  ...browserTools,
                  ...mcpActionEntries,
                  ...(await createDevScriptRegistry()),
                  // Full-database admin tools (NODE_ENV=development gate — see
                  // dbAdminScripts; also in prodActions so App mode has them too).
                  ...dbAdminScripts,
                  // run-code sandbox is always available in dev mode.
                  ...devRunCodeTool,
                },
        );
        // Wire the late-binding supplier for devRunCodeTool so the bridge can
        // call back into the fully-assembled devActions registry.
        devRunCodeToolActions = devActions;
        // Keep dev action dict in sync with runtime MCP additions. When
        // native-actions mode is on (lean or `nativeActionsInDev`), devActions
        // === prodActions so the prod listener already covers it.
        if (devActions !== prodActions && devActions !== leanActions) {
          mcpManager.onChange(() => {
            syncMcpActionEntries(mcpManager, devActions);
          });
        }
        devHandler = createProductionAgentHandler({
          actions: devActions,
          systemPrompt: async (event: any) => {
            const { owner, extra } = await prepareRun(event);
            const runtimeContext = runtimeContextForEvent(event);
            const personalizationBlock = isNewThread()
              ? FIRST_SESSION_PERSONALIZATION
              : "";
            const modelOverlay = resolveModelOverlay();
            if (leanPrompt) {
              return setSystemPromptOnContext(
                leanBasePrompt + runtimeContext + extra + modelOverlay,
              );
            }
            const resources = await loadResourcesForPrompt(
              owner,
              lazyContext,
              options?.appId,
            );
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, true);
            return setSystemPromptOnContext(
              devPrompt +
                personalizationBlock +
                runtimeContext +
                resources +
                schemaBlock +
                extra +
                modelOverlay,
            );
          },
          model: options?.model,
          appId: options?.appId,
          apiKey: options?.apiKey,
          runSoftTimeoutMs: options?.runSoftTimeoutMs,
          finalResponseGuard: options?.finalResponseGuard,
          prepareRequest: options?.prepareRequest,
          skipFilesContext: leanPrompt,
          ...(options?.toolLimits ? { toolLimits: options.toolLimits } : {}),
          onEngineResolved: (engine, model) => {
            const runCtx = ensureRequestRunContext();
            if (runCtx) {
              runCtx.engine = engine;
              runCtx.model = model;
            }
          },
          onRunPrepared: persistSubmittedUserMessage,
          onRunStart: async (
            send: (event: import("../agent/types.js").AgentChatEvent) => void,
            threadId: string,
          ) => {
            await recordPreRunGitStatus(threadId);
            _runSendByThread.set(threadId, send);
            const runCtx = ensureRequestRunContext();
            if (runCtx) runCtx.threadId = threadId;
          },
          onRunComplete: async (run: any, threadId: string | undefined) => {
            if (threadId) _runSendByThread.delete(threadId);
            await onRunComplete(run, threadId);
          },
        });
      }

      // Resolve mention providers
      const rawProviders = options?.mentionProviders;
      const mentionProviders: Record<string, MentionProvider> =
        typeof rawProviders === "function"
          ? await rawProviders()
          : (rawProviders ?? {});

      // currentDevMode + persistence were hoisted to the top of this function
      // so every closure built below can close over the live flag.

      // Mount mode endpoint — GET returns current mode, POST toggles it (localhost only)
      getH3App(nitroApp).use(
        `${routePath}/mode`,
        defineEventHandler(async (event) => {
          if (getMethod(event) === "POST") {
            if (!canToggle) {
              setResponseStatus(event, 403);
              return { error: "Mode switching not available in production" };
            }
            if (!isLocalhost(event)) {
              setResponseStatus(event, 403);
              return { error: "Mode switching only available on localhost" };
            }
            const body = await readBody(event);
            if (typeof body?.devMode === "boolean") {
              currentDevMode = body.devMode;
            } else {
              currentDevMode = !currentDevMode;
            }
            try {
              await putSetting(AGENT_MODE_SETTING_KEY, {
                devMode: currentDevMode,
              });
            } catch {
              // Persistence is best-effort — in-memory flag still applies for
              // the lifetime of this process even if the settings write fails.
            }
            return {
              devMode: currentDevMode,
              codeMode: currentDevMode,
              canToggle,
            };
          }
          return {
            devMode: currentDevMode,
            codeMode: currentDevMode,
            canToggle,
          };
        }),
      );

      // Self-heal the RunsTray: when the tray lists this owner's runs, first
      // reconcile their in-flight sub-agent runs (re-fire dropped dispatches,
      // mark dead runs failed) so the tray reflects precise status without
      // waiting on the orchestrator chat to poll. Registered here to keep the
      // generic progress store free of feature-module imports.
      setProgressPreListHook((owner, context) =>
        runWithRequestContext({ userEmail: owner }, () =>
          reconcileAgentTeamRunsForOwner(owner, context.event),
        ),
      );

      // ─── Agent Teams: durable sub-agent run processor ─────────────────
      // Self-fire target for `spawnTask`. Executes one chunk of a queued
      // sub-agent in this fresh function invocation (its own timeout budget)
      // so background sub-agents survive serverless instead of dying as a
      // detached promise. Mounted here so it closes over the sub-agent action
      // set / base prompt / engine (per-deployment closures that can't be
      // serialized into the queue). HMAC-authed with the same internal-token
      // scheme as the A2A/webhook processors.
      getH3App(nitroApp).use(
        AGENT_TEAM_PROCESS_RUN_PATH,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const body = (await readBody(event)) as {
            taskId?: unknown;
            mode?: unknown;
            noProgressCount?: unknown;
          } | null;
          const taskId =
            body && typeof body.taskId === "string" ? body.taskId : "";
          if (!taskId) {
            setResponseStatus(event, 400);
            return { error: "taskId required" };
          }
          const mode: "start" | "continue" =
            body?.mode === "continue" ? "continue" : "start";
          const noProgressCount =
            typeof body?.noProgressCount === "number"
              ? body.noProgressCount
              : undefined;

          if (hasConfiguredA2ASecret()) {
            const tok = extractBearerToken(getHeader(event, "authorization"));
            if (!verifyInternalToken(taskId, tok ?? "")) {
              setResponseStatus(event, 401);
              return { error: "Invalid or expired processor token" };
            }
          } else if (isA2AProductionRuntime()) {
            setResponseStatus(event, 503);
            return {
              error:
                "Agent Teams processor not configured — set A2A_SECRET on this deployment.",
            };
          }

          try {
            return await processAgentTeamRun({
              taskId,
              mode,
              event,
              noProgressCount,
              resolveConfig: async ({ payload, ownerEmail, orgId: _orgId }) => {
                // Resolve the owner's API key so BYO-key sub-agents use the
                // same credentials as the parent chat.
                let apiKey: string | undefined;
                try {
                  const { getOwnerActiveApiKey } =
                    await import("../agent/production-agent.js");
                  apiKey =
                    (await getOwnerActiveApiKey(ownerEmail)) ?? undefined;
                } catch {
                  apiKey = undefined;
                }
                // Use the same resolveEngine path as the A2A and MCP
                // processors so Builder-gateway/OpenAI users get their
                // configured engine instead of always hitting the Anthropic SDK.
                const engine = await resolveEngine({
                  engineOption: options?.engine,
                  apiKey: apiKey ?? options?.apiKey,
                  appId: options?.appId,
                });
                const modelCandidate =
                  payload.model ??
                  (await getStoredModelForEngine(engine, {
                    appId: options?.appId,
                  })) ??
                  engine.defaultModel ??
                  resolvedModel;
                const model = normalizeModelForEngine(engine, modelCandidate);
                return {
                  baseSystemPrompt: basePrompt,
                  actions: buildSubAgentActions(),
                  engine,
                  model,
                };
              },
            });
          } catch (err: any) {
            console.error("[agent-teams] _process-run failed:", err);
            setResponseStatus(event, 500);
            return { error: "process-run failed" };
          }
        }),
      );

      const modelDefaultsAppId =
        normalizeAgentAppModelDefaultAppId(
          options?.appId ??
            process.env.AGENT_NATIVE_APP_ID ??
            process.env.VITE_AGENT_NATIVE_TEMPLATE ??
            "app",
        ) ?? "app";

      const resolveModelDefaultsContext = async (event: any) => {
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          return {
            ok: false as const,
            status: 401,
            error: "Authentication required",
          };
        }

        let orgCtx: {
          orgId?: string | null;
          orgName?: string | null;
          role?: string | null;
        } | null = null;
        try {
          const { getOrgContext } = await import("../org/context.js");
          orgCtx = await getOrgContext(event);
        } catch {
          orgCtx = null;
        }

        const orgId =
          (options?.resolveOrgId
            ? await options.resolveOrgId(event)
            : (orgCtx?.orgId ?? session.orgId ?? null)) ?? null;
        const canUpdate = await canUpdateAgentAppModelDefaultSettings(
          session.email,
          orgId,
        );

        return {
          ok: true as const,
          userEmail: session.email,
          orgId,
          orgName: orgCtx?.orgId === orgId ? (orgCtx.orgName ?? null) : null,
          role: orgCtx?.orgId === orgId ? (orgCtx.role ?? null) : null,
          canUpdate,
        };
      };

      const listModelDefaultEngineOptions = async (ctx: {
        userEmail?: string;
        orgId?: string | null;
      }) => {
        registerBuiltinEngines();
        return runWithRequestContext(
          {
            userEmail: ctx.userEmail,
            orgId: ctx.orgId ?? undefined,
          },
          () =>
            Promise.all(
              listAgentEngines().map(async (entry) => ({
                name: entry.name,
                label: entry.label,
                description: entry.description,
                defaultModel: entry.defaultModel,
                supportedModels: entry.supportedModels,
                requiredEnvVars: entry.requiredEnvVars,
                installPackage: entry.installPackage,
                packageInstalled: isAgentEnginePackageInstalled(entry),
                configured: await isStoredEngineUsableForRequest(
                  { engine: entry.name, model: entry.defaultModel },
                  entry,
                ).catch(() => false),
              })),
            ),
        );
      };

      const buildModelDefaultsPayload = async (event: any, appId: string) => {
        const ctx = await resolveModelDefaultsContext(event);
        if (!ctx.ok) return ctx;
        const settings = await readAgentAppModelDefaultSettings(
          { userEmail: ctx.userEmail, orgId: ctx.orgId },
          appId,
        );
        return {
          ok: true as const,
          ...settings,
          canUpdate: ctx.canUpdate,
          orgId: ctx.orgId,
          orgName: ctx.orgName,
          role: ctx.role,
          engines: await listModelDefaultEngineOptions(ctx),
        };
      };

      // GET/PUT/DELETE /_agent-native/agent-model-defaults — org-scoped
      // per-app default engine/model used when a chat request does not carry
      // an explicit composer model selection.
      getH3App(nitroApp).use(
        "/_agent-native/agent-model-defaults",
        defineEventHandler(async (event) => {
          const method = getMethod(event);
          const query = getQuery(event);
          const queryAppId =
            typeof query.appId === "string" ? query.appId : undefined;
          const appId =
            normalizeAgentAppModelDefaultAppId(queryAppId) ??
            modelDefaultsAppId;

          if (method === "GET") {
            const payload = await buildModelDefaultsPayload(event, appId);
            if (payload.ok === false) {
              setResponseStatus(event, payload.status);
              return { error: payload.error };
            }
            return payload;
          }

          if (method !== "PUT" && method !== "DELETE") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const ctx = await resolveModelDefaultsContext(event);
          if (ctx.ok === false) {
            setResponseStatus(event, ctx.status);
            return { error: ctx.error };
          }
          if (!ctx.canUpdate) {
            setResponseStatus(event, 403);
            return {
              error: ctx.orgId
                ? "Only organization owners and admins can change app model defaults."
                : "You cannot change app model defaults.",
            };
          }

          if (method === "DELETE") {
            await resetAgentAppModelDefaultSettings(
              { userEmail: ctx.userEmail, orgId: ctx.orgId },
              appId,
            );
            return buildModelDefaultsPayload(event, appId);
          }

          const body = await readBody(event).catch(() => ({}));
          const bodyAppId =
            typeof body?.appId === "string" ? body.appId : undefined;
          const targetAppId =
            normalizeAgentAppModelDefaultAppId(bodyAppId) ?? appId;
          const engine =
            typeof body?.engine === "string" ? body.engine.trim() : "";
          const model =
            typeof body?.model === "string" ? body.model.trim() : "";
          if (!engine || !model) {
            setResponseStatus(event, 400);
            return { error: "engine and model are required" };
          }
          const entry = getAgentEngineEntry(engine);
          if (!entry) {
            setResponseStatus(event, 400);
            return { error: `Unknown engine: ${engine}` };
          }
          if (!isAgentEnginePackageInstalled(entry)) {
            setResponseStatus(event, 400);
            return {
              error: `Engine "${engine}" requires optional packages that are not installed in this app. Run: pnpm add ${entry.installPackage}`,
            };
          }
          if (
            entry.name === "builder" &&
            normalizeModelForEngine(entry, model) !== model
          ) {
            setResponseStatus(event, 400);
            return {
              error: `Model "${model}" is not supported by Builder. Choose one of: ${entry.supportedModels.join(", ")}`,
            };
          }

          await writeAgentAppModelDefaultSettings(
            { userEmail: ctx.userEmail, orgId: ctx.orgId },
            targetAppId,
            { engine, model, updatedBy: ctx.userEmail },
          );
          return buildModelDefaultsPayload(event, targetAppId);
        }),
      );

      // Mount save-key BEFORE the prefix handler so it isn't shadowed.
      // Persists the user's API key in `app_secrets` (encrypted, scope=user,
      // scopeId=email). Hard rule: never mutates process.env, never writes
      // .env. User-pasted secrets must not become deploy-level identity —
      // that's the cross-tenant leak class (KVesta Space, 2026-04).
      // Consumers read these values per-request via `resolveSecret(key)`.
      getH3App(nitroApp).use(
        `${routePath}/save-key`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const body = await readBody(event);
          const { key, provider: rawProvider } = body as {
            key?: string;
            provider?: string;
          };
          const provider = rawProvider || "anthropic";

          if (!key || typeof key !== "string" || !key.trim()) {
            setResponseStatus(event, 400);
            return { error: "API key is required" };
          }

          const trimmedKey = key.trim();

          const ownerEmail = await getOwnerFromEvent(event);
          if (!ownerEmail) {
            setResponseStatus(event, 401);
            return { error: "Authentication required" };
          }

          const providerToEnv: Record<string, string> = {
            anthropic: "ANTHROPIC_API_KEY",
            openai: "OPENAI_API_KEY",
            google: "GOOGLE_GENERATIVE_AI_API_KEY",
            groq: "GROQ_API_KEY",
            mistral: "MISTRAL_API_KEY",
            cohere: "COHERE_API_KEY",
          };
          const secretKey =
            providerToEnv[provider] ?? `${provider.toUpperCase()}_API_KEY`;

          try {
            const { writeAppSecret } = await import("../secrets/storage.js");
            await writeAppSecret({
              key: secretKey,
              value: trimmedKey,
              scope: "user",
              scopeId: ownerEmail,
            });
          } catch (err) {
            console.error(
              "[agent-chat] save-key persistence failed:",
              err instanceof Error ? err.message : err,
            );
            setResponseStatus(event, 500);
            return {
              error:
                "Failed to persist API key. Please try again or contact support.",
            };
          }

          return { ok: true };
        }),
      );

      // Mount file search endpoint
      getH3App(nitroApp).use(
        `${routePath}/files`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const query = getQuery(event);
          const q = typeof query.q === "string" ? query.q.toLowerCase() : "";

          const files: Array<{
            path: string;
            name: string;
            source: "codebase" | "resource";
            type: string;
          }> = [];
          const seen = new Set<string>();

          // In dev mode, walk the filesystem
          if (currentDevMode) {
            const codebaseFiles: Array<{
              path: string;
              name: string;
              type: "file" | "folder";
            }> = [];
            try {
              await collectFiles(process.cwd(), "", 0, codebaseFiles);
            } catch {
              // Filesystem access failed — skip
            }
            for (const f of codebaseFiles) {
              if (!seen.has(f.path)) {
                seen.add(f.path);
                files.push({
                  path: f.path,
                  name: f.name,
                  source: "codebase",
                  type: f.type,
                });
              }
            }
          }

          // Query resources
          try {
            const resources = [
              ...(await resourceList(SHARED_OWNER)),
              ...(await resourceList(WORKSPACE_OWNER)),
            ];
            for (const r of resources) {
              if (!seen.has(r.path)) {
                seen.add(r.path);
                files.push({
                  path: r.path,
                  name: r.path.split("/").pop() || r.path,
                  source: "resource",
                  type: "file",
                });
              }
            }
          } catch {
            // Resources not available — skip
          }

          // Filter by query and limit
          const filtered = q
            ? files.filter((f) => f.path.toLowerCase().includes(q))
            : files;

          return { files: filtered.slice(0, 30) };
        }),
      );

      // Mount skills listing endpoint
      getH3App(nitroApp).use(
        `${routePath}/skills`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const skills: Array<{
            name: string;
            description?: string;
            path: string;
            source: "codebase" | "resource";
          }> = [];
          const seenNames = new Set<string>();

          // In dev mode, scan .agents/skills/ plus legacy .agent/skills/.
          if (currentDevMode) {
            try {
              const _fs = await lazyFs();
              const skillRoots = [
                {
                  dir: nodePath.join(process.cwd(), ".agents", "skills"),
                  display: ".agents/skills",
                },
                {
                  dir: nodePath.join(process.cwd(), ".agent", "skills"),
                  display: ".agent/skills",
                },
              ];
              for (const root of skillRoots) {
                let entries: Array<{
                  name: string;
                  isDirectory: () => boolean;
                  isFile: () => boolean;
                }>;
                try {
                  entries = _fs.readdirSync(root.dir, {
                    withFileTypes: true,
                  });
                } catch {
                  continue;
                }
                for (const entry of entries) {
                  // Support both flat .md files and subdirectory-based skills (dir/SKILL.md)
                  let skillFilePath: string;
                  let skillRelPath: string;

                  if (entry.isDirectory()) {
                    // Subdirectory layout: <skills-root>/<name>/SKILL.md
                    const candidate = nodePath.join(
                      root.dir,
                      entry.name,
                      "SKILL.md",
                    );
                    if (!_fs.existsSync(candidate)) continue;
                    skillFilePath = candidate;
                    skillRelPath = `${root.display}/${entry.name}/SKILL.md`;
                  } else if (entry.isFile() && entry.name.endsWith(".md")) {
                    // Flat layout: <skills-root>/<name>.md
                    skillFilePath = nodePath.join(root.dir, entry.name);
                    skillRelPath = `${root.display}/${entry.name}`;
                  } else {
                    continue;
                  }

                  try {
                    const content = _fs.readFileSync(skillFilePath, "utf-8");
                    const fm = parseSkillFrontmatter(content);
                    if (fm.userInvocable === false) continue;
                    const skillName =
                      fm.name || entry.name.replace(/\.md$/, "");
                    if (!seenNames.has(skillName)) {
                      seenNames.add(skillName);
                      skills.push({
                        name: skillName,
                        description: fm.description,
                        path: skillRelPath,
                        source: "codebase",
                      });
                    }
                  } catch {
                    // Could not read individual skill file — skip
                  }
                }
              }
            } catch {
              // Skill directories don't exist or are not readable — skip.
            }
          }

          // Query accessible resources with skills/ prefix. Personal skills
          // need to show alongside shared skills so slash/menu invocation can
          // find both `learn` and `learn-shared`.
          try {
            const skillsOwner = await getOwnerFromEvent(event).catch(
              () => undefined,
            );
            let skillsOrgId: string | undefined;
            if (options?.resolveOrgId) {
              try {
                skillsOrgId = (await options.resolveOrgId(event)) ?? undefined;
              } catch {
                skillsOrgId = undefined;
              }
            }
            if (skillsOwner) await ensurePersonalDefaults(skillsOwner);
            const resourceSkills = skillsOwner
              ? await resourceListAccessible(skillsOwner, "skills/", {
                  userEmail: skillsOwner,
                  orgId: skillsOrgId ?? null,
                })
              : [
                  ...(await resourceList(SHARED_OWNER, "skills/")),
                  ...(await resourceList(WORKSPACE_OWNER, "skills/")),
                ];
            resourceSkills.sort((a, b) => {
              const ownerOrder =
                (a.owner === skillsOwner
                  ? 0
                  : a.owner === SHARED_OWNER
                    ? 1
                    : a.owner === WORKSPACE_OWNER
                      ? 2
                      : 3) -
                (b.owner === skillsOwner
                  ? 0
                  : b.owner === SHARED_OWNER
                    ? 1
                    : b.owner === WORKSPACE_OWNER
                      ? 2
                      : 3);
              if (ownerOrder !== 0) return ownerOrder;
              const pathOrder =
                (a.path.endsWith("/SKILL.md") ? 0 : 1) -
                (b.path.endsWith("/SKILL.md") ? 0 : 1);
              if (pathOrder !== 0) return pathOrder;
              return a.path.localeCompare(b.path);
            });
            for (const r of resourceSkills) {
              // Try to get content to parse frontmatter
              let skillName = getSkillNameFromPath(r.path);
              let description: string | undefined;
              let userInvocable: boolean | undefined;
              try {
                const full = await resourceGet(
                  r.id,
                  skillsOwner
                    ? { userEmail: skillsOwner, orgId: skillsOrgId ?? null }
                    : undefined,
                );
                if (full) {
                  const fm = parseSkillFrontmatter(full.content);
                  if (fm.name) skillName = fm.name;
                  description = fm.description;
                  userInvocable = fm.userInvocable;
                }
              } catch {
                // Could not read resource content — use path-based name
              }
              if (userInvocable === false) continue;
              if (!seenNames.has(skillName)) {
                seenNames.add(skillName);
                skills.push({
                  name: skillName,
                  description,
                  path: r.path,
                  source: "resource",
                });
              }
            }
          } catch {
            // Resources not available — skip
          }

          const result: {
            skills: typeof skills;
            hint?: string;
          } = { skills };

          if (skills.length === 0) {
            result.hint =
              "No skills found. Add skill files under skills/ in Resources. Learn more: https://agent-native.com/docs/resources#skills";
          }

          return result;
        }),
      );

      // Mount unified mentions endpoint (files + resources + custom providers)
      getH3App(nitroApp).use(
        `${routePath}/mentions`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          // Resolve the caller and run the entire stream inside a request
          // context so custom mention providers can use `accessFilter` /
          // `resolveAccess` when querying ownable tables. Without this,
          // a provider that searches `decks` (or any sharable resource)
          // would see every row regardless of ownership.
          const mentionsOwner = await getOwnerFromEvent(event).catch(
            () => undefined,
          );
          let mentionsOrgId: string | undefined;
          if (options?.resolveOrgId) {
            try {
              const resolved = await options.resolveOrgId(event);
              mentionsOrgId = resolved ?? undefined;
            } catch {
              mentionsOrgId = undefined;
            }
          }

          const query = getQuery(event);
          const q = typeof query.q === "string" ? query.q.toLowerCase() : "";

          interface MentionItemResponse {
            id: string;
            label: string;
            description?: string;
            icon?: string;
            source: string;
            refType: string;
            refPath?: string;
            refId?: string;
            section?: string;
          }

          const matchesQuery = (item: MentionItemResponse) =>
            !q ||
            item.label.toLowerCase().includes(q) ||
            (item.description?.toLowerCase().includes(q) ?? false);

          const enc = new TextEncoder();

          // Stream NDJSON — each source flushes its batch as soon as it's ready.
          setResponseHeader(event, "Content-Type", "application/x-ndjson");
          setResponseHeader(event, "Cache-Control", "no-cache");

          const stream = new ReadableStream({
            start(controller) {
              return runWithRequestContext(
                {
                  userEmail: mentionsOwner,
                  orgId: mentionsOrgId,
                },
                () => mentionsStreamWork(controller),
              );
            },
            cancel() {
              // Client disconnected — stop enqueuing
            },
          });

          return stream;

          async function mentionsStreamWork(
            controller: ReadableStreamDefaultController<Uint8Array>,
          ) {
            const MAX_RESULTS = 50;
            let totalSent = 0;
            let cancelled = false;

            const flush = (batch: MentionItemResponse[]) => {
              if (cancelled) return;
              const filtered = batch.filter(matchesQuery);
              if (filtered.length === 0) return;
              const remaining = MAX_RESULTS - totalSent;
              const toSend = filtered.slice(0, remaining);
              if (toSend.length > 0) {
                totalSent += toSend.length;
                try {
                  controller.enqueue(
                    enc.encode(JSON.stringify({ items: toSend }) + "\n"),
                  );
                } catch {
                  // Stream was closed by client
                  cancelled = true;
                }
              }
            };

            // All sources run in parallel; each flushes independently.
            const sources: Promise<void>[] = [];

            // 1. Resources from SQL (fast — flush first)
            sources.push(
              (async () => {
                try {
                  const resources = mentionsOwner
                    ? await resourceListAccessible(mentionsOwner)
                    : [
                        ...(await resourceList(WORKSPACE_OWNER)),
                        ...(await resourceList(SHARED_OWNER)),
                      ];
                  flush(
                    resources.map((r) => {
                      const scope = resourceScopeForOwner(
                        r.owner,
                        mentionsOwner,
                      );
                      return {
                        id: `resource:${r.path}`,
                        label: r.path.split("/").pop() || r.path,
                        description: r.path,
                        icon: "file",
                        source: `resource:${scope}`,
                        refType: "file",
                        refPath: r.path,
                        section: "Files",
                      };
                    }),
                  );
                } catch {}
              })(),
            );

            // 2. Codebase files (dev mode only — can be slow on large repos)
            if (currentDevMode) {
              sources.push(
                (async () => {
                  const codebaseFiles: Array<{
                    path: string;
                    name: string;
                    type: "file" | "folder";
                  }> = [];
                  try {
                    await collectFiles(process.cwd(), "", 0, codebaseFiles);
                  } catch {}
                  flush(
                    codebaseFiles.map((f) => ({
                      id: `codebase:${f.path}`,
                      label: f.name,
                      description: f.path !== f.name ? f.path : undefined,
                      icon: f.type,
                      source: "codebase",
                      refType: "file",
                      refPath: f.path,
                      section: "Files",
                    })),
                  );
                })(),
              );
            }

            // 3. Custom mention providers (each flushes independently)
            for (const [key, provider] of Object.entries(mentionProviders)) {
              sources.push(
                (async () => {
                  try {
                    const providerItems = await provider.search(q, event);
                    flush(
                      providerItems.map((item) => ({
                        id: item.id,
                        label: item.label,
                        description: item.description,
                        icon: item.icon || provider.icon || "file",
                        source: key,
                        refType: item.refType,
                        refPath: item.refPath,
                        refId: item.refId,
                        section: provider.label,
                      })),
                    );
                  } catch (e) {
                    console.error(
                      `[agent-native] Mention provider "${key}" failed:`,
                      e,
                    );
                  }
                })(),
              );
            }

            // 4. Custom workspace agents
            sources.push(
              (async () => {
                try {
                  const owner = await getOwnerFromEvent(event);
                  const { listAccessibleCustomAgents } =
                    await import("../resources/agents.js");
                  const agents = await listAccessibleCustomAgents(owner);
                  flush(
                    agents.map((agent) => ({
                      id: `custom-agent:${agent.id}`,
                      label: agent.name,
                      description: agent.description || agent.path,
                      icon: "agent",
                      source: "agent:custom",
                      refType: "custom-agent",
                      refPath: agent.path,
                      refId: agent.id,
                      section: "Agents",
                    })),
                  );
                } catch (e) {
                  console.error(
                    "[agent-native] Custom agent discovery failed:",
                    e,
                  );
                }
              })(),
            );

            // 5. Peer agent discovery (network call — often slowest)
            sources.push(
              (async () => {
                try {
                  const agents = await discoverAgents(options?.appId);
                  flush(
                    agents.map((agent) => ({
                      id: `agent:${agent.id}`,
                      label: agent.name,
                      description: agent.description,
                      icon: "agent",
                      source: "agent",
                      refType: "agent",
                      refPath: agent.url,
                      refId: agent.id,
                      section: "Connected Agents",
                    })),
                  );
                } catch (e) {
                  console.error("[agent-native] Agent discovery failed:", e);
                }
              })(),
            );

            await Promise.all(sources);
            if (!cancelled) controller.close();
          }
        }),
      );

      // ─── Generate thread title ──────────────────────────────────────────
      getH3App(nitroApp).use(
        `${routePath}/generate-title`,
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          const ownerEmail = await getOwnerFromEvent(event);

          // Per-user rate limit: 10 calls / 60s. Prevents an authenticated
          // user from spamming the endpoint to exhaust shared Anthropic
          // credits on platform-key deployments.
          const now = Date.now();
          const limitWindowMs = 60_000;
          const limitMax = 10;
          const recent = (generateTitleRateLimit.get(ownerEmail) ?? []).filter(
            (t) => now - t < limitWindowMs,
          );
          if (recent.length >= limitMax) {
            setResponseStatus(event, 429);
            return { error: "Rate limit exceeded" };
          }
          recent.push(now);
          generateTitleRateLimit.set(ownerEmail, recent);

          const body = await readBody(event);
          const message = body?.message;
          if (!message || typeof message !== "string") {
            setResponseStatus(event, 400);
            return { error: "message is required" };
          }
          // Strip mention markup: @[Name|type] → @Name
          const cleanMessage = message.replace(
            /@\[([^\]|]+)\|[^\]]*\]/g,
            "@$1",
          );
          // Mirror the chat-run resolution so BYO-key users have title
          // generation billed to their own key instead of the platform key.
          const { getOwnerActiveApiKey } =
            await import("../agent/production-agent.js");
          const userApiKey = await getOwnerActiveApiKey(ownerEmail);
          const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            // Fallback: truncate the message
            return { title: cleanMessage.trim().slice(0, 60) };
          }
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 30,
                messages: [
                  {
                    role: "user",
                    content: `Generate a very short title (3-6 words, no quotes) for a chat that starts with this message:\n\n${cleanMessage.slice(0, 500)}`,
                  },
                ],
              }),
            });
            if (!res.ok) {
              return { title: cleanMessage.trim().slice(0, 60) };
            }
            const data = (await res.json()) as {
              content?: Array<{ type: string; text?: string }>;
            };
            const text = data.content?.[0]?.text?.trim();
            return { title: text || cleanMessage.trim().slice(0, 60) };
          } catch {
            return { title: cleanMessage.trim().slice(0, 60) };
          }
        }),
      );

      // ─── Run management endpoints (for hot-reload resilience) ─────────────

      // GET /runs/active?threadId=X — check if there's an active run for a thread
      getH3App(nitroApp).use(
        `${routePath}/runs`,
        defineEventHandler(async (event) => {
          // Auth check — ensure the user is authenticated
          const owner = await getOwnerFromEvent(event);

          const method = getMethod(event);
          const url = event.node?.req?.url || event.path || "";

          // Authorization: a run's events/abort and a thread's active-run
          // status must only be exposed to the user who OWNS the thread.
          // agent_runs carries no owner column — ownership lives on the
          // chat_threads row via thread_id. callerOwnsRun/callerOwnsThread
          // (agent/run-ownership.ts) resolve the run's thread (in-memory first,
          // SQL fallback) and compare its ownerEmail. Without this, any
          // authenticated tenant who learns another tenant's runId/threadId
          // could stream their live agent turn (assistant text + tool-result
          // payloads) or abort their run.
          const ownsThread = (threadId: string | null | undefined) =>
            callerOwnsThread(owner, threadId);
          const ownsRun = (runId: string) => callerOwnsRun(owner, runId);

          // Route: GET /runs/list?goalId=agent-team|agent-harness
          // Returns background agents in the Code hub-compatible run shape.
          const listMatch =
            url.match(/\/runs\/list(?:[/?]|$)/) ||
            url.match(/^\/list(?:[/?]|$)/);
          if (listMatch && method === "GET") {
            const query = getQuery(event);
            const goalId = query.goalId ? String(query.goalId) : undefined;
            const runs = await runWithRequestContext(
              { userEmail: owner },
              async () => {
                const runs: unknown[] = [];
                if (!goalId || goalId === "agent-team") {
                  const { listAgentTeamBackgroundRuns } =
                    await import("./agent-teams.js");
                  runs.push(...(await listAgentTeamBackgroundRuns()));
                }
                if (!goalId || goalId === "agent-harness") {
                  const { listAgentHarnessBackgroundRuns } =
                    await import("../agent/harness/background.js");
                  runs.push(
                    ...(await listAgentHarnessBackgroundRuns({
                      goalId: "agent-harness",
                      ownerEmail: owner,
                    })),
                  );
                }
                return runs;
              },
            );
            return { status: "ok", goalId, runs };
          }

          // Route: POST /runs/:id/stop
          // Stops a running Agent Teams background run (durable task-based).
          // Distinct from /abort which operates on in-memory run-manager runs.
          const stopMatch =
            url.match(/\/runs\/([^/?]+)\/stop/) ||
            url.match(/^\/([^/?]+)\/stop/);
          if (stopMatch && method === "POST") {
            const runId = decodeURIComponent(stopMatch[1]);
            const { stopAgentTeamBackgroundRun } =
              await import("./agent-teams.js");
            let result = await runWithRequestContext({ userEmail: owner }, () =>
              stopAgentTeamBackgroundRun(runId),
            );
            if (!result.ok && result.error === "Task not found") {
              const { stopAgentHarnessBackgroundRun } =
                await import("../agent/harness/background.js");
              result = await runWithRequestContext({ userEmail: owner }, () =>
                stopAgentHarnessBackgroundRun(runId, { ownerEmail: owner }),
              );
            }
            if (!result.ok) {
              setResponseStatus(
                event,
                result.error === "Task not found" ||
                  result.error === "Harness run not found"
                  ? 404
                  : 400,
              );
              return { ok: false, error: result.error };
            }
            return { ok: true };
          }

          // Route: POST /runs/:id/abort
          // Match both full URL (/runs/{id}/abort) and h3 prefix-stripped (/{id}/abort)
          const abortMatch =
            url.match(/\/runs\/([^/?]+)\/abort/) ||
            url.match(/^\/([^/?]+)\/abort/);
          if (abortMatch && method === "POST") {
            const runId = decodeURIComponent(abortMatch[1]);
            if (!(await ownsRun(runId))) {
              // 404 (not 403) so run existence isn't leaked to non-owners.
              setResponseStatus(event, 404);
              return { error: "Run not found" };
            }
            let reason = "user";
            try {
              const body = await readBody(event);
              if (body?.reason === "no_progress") {
                reason = "no_progress";
              }
            } catch {
              // Empty/invalid body — keep the default user abort reason.
            }
            abortRun(runId, reason); // Aborts in-memory + marks aborted in SQL
            return { ok: true };
          }

          // Route: GET /runs/:id/background-events
          // Returns Agent Teams transcript events in the shared background-run shape.
          const backgroundEventsMatch =
            url.match(/\/runs\/([^/?]+)\/background-events/) ||
            url.match(/^\/([^/?]+)\/background-events/);
          if (backgroundEventsMatch && method === "GET") {
            const runId = decodeURIComponent(backgroundEventsMatch[1]);
            const {
              getAgentTeamBackgroundRun,
              listAgentTeamBackgroundTranscriptEvents,
            } = await import("./agent-teams.js");
            const run = await runWithRequestContext({ userEmail: owner }, () =>
              getAgentTeamBackgroundRun(runId),
            );
            if (run) {
              const events = await runWithRequestContext(
                { userEmail: owner },
                () => listAgentTeamBackgroundTranscriptEvents(runId),
              );
              return { status: "ok", runId, events };
            }
            const {
              getAgentHarnessBackgroundRun,
              listAgentHarnessBackgroundTranscriptEvents,
            } = await import("../agent/harness/background.js");
            const harnessRun = await runWithRequestContext(
              { userEmail: owner },
              () => getAgentHarnessBackgroundRun(runId, { ownerEmail: owner }),
            );
            if (!harnessRun) {
              setResponseStatus(event, 404);
              return { status: "unavailable", runId, events: [] };
            }
            const events = await runWithRequestContext(
              { userEmail: owner },
              () =>
                listAgentHarnessBackgroundTranscriptEvents(runId, {
                  ownerEmail: owner,
                }),
            );
            return { status: "ok", runId, events };
          }

          // Route: GET /runs/:id/events?after=N
          // Match both full URL (/runs/{id}/events) and h3 prefix-stripped (/{id}/events)
          const eventsMatch =
            url.match(/\/runs\/([^/?]+)\/events/) ||
            url.match(/^\/([^/?]+)\/events/);
          if (eventsMatch && method === "GET") {
            const runId = decodeURIComponent(eventsMatch[1]);
            if (!(await ownsRun(runId))) {
              // 404 (not 403) so run existence isn't leaked to non-owners.
              setResponseStatus(event, 404);
              return { error: "Run not found" };
            }
            const query = getQuery(event);
            const after = parseInt(String(query.after ?? "0"), 10) || 0;

            const stream = subscribeToRun(runId, after);
            if (!stream) {
              setResponseStatus(event, 404);
              return { error: "Run not found" };
            }

            setResponseHeader(event, "Content-Type", "text/event-stream");
            setResponseHeader(event, "Cache-Control", "no-cache");
            setResponseHeader(event, "Connection", "keep-alive");
            return stream;
          }

          // Route: GET /runs/active?threadId=X
          if (method === "GET") {
            const query = getQuery(event);
            const threadId = query.threadId ? String(query.threadId) : null;
            if (!threadId) {
              setResponseStatus(event, 400);
              return { error: "threadId query parameter is required" };
            }

            // Only reveal a thread's active run to the thread's owner.
            // Present non-owners (or unknown threads) as idle rather than
            // 404 so thread existence isn't leaked and the client polls
            // benignly.
            if (!(await ownsThread(threadId))) {
              return {
                active: false,
                threadId,
                status: "idle",
                heartbeatAt: null,
                lastProgressAt: null,
              };
            }

            // Check in-memory first, then SQL (cross-isolate on Workers)
            const run = await getActiveRunForThreadAsync(threadId);
            if (!run) {
              return {
                active: false,
                threadId,
                status: "idle",
                heartbeatAt: null,
                lastProgressAt: null,
              };
            }

            return {
              active: true,
              runId: run.runId,
              threadId: run.threadId,
              turnId: run.turnId,
              status: run.status,
              heartbeatAt: run.heartbeatAt,
              lastProgressAt: run.lastProgressAt,
              // Server clock so the client computes "stuck" elapsed time
              // server-relative, immune to client clock skew.
              serverNow: Date.now(),
            };
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // ─── Checkpoint endpoints ──────────────────────────────────────────────
      getH3App(nitroApp).use(
        `${routePath}/checkpoints`,
        defineEventHandler(async (event) => {
          const method = getMethod(event);

          // GET /checkpoints?threadId=... — list checkpoints for a thread
          if (method === "GET") {
            if (!canToggle) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available in dev mode" };
            }
            if (!isLocalhost(event)) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available on localhost" };
            }
            const query = getQuery(event);
            const threadId = String(query.threadId || "");
            if (!threadId) {
              setResponseStatus(event, 400);
              return { error: "threadId query parameter is required" };
            }
            const owner = await getOwnerFromEvent(event);
            const thread = await getThread(threadId);
            if (!thread || thread.ownerEmail !== owner) {
              setResponseStatus(event, 404);
              return { error: "Thread not found" };
            }
            try {
              const { getCheckpointsByThread } =
                await import("../checkpoints/store.js");
              return await getCheckpointsByThread(threadId);
            } catch {
              return [];
            }
          }

          // POST /checkpoints — restore to a checkpoint
          // h3 prefix-matches, so /checkpoints/restore hits this handler with
          // event.path containing "/restore".
          const remainder = (event.path || "").replace(/^\/+/, "");
          if (method === "POST" && remainder.startsWith("restore")) {
            if (!canToggle) {
              setResponseStatus(event, 403);
              return { error: "Checkpoints only available in dev mode" };
            }
            if (!isLocalhost(event)) {
              setResponseStatus(event, 403);
              return { error: "Restore only available on localhost" };
            }
            const body = await readBody(event);
            const checkpointId = body?.checkpointId;
            if (!checkpointId) {
              setResponseStatus(event, 400);
              return { error: "checkpointId is required" };
            }
            try {
              const { getCheckpointById } =
                await import("../checkpoints/store.js");
              const checkpoint = await getCheckpointById(checkpointId);
              if (!checkpoint) {
                setResponseStatus(event, 404);
                return { error: "Checkpoint not found" };
              }
              const owner = await getOwnerFromEvent(event);
              const thread = await getThread(checkpoint.threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Checkpoint not found" };
              }
              const {
                createCheckpoint: gitCheckpoint,
                restoreToCheckpoint,
                hasUncommittedChanges,
                isGitRepo,
              } = await import("../checkpoints/service.js");
              const cwd = process.cwd();
              if (!isGitRepo(cwd)) {
                setResponseStatus(event, 400);
                return { error: "Not a git repository" };
              }
              // Save current state before restoring so user can undo the undo
              if (hasUncommittedChanges(cwd)) {
                gitCheckpoint(cwd, "[agent-native] Pre-restore checkpoint");
              }
              const restored = restoreToCheckpoint(cwd, checkpoint.commitSha);
              if (!restored) {
                setResponseStatus(event, 500);
                return { error: "Failed to restore checkpoint" };
              }
              // Trigger UI refresh
              try {
                const { recordChange } = await import("./poll.js");
                recordChange({
                  source: "checkpoint",
                  type: "change",
                  key: "*",
                });
              } catch {}
              return { success: true, commitSha: checkpoint.commitSha };
            } catch (err: any) {
              setResponseStatus(event, 500);
              return { error: err?.message ?? "Restore failed" };
            }
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // ─── Thread management endpoints ──────────────────────────────────────
      // Single handler for /threads and /threads/:id — h3's use() does prefix
      // matching so we can't reliably split them into separate handlers.
      const parseScopeFromQuery = (
        q: Record<string, unknown>,
      ): ChatThreadScope | null => {
        const type = q.scopeType ? String(q.scopeType).trim() : "";
        const id = q.scopeId ? String(q.scopeId).trim() : "";
        if (!type || !id) return null;
        const label = q.scopeLabel ? String(q.scopeLabel) : undefined;
        return label ? { type, id, label } : { type, id };
      };
      const parseScopeFromBody = (raw: unknown): ChatThreadScope | null => {
        if (raw == null) return null;
        if (typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        const type = typeof r.type === "string" ? r.type.trim() : "";
        const id = typeof r.id === "string" ? r.id.trim() : "";
        if (!type || !id) return null;
        const label = typeof r.label === "string" ? r.label : undefined;
        return label ? { type, id, label } : { type, id };
      };
      const parseForkSourceFromBody = (
        raw: unknown,
      ): ForkThreadSourceSnapshot | null => {
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        if (typeof r.threadData !== "string") return null;
        const messageCount =
          typeof r.messageCount === "number"
            ? r.messageCount
            : Number(r.messageCount ?? 0);
        return {
          threadData: r.threadData,
          title: typeof r.title === "string" ? r.title : "",
          preview: typeof r.preview === "string" ? r.preview : "",
          messageCount,
          ...(Object.prototype.hasOwnProperty.call(r, "scope")
            ? { scope: parseScopeFromBody(r.scope) }
            : {}),
        };
      };
      const parseThreadRoute = (event: H3Event) => {
        const candidates = [event.path, event.node?.req?.url].filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );
        for (const candidate of candidates) {
          const path = candidate.split("?")[0];
          const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
          const threadsIndex = parts.lastIndexOf("threads");
          if (threadsIndex >= 0) {
            const encodedId = parts[threadsIndex + 1];
            if (!encodedId) continue;
            return {
              threadId: decodeURIComponent(encodedId),
              tail: parts.slice(threadsIndex + 2),
            };
          }
          if (parts.length > 0) {
            return {
              threadId: decodeURIComponent(parts[0]),
              tail: parts.slice(1),
            };
          }
        }
        return { threadId: null, tail: [] as string[] };
      };
      getH3App(nitroApp).use(
        `${routePath}/threads`,
        defineEventHandler(async (event) => {
          const owner = await getOwnerFromEvent(event);
          const method = getMethod(event);

          const { threadId, tail: threadTail } = parseThreadRoute(event);
          const isThreadSubroute = (subroute: string) =>
            threadTail[0] === subroute;

          // ── Specific thread: GET/PUT/DELETE /threads/:id ──
          if (threadId) {
            if (method === "GET") {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return thread;
            }

            if (method === "PUT") {
              // Hold the thread_data lock for the full read-modify-write so
              // periodic saves from the frontend don't race with
              // onRunComplete / setThreadQueuedMessages / setThreadEngineMeta.
              // Without the lock, a client save that lands during an agent
              // run could clobber the assistant message the server just
              // appended (and vice versa).
              return await withThreadDataLock(threadId, async () => {
                const thread = await getThread(threadId);
                if (!thread || thread.ownerEmail !== owner) {
                  setResponseStatus(event, 404);
                  return { error: "Thread not found" };
                }
                const body = await readBody(event);
                let newThreadData = body.threadData || thread.threadData;
                let newMessageCount = body.messageCount ?? thread.messageCount;
                let nextTitle =
                  typeof body.title === "string" ? body.title : thread.title;
                const nextPreview =
                  typeof body.preview === "string"
                    ? body.preview
                    : thread.preview;
                const preserveTitleOverride = (repo: unknown) => {
                  if (
                    repo &&
                    typeof repo === "object" &&
                    typeof (repo as { _titleOverride?: unknown })
                      ._titleOverride === "string" &&
                    (repo as { _titleOverride: string })._titleOverride.trim()
                  ) {
                    const meta = extractThreadMeta(repo);
                    if (meta.title) nextTitle = meta.title;
                  }
                };
                // Merge the incoming full-thread blob over the current SQL
                // copy. Periodic saves can be stale relative to server-side
                // run completion, and threadRuntime.export() does not carry
                // queuedMessages.
                if (body.threadData) {
                  try {
                    const existing = JSON.parse(thread.threadData);
                    const incoming = JSON.parse(newThreadData);
                    const merged = mergeThreadDataForClientSave(
                      existing,
                      incoming,
                    );
                    newThreadData = JSON.stringify(merged);
                    if (Array.isArray(merged.messages)) {
                      newMessageCount = merged.messages.length;
                    }
                    preserveTitleOverride(merged);
                  } catch {
                    // Invalid JSON in either side — fall back to raw body blob.
                  }
                } else {
                  try {
                    preserveTitleOverride(JSON.parse(newThreadData));
                  } catch {
                    // Invalid JSON — keep the title supplied by the client.
                  }
                }
                await updateThreadData(
                  threadId,
                  newThreadData,
                  nextTitle,
                  nextPreview,
                  newMessageCount,
                );
                // Scope updates piggyback on the PUT — the client uses this
                // path for both "detach" (scope: null) and "retag" flows.
                // Send the field as `scope: undefined` (or omit it) when
                // you don't want to touch the existing scope.
                if (Object.prototype.hasOwnProperty.call(body, "scope")) {
                  const incomingScope = parseScopeFromBody(body.scope);
                  await setThreadScope(threadId, incomingScope);
                }
                return { ok: true };
              });
            }

            // POST /threads/:id/queued — debounced writes from the client
            // when the user adds/removes/dequeues a queued message. Keeps
            // queued messages durable across reloads without piggybacking
            // on full-thread saves.
            if (method === "POST" && isThreadSubroute("queued")) {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              const body = await readBody(event);
              const queued = Array.isArray(body?.queuedMessages)
                ? body.queuedMessages
                : [];
              await setThreadQueuedMessages(threadId, queued);
              return { ok: true };
            }

            if (method === "POST" && isThreadSubroute("rename")) {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              const body = await readBody(event).catch(() => ({}));
              const title =
                typeof body?.title === "string"
                  ? body.title.replace(/\s+/g, " ").trim().slice(0, 160)
                  : "";
              if (!title) {
                setResponseStatus(event, 400);
                return { error: "Title is required" };
              }
              const renamed = await renameThread(threadId, title, {
                ownerEmail: owner,
              });
              if (!renamed) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return { ok: true };
            }

            if (method === "POST" && isThreadSubroute("pin")) {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              const body = await readBody(event).catch(() => ({}));
              if (typeof body?.pinned !== "boolean") {
                setResponseStatus(event, 400);
                return { error: "pinned boolean is required" };
              }
              const pinned = await setThreadPinned(threadId, body.pinned, {
                ownerEmail: owner,
              });
              if (!pinned) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return { ok: true };
            }

            if (method === "POST" && isThreadSubroute("archive")) {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              const body = await readBody(event).catch(() => ({}));
              if (typeof body?.archived !== "boolean") {
                setResponseStatus(event, 400);
                return { error: "archived boolean is required" };
              }
              const archived = await setThreadArchived(
                threadId,
                body.archived,
                { ownerEmail: owner },
              );
              if (!archived) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return { ok: true };
            }

            // POST /threads/:id/fork — duplicate a thread with all its messages
            if (method === "POST" && isThreadSubroute("fork")) {
              const body = await readBody(event);
              const forked = await forkThread(threadId, owner, {
                id: body?.id,
                source: parseForkSourceFromBody(body?.source),
              });
              if (!forked) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              return forked;
            }

            if (method === "DELETE") {
              const thread = await getThread(threadId);
              if (!thread || thread.ownerEmail !== owner) {
                setResponseStatus(event, 404);
                return { error: "Thread not found" };
              }
              await deleteThread(threadId);
              return { ok: true };
            }

            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          // ── Thread list: GET/POST /threads ──
          if (method === "GET") {
            const query = getQuery(event);
            const limit = Math.min(
              parseInt(String(query.limit ?? "50"), 10) || 50,
              200,
            );
            const q = query.q ? String(query.q).trim() : "";
            const scope = parseScopeFromQuery(query);
            const unscopedOnly = String(query.unscoped ?? "") === "1";
            if (q) {
              const threads = await searchThreads(owner, q, limit, {
                scope: scope ?? undefined,
              });
              return { threads };
            }
            const offset = parseInt(String(query.offset ?? "0"), 10) || 0;
            const threads = await listThreads(owner, {
              limit,
              offset,
              scope: scope ?? undefined,
              unscopedOnly,
            });
            return { threads };
          }

          if (method === "POST") {
            const body = await readBody(event);
            // Idempotent: when the caller supplies an id and a thread with
            // that id already exists for this owner, return it instead of
            // 500'ing on the UNIQUE constraint. The client can race with
            // the agent run's `persistSubmittedUserMessage` (which also
            // creates the thread on first message); we don't want either
            // racer's POST/onRunPrepared retry to wipe the thread out of
            // the user's history.
            if (body?.id) {
              const existing = await getThread(body.id);
              if (existing) {
                if (existing.ownerEmail === owner) return existing;
                setResponseStatus(event, 409);
                return { error: "Thread id already in use" };
              }
            }
            try {
              const thread = await createThread(owner, {
                id: body?.id,
                title: body?.title ?? "",
                scope: parseScopeFromBody(body?.scope),
              });
              return thread;
            } catch (err) {
              // Lost the create race against another in-flight POST or
              // against `persistSubmittedUserMessage`. Re-fetch and
              // return the row that actually landed.
              if (body?.id) {
                const existing = await getThread(body.id);
                if (existing && existing.ownerEmail === owner) return existing;
              }
              throw err;
            }
          }

          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }),
      );

      // Mount the main chat handler — delegates to dev or prod handler based on current mode.
      // This is mounted last because h3's use() is prefix-based, meaning /_agent-native/agent-chat
      // also matches /_agent-native/agent-chat/threads/... — we skip sub-path requests here so the
      // earlier-mounted handlers (mode, save-key, files, skills, mentions, threads) handle them.
      getH3App(nitroApp).use(
        routePath,
        defineEventHandler(async (event) => {
          // Skip sub-path requests — they're handled by earlier-mounted handlers
          const url = event.node?.req?.url || event.path || "";
          const afterBase = url.slice(
            url.indexOf(routePath) + routePath.length,
          );
          if (afterBase && afterBase !== "/" && !afterBase.startsWith("?")) {
            // Not for us — return 404 so h3 doesn't swallow the request
            setResponseStatus(event, 404);
            return { error: "Not found" };
          }

          // Resolve per-request auth context
          const ownerContext = await resolveOwnerContext(event);
          const owner = ownerContext.owner;

          // Resolve org ID: explicit callback > session.orgId from Better Auth
          // > implicit org membership. Better Auth leaves session.orgId null
          // until the user explicitly switches orgs, so a fresh signup with
          // implicit membership (e.g. domain-matched org) would otherwise see
          // no org-scoped credentials. getOrgContext() does the same DB lookup
          // the /builder/status endpoint uses to decide "Connected".
          let resolvedOrgId: string | undefined;
          if (options?.resolveOrgId) {
            resolvedOrgId = (await options.resolveOrgId(event)) ?? undefined;
          } else {
            try {
              const session = await getSession(event);
              resolvedOrgId = session?.orgId ?? undefined;
            } catch {
              // Session not available
            }
            if (!resolvedOrgId) {
              try {
                const { getOrgContext } = await import("../org/context.js");
                const ctx = await getOrgContext(event);
                resolvedOrgId = ctx.orgId ?? undefined;
              } catch {
                // org_members table may not exist yet on first boot
              }
            }
          }

          // Propagate the caller's IANA timezone from `x-user-timezone` so that
          // tool calls made by the agent (e.g. log-meal with no explicit date)
          // resolve "today" in the user's local timezone instead of server UTC.
          const tzRaw = getHeader(event, "x-user-timezone");
          const timezone =
            typeof tzRaw === "string" &&
            tzRaw.trim().length > 0 &&
            tzRaw.trim().length < 64
              ? tzRaw.trim()
              : undefined;

          return runWithRequestContext(
            {
              userEmail: owner,
              userName: ownerContext.name,
              orgId: resolvedOrgId,
              timezone,
            },
            () => {
              // App-rendered chat can't host direct code edits — HMR/full
              // reloads would kill the same chat surface mid-run. Force the
              // prod handler (no shell / no fs); the prompt block injected by
              // `prodHandler.systemPrompt` then steers source changes to a
              // separate agent surface such as Builder or the dev frame.
              const blockInProductCodeEditing =
                shouldBlockInProductCodeEditing(event);
              const handler =
                ownerContext.anonymous && anonymousHandler
                  ? anonymousHandler
                  : !blockInProductCodeEditing && currentDevMode && devHandler
                    ? devHandler
                    : prodHandler;
              return handler(event);
            },
          );
        }),
      );

      // ─── Recurring Jobs Scheduler ──────────────────────────────────────
      // Poll every 60 seconds for due recurring jobs and execute them.
      // Uses setInterval so it works in all deployment environments without
      // requiring Nitro experimental tasks configuration.
      try {
        const { processRecurringJobs } = await import("../jobs/scheduler.js");

        const schedulerDeps = {
          getActions: () => ({
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...(lazyContext ? frameworkContextTool : {}),
            ...chatScripts,
            ...jobTools,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
            ...webSearchTool,
            ...toolActions,
          }),
          getSystemPrompt: async (owner: string) => {
            const resources = await loadResourcesForPrompt(
              owner,
              lazyContext,
              options?.appId,
            );
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, false);
            return basePrompt + resources + schemaBlock;
          },
          apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
          model: options?.model,
          appId: options?.appId,
        };

        // Start after a 10-second delay to let the server fully initialize
        setTimeout(() => {
          setInterval(() => {
            processRecurringJobs(schedulerDeps).catch((err) => {
              console.error("[recurring-jobs] Scheduler error:", err?.message);
            });
          }, 60_000);
          if (process.env.DEBUG)
            console.log("[recurring-jobs] Scheduler started (60s interval)");
        }, 10_000);
      } catch (err) {
        // Jobs module not available — skip silently
      }

      // ─── Agent Teams orphan sweep ─────────────────────────────────────
      // Re-fires stuck/queued dispatches when the browser is closed and the
      // RunsTray's per-user reconciliation never triggers. Runs every 2 minutes
      // per instance; cheap (one indexed query when no active tasks are found).
      // Throttled by the same per-owner interval guard inside reconcileAgentTeamRunsForOwner.
      (() => {
        // Track when this instance last ran the sweep so only one sweep fires
        // per 2-min window even if multiple timers fire in overlapping invocations.
        let lastSweep = 0;
        const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

        setTimeout(() => {
          setInterval(() => {
            const now = Date.now();
            if (now - lastSweep < SWEEP_INTERVAL_MS) return;
            lastSweep = now;

            (async () => {
              // Query distinct owners that have active queue rows.
              // Can't use reconcileAgentTeamRunsForOwner directly without
              // knowing the owner set — query the run queue table first.
              const { getDbExec } = await import("../db/client.js");
              const db = getDbExec();
              let rows: any[];
              try {
                const result = await db.execute(
                  `SELECT DISTINCT owner_email FROM agent_team_run_queue WHERE status IN ('queued', 'running') AND owner_email IS NOT NULL LIMIT 50`,
                );
                rows = result.rows as any[];
              } catch {
                return; // Table may not exist yet on first boot
              }
              const { reconcileAgentTeamRunsForOwner } =
                await import("./agent-teams.js");
              for (const row of rows) {
                const owner = String((row as any).owner_email ?? "").trim();
                if (!owner) continue;
                try {
                  await reconcileAgentTeamRunsForOwner(owner);
                } catch {
                  // best-effort per owner
                }
              }
            })().catch(() => {
              // best-effort — never break the server
            });
          }, 30_000); // Check every 30s but only sweep once per 2min
        }, 15_000); // Start 15s after init (after the scheduler)
      })();

      // ─── Trigger Dispatcher (event-based automations) ─────────────────
      try {
        const { initTriggerDispatcher } =
          await import("../triggers/dispatcher.js");
        await initTriggerDispatcher({
          getActions: () => ({
            ...templateScripts,
            ...resourceScripts,
            ...docsScripts,
            ...(lazyContext ? frameworkContextTool : {}),
            ...chatScripts,
            ...jobTools,
            ...automationTools,
            ...notificationTools,
            ...progressTools,
            ...fetchTool,
            ...webSearchTool,
            ...toolActions,
          }),
          getSystemPrompt: async (owner: string) => {
            const resources = await loadResourcesForPrompt(
              owner,
              lazyContext,
              options?.appId,
            );
            const schemaBlock = lazyContext
              ? ""
              : await buildSchemaBlock(owner, false);
            return basePrompt + resources + schemaBlock;
          },
          apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
          model: options?.model,
          appId: options?.appId,
        });
        if (process.env.DEBUG)
          console.log("[triggers] Trigger dispatcher initialized");
      } catch (err) {
        // Triggers module not available — skip silently
      }
    })().catch((err) => {
      // If the init fails, the routes never get registered and requests
      // to /_agent-native/agent-chat silently 404. Register a fallback
      // route so the user sees a meaningful error instead.
      const routePath = options?.path ?? "/_agent-native/agent-chat";
      const msg = (err as Error)?.message || String(err);
      console.error(
        `[agent-chat] Plugin init failed — registering error fallback: ${msg}`,
      );
      getH3App(nitroApp).use(
        routePath,
        defineEventHandler((event) => {
          setResponseStatus(event, 503);
          return {
            error: `Agent chat failed to initialize: ${msg}`,
          };
        }),
      );
    });
    trackPluginInit(nitroApp, initPromise, {
      paths: [
        options?.path ?? "/_agent-native/agent-chat",
        "/_agent-native/actions",
        "/_agent-native/agent-model-defaults",
        "/_agent-native/mcp",
      ],
    });
  };
}

/**
 * Default agent chat plugin with no template-specific actions.
 * In dev mode, provides file system, bash, and database tools.
 * In production, provides only the default system prompt.
 */
export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();

// ---------------------------------------------------------------------------
// MCP client glue — a shared manager reference + a /_agent-native/mcp/status
// route so onboarding / settings UIs can see which MCP servers are live.
// ---------------------------------------------------------------------------

let _globalMcpManager: McpClientManager | null = null;

function setGlobalMcpManager(manager: McpClientManager): void {
  _globalMcpManager = manager;
}

/** Internal: access the current process's MCP client manager, if any. */
export function getGlobalMcpManager(): McpClientManager | null {
  return _globalMcpManager;
}

function mountMcpHubStatusRoute(nitroApp: any): void {
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpHubStatusMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/hub/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        return getHubStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/hub/status: ${err?.message ?? err}`,
    );
  }
}

function mountMcpStatusRoute(nitroApp: any, manager: McpClientManager): void {
  // Idempotent per Nitro app; dev-all may host multiple templates in one process.
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpStatusMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        return manager.getStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/status: ${err?.message ?? err}`,
    );
  }
}
