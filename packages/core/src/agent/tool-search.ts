import { isActionHiddenFromEveryAgentSurface } from "../action.js";
import { parseMcpToolName } from "../mcp-client/manager.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import {
  frameworkMcpTool,
  isFrameworkMcpTool,
} from "../mcp/framework-tools.js";
import { getRequestRunContext } from "../server/request-context.js";
import { clipHead } from "./clip-text.js";
import type { ActionEntry } from "./production-agent.js";

export const TOOL_SEARCH_ACTION_NAME = "tool-search";

type ToolSearchArgs = {
  query?: unknown;
  queries?: unknown;
  names?: unknown;
  limit?: unknown;
  includeSchemas?: unknown;
  readOnlyOnly?: unknown;
};

type ToolParameterSummary = {
  name: string;
  type?: string;
  required: boolean;
  description?: string;
  enum?: string[];
};

type ToolSearchResult = {
  name: string;
  kind: "action" | "mcp";
  source?: string;
  description: string;
  score: number;
  callable: boolean;
  planAvailability: "read" | "conditional" | "act-only";
  /** Present on a tool that deletes or cancels; absent on every other. */
  destructive?: true;
  parameters: ToolParameterSummary[];
};

type ToolSearchOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
const MAX_QUERIES = 5;
const MAX_NAMES = 20;
const EXACT_NAME_SCORE = 100;
const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_DESCRIPTION_CHARS = 120;
const MAX_MENU_DESCRIPTION_CHARS = 140;
const MAX_DESCRIPTION_CHARS = 220;
const MAX_PARAMETER_COUNT = 8;
const MAX_PARAMETER_DESCRIPTION_CHARS = 120;
const MAX_ENUM_VALUES = 5;
const MAX_ENUM_VALUE_CHARS = 60;

export function createToolSearchEntry(
  getRegistry: () => Record<string, ActionEntry>,
  options: ToolSearchOptions = {},
): ActionEntry {
  const maxLimit = Math.max(
    1,
    Math.min(options.maxLimit ?? MAX_LIMIT, MAX_LIMIT),
  );
  const defaultLimit = Math.max(
    1,
    Math.min(options.defaultLimit ?? DEFAULT_LIMIT, maxLimit),
  );
  return frameworkMcpTool({
    tool: {
      description:
        "Find actions and connected MCP tools by what they do or by exact name. The system prompt's Tool index lists every deferred tool name grouped by topic; loading several exact names in one call is the fastest path. When no listed name clearly fits, search for the task itself. A targeted search returns concise details and adds matches allowed in the current mode, with their full schemas, to the NEXT model step, not this one, so request every tool you need in one call (`queries` and/or `names`) and call them on the next step. If every match is already callable, call it directly instead of searching again. Search ranks by words, not intent, so a request not to delete still finds delete tools: before calling a result marked `destructive`, confirm the user asked for that change. Omit query for a bounded alphabetical menu; menu entries are informational until you search for a capability or name.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'The task in a few plain words, such as "edit auto-archive rules" or "move a meeting", or an exact tool name. The user\'s own words work: matching covers plurals, common synonyms, and words each tool lists as search hints. A targeted search adds matches allowed in the current mode, with their full schemas, to the next model step. Omit for a bounded alphabetical inventory.',
          },
          queries: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_QUERIES,
            description: `Up to ${MAX_QUERIES} searches run together, one per step of a multi-step task; all matches load on the next step.`,
          },
          names: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_NAMES,
            description:
              "Exact tool names to load on the next step, together with any queries.",
          },
          limit: {
            type: "number",
            description: `Maximum results to return per query, including menu mode. Defaults to ${defaultLimit}; capped at ${maxLimit}.`,
          },
          includeSchemas: {
            type: "boolean",
            description:
              "Accepted for compatibility. Full schemas are supplied automatically for tools returned by a targeted search.",
          },
          readOnlyOnly: {
            type: "boolean",
            description:
              "When true, return tools whose current policy is read-only or can classify the supplied arguments as read-only. The bounded orchestration host rechecks conditional policies before every call.",
          },
        },
      },
    },
    http: false,
    readOnly: true,
    run: async (args: Record<string, string>, context) =>
      searchToolRegistryForRequest(getRegistry(), args, options, context),
  });
}

export function attachToolSearch(
  registry: Record<string, ActionEntry>,
  options: ToolSearchOptions = {},
): Record<string, ActionEntry> {
  registry[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(
    () => registry,
    options,
  );
  return registry;
}

export async function filterActionsForAgentDiscovery(
  registry: Record<string, ActionEntry>,
  context?: import("../action.js").ActionRunContext,
): Promise<Record<string, ActionEntry>> {
  const checks = new Map<
    NonNullable<ActionEntry["agentDiscoveryAvailable"]>,
    Promise<boolean>
  >();
  for (const entry of Object.values(registry)) {
    const predicate = entry.agentDiscoveryAvailable;
    if (predicate && !checks.has(predicate)) {
      checks.set(predicate, Promise.resolve(predicate(context)));
    }
  }

  const availability = new Map<
    NonNullable<ActionEntry["agentDiscoveryAvailable"]>,
    boolean
  >();
  await Promise.all(
    [...checks].map(async ([predicate, check]) => {
      availability.set(predicate, await check);
    }),
  );

  const filtered = Object.fromEntries(
    Object.entries(registry)
      .filter(([, entry]) => {
        const predicate = entry.agentDiscoveryAvailable;
        return !predicate || availability.get(predicate) === true;
      })
      .map(([name, entry]) => {
        const visibleEntry = { ...entry };
        delete visibleEntry.agentDiscoveryAvailable;
        return [name, visibleEntry];
      }),
  );
  if (filtered[TOOL_SEARCH_ACTION_NAME]) {
    filtered[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => filtered);
  }
  return filtered;
}

type ToolSearchOutput = {
  query: string;
  totalTools: number;
  count: number;
  repeated?: boolean;
  message?: string;
  results: ToolSearchResult[];
  suggestions?: Array<{ name: string; description: string }>;
};

/**
 * One call may carry several capability queries and exact names; every match
 * loads on the same next step. Each query keeps its own repeat guard.
 */
export function searchToolRegistry(
  registry: Record<string, ActionEntry>,
  args: ToolSearchArgs = {},
  options: ToolSearchOptions = {},
): ToolSearchOutput {
  const { parsedQueries, parsedNames } = parseToolSearchLists(args);
  const queries = parsedQueries.kept;
  const names = parsedNames.kept;
  // Providers rarely enforce `maxItems`; a silently dropped entry reads as a
  // tool that loaded.
  const truncationNote = [
    droppedEntriesNote("queries", MAX_QUERIES, parsedQueries.dropped),
    droppedEntriesNote("names", MAX_NAMES, parsedNames.dropped),
  ]
    .filter(Boolean)
    .join(" ");
  const withTruncationNote = (output: ToolSearchOutput): ToolSearchOutput =>
    truncationNote
      ? {
          ...output,
          message: [output.message, truncationNote].filter(Boolean).join(" "),
        }
      : output;
  const targets: SearchTarget[] = [
    ...queries.map((query) => ({ query })),
    ...(names.length > 0 ? [{ names }] : []),
  ];
  if (targets.length <= 1) {
    return withTruncationNote(
      searchOnce(registry, targets[0] ?? { query: "" }, args, options),
    );
  }
  const parts = targets.map((target) =>
    searchOnce(registry, target, args, options),
  );
  const byName = new Map<string, ToolSearchResult>();
  for (const part of parts) {
    for (const result of part.results) {
      const existing = byName.get(result.name);
      if (!existing || result.score > existing.score) {
        byName.set(result.name, result);
      }
    }
  }
  const results = [...byName.values()].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  const allRepeated = parts.every((part) => part.repeated);
  const message = allRepeated
    ? parts[0].message
    : parts
        .filter((part) => !part.repeated && part.message)
        .map((part) => part.message)
        .join(" ");
  return withTruncationNote({
    query: parts.map((part) => part.query).join(" | "),
    totalTools: Math.max(...parts.map((part) => part.totalTools)),
    count: results.length,
    ...(allRepeated ? { repeated: true } : {}),
    ...(message ? { message } : {}),
    results,
  });
}

type SearchTarget = { query: string } | { names: string[] };

function searchOnce(
  registry: Record<string, ActionEntry>,
  target: SearchTarget,
  args: ToolSearchArgs,
  options: ToolSearchOptions,
): ToolSearchOutput {
  const names = "names" in target ? target.names : undefined;
  const exactNames = names
    ? new Set(names.map((name) => name.toLowerCase()))
    : undefined;
  const query = names
    ? `names: ${names.join(", ")}`
    : "query" in target
      ? target.query
      : "";
  const listAll = query.length === 0;
  const readOnlyOnly = parseBoolean(args.readOnlyOnly);
  const limit = parseLimit(
    args.limit,
    options.defaultLimit ?? DEFAULT_LIMIT,
    Math.min(options.maxLimit ?? MAX_LIMIT, MAX_LIMIT),
  );
  const cacheKey = normalizeToolSearchCacheKey({
    query,
    limit,
    readOnlyOnly,
  });
  const runCtx = getRequestRunContext();
  const priorSearch = runCtx?.toolSearchReads?.[cacheKey];
  // A repeated search that found nothing is recomputed so it keeps its
  // close-name suggestions instead of a bare "use the earlier result".
  if (priorSearch && priorSearch.resultNames.length > 0) {
    const filteredNames = priorSearch.resultNames.filter((name) => {
      const entry = registry[name];
      if (!entry?.tool || isActionHiddenFromEveryAgentSurface(entry))
        return false;
      if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name))
        return false;
      return true;
    });
    return {
      query,
      totalTools: priorSearch.totalTools,
      count: filteredNames.length,
      repeated: true,
      message:
        query.length > 0
          ? "This exact tool-search query already ran in this agent run. Use the earlier result; matches allowed in the current mode are already available with their full schemas."
          : "This tool inventory already ran in this agent run. Use the earlier list, then search once by capability or tool name to load a matching tool's full schema.",
      results: filteredNames.map((name) => ({
        name,
        kind: parseMcpToolName(name) ? ("mcp" as const) : ("action" as const),
        score: 0,
        callable: registry[name]?.allowInPlanMode !== false,
        planAvailability: getPlanAvailability(name, registry[name]),
        description:
          "Already returned by an earlier identical tool-search call.",
        parameters: [],
      })),
    };
  }
  const queryTokens = tokenize(query);

  const candidates: ToolSearchResult[] = [];
  const rankable: RankableTool[] = [];
  let totalTools = 0;

  for (const [name, entry] of Object.entries(registry)) {
    if (!entry?.tool || name === TOOL_SEARCH_ACTION_NAME) continue;
    if (isActionHiddenFromEveryAgentSurface(entry)) continue;
    if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
      continue;
    }

    const description = normalizeWhitespace(entry.tool.description ?? "");
    const parsedMcp = parseMcpToolName(name);
    const kind = parsedMcp ? "mcp" : "action";
    const source = parsedMcp?.serverId;
    const callable = entry.allowInPlanMode !== false;
    const planAvailability = getPlanAvailability(name, entry);
    if (
      readOnlyOnly &&
      planAvailability !== "read" &&
      (planAvailability !== "conditional" || name === "bash")
    ) {
      continue;
    }

    totalTools++;

    if (listAll) {
      candidates.push({
        name,
        kind,
        ...(source ? { source } : {}),
        description: truncate(description, MAX_MENU_DESCRIPTION_CHARS),
        score: 0,
        callable,
        planAvailability,
        parameters: [],
      });
      continue;
    }

    const parameters = summarizeParameters(entry.tool.parameters);
    const candidate: ToolSearchResult = {
      name,
      kind,
      ...(source ? { source } : {}),
      description: truncate(description, MAX_DESCRIPTION_CHARS),
      score: 0,
      callable,
      planAvailability,
      ...(isDestructiveTool(name, entry) ? { destructive: true } : {}),
      parameters: parameters
        .slice(0, MAX_PARAMETER_COUNT)
        .map(boundParameterSummary),
    };
    if (exactNames) {
      if (exactNames.has(name.toLowerCase())) {
        candidates.push({ ...candidate, score: EXACT_NAME_SCORE });
      }
      continue;
    }
    rankable.push({
      candidate,
      prior: isFrameworkMcpTool(entry) ? FRAMEWORK_TOOL_PRIOR : 1,
      fields: searchDocumentFields({
        name,
        source,
        hints: entry.searchHints,
        description,
        parameters,
      }),
    });
  }
  if (!listAll && !exactNames) {
    candidates.push(...rankByBm25(query, queryTokens, rankable));
  }

  if (listAll) {
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const result = {
      query,
      totalTools,
      count: Math.min(candidates.length, limit),
      message: `Showing ${Math.min(candidates.length, limit)} of ${totalTools} tools in alphabetical order. Search once by capability or tool name to load matching schemas for tools allowed in the current mode.`,
      results: candidates.slice(0, limit),
    };
    rememberToolSearchResult(cacheKey, result);
    return result;
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  const cap = exactNames ? MAX_NAMES : limit;
  const found = new Set(
    candidates.map((candidate) => candidate.name.toLowerCase()),
  );
  const missing = names?.filter((name) => !found.has(name.toLowerCase()));

  let suggestions: Array<{ name: string; description: string }> | undefined;
  let fallbackMessage: string | undefined;
  if (!exactNames && !listAll && candidates.length === 0) {
    suggestions = suggestCloseTools(rankable, queryTokens);
    if (suggestions.length > 0) {
      fallbackMessage = `No tool matched "${query}". Closest tool names: ${suggestions.map((s) => s.name).join(", ")}. Load one by exact name with \`names\`, or search again with a different capability word — the Tool index in your instructions lists every tool by topic.`;
    } else {
      fallbackMessage = `No tool matched "${query}". Check the Tool index in your instructions for the right name, or search again with a different capability word.`;
    }
  }

  const result = {
    query,
    totalTools,
    count: Math.min(candidates.length, cap),
    ...(missing && missing.length > 0
      ? {
          message: `No tool named ${missing.join(", ")} is available in the current mode.`,
        }
      : fallbackMessage
        ? { message: fallbackMessage }
        : {}),
    results: candidates.slice(0, cap),
    ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
    ...(priorSearch ? { repeated: true } : {}),
  };
  rememberToolSearchResult(cacheKey, result);
  return result;
}

export async function searchToolRegistryForRequest(
  registry: Record<string, ActionEntry>,
  args: ToolSearchArgs = {},
  options: ToolSearchOptions = {},
  context?: import("../action.js").ActionRunContext,
): Promise<ReturnType<typeof searchToolRegistry>> {
  const visibleRegistry = await filterActionsForAgentDiscovery(
    registry,
    context,
  );
  return searchToolRegistry(visibleRegistry, args, options);
}

const PLAN_MODE_BLOCKED_DISCOVERY_TOOLS = new Set([
  "refresh-screen",
  "set-search-params",
  "set-url-path",
  "open-settings-page",
]);

function getPlanAvailability(
  name: string,
  entry: ActionEntry | undefined,
): ToolSearchResult["planAvailability"] {
  if (!entry || entry.allowInPlanMode === false) return "act-only";
  if (PLAN_MODE_BLOCKED_DISCOVERY_TOOLS.has(name)) return "act-only";
  if (name === "bash") return "conditional";
  if (typeof entry.planMode?.effect === "function") return "conditional";
  if (entry.planMode?.effect === "read") return "read";
  if (
    entry.planMode?.effect === "write" ||
    entry.planMode?.effect === "unknown"
  ) {
    return "act-only";
  }
  return entry.readOnly === true ? "read" : "act-only";
}

function normalizeToolSearchCacheKey(options: {
  query: string;
  limit: number;
  readOnlyOnly: boolean;
}): string {
  return JSON.stringify({
    query: options.query.trim().toLowerCase(),
    limit: options.limit,
    readOnlyOnly: options.readOnlyOnly,
  });
}

function rememberToolSearchResult(
  cacheKey: string,
  result: { totalTools: number; results: Array<{ name: string }> },
) {
  const runCtx = getRequestRunContext();
  if (!runCtx) return;
  const reads = (runCtx.toolSearchReads ??= {});
  reads[cacheKey] = {
    totalTools: result.totalTools,
    resultNames: result.results.map((item) => item.name),
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${clipHead(value, max - 1).trimEnd()}…`;
}

function parseToolSearchLists(args: ToolSearchArgs) {
  return {
    parsedQueries: parseStringList(
      [String(args.query ?? ""), args.queries],
      MAX_QUERIES,
    ),
    parsedNames: parseStringList([args.names], MAX_NAMES),
  };
}

/**
 * Whether a search names anything to look for. A menu search (no query,
 * queries or names) only lists, so a caller that grants tools from a search
 * result must not grant from it. Reads the lists exactly as the search does,
 * so a form the search accepts is never read as a menu search.
 */
export function isTargetedToolSearch(args: object): boolean {
  const { parsedQueries, parsedNames } = parseToolSearchLists(args);
  return parsedQueries.kept.length > 0 || parsedNames.kept.length > 0;
}

/** Callable matches of a targeted search; empty for a menu or an error. */
export function extractToolSearchResultNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const result = value as { query?: unknown; results?: unknown };
  if (typeof result.query !== "string" || result.query.trim().length === 0) {
    return [];
  }
  if (!Array.isArray(result.results)) return [];
  const names: string[] = [];
  for (const item of result.results) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.callable === false) continue;
    const name = record.name;
    if (typeof name === "string" && name.trim()) names.push(name);
  }
  return names;
}

/**
 * The tools a search made callable lead its stored result. Replayed history
 * clips a result mid-object, and the loaded list must outlive that clip, so it
 * is read before the rest of the object is parsed.
 */
export function withLoadedToolNames<T extends object>(
  output: T,
  names: string[],
) {
  return { loadedForNextStep: names, ...output };
}

const LEADING_LOADED_TOOL_NAMES =
  /^\s*\{\s*"loadedForNextStep"\s*:\s*(\[\s*(?:"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*)?\s*\])/;

/**
 * Tools a stored tool-search result made callable. `[]` means it loaded
 * nothing, which includes a failed or interrupted search (not an object);
 * `null` means it is a search result that cannot be read, clipped or corrupt.
 */
export function readLoadedToolNames(content: string): string[] | null {
  try {
    const leading = LEADING_LOADED_TOOL_NAMES.exec(content);
    if (leading) return JSON.parse(leading[1]) as string[];
    if (!content.trimStart().startsWith("{")) return [];
    // Results stored before the loaded list existed carry every callable
    // match. Pretty-printed JSON has no blank line, so notes appended after
    // the object start at the first one.
    const end = content.indexOf("\n\n");
    return extractToolSearchResultNames(
      JSON.parse(end < 0 ? content : content.slice(0, end)),
    );
    // coercion-ok: unreadable returns null, which callers tell apart from [] (loaded nothing) and warn about
  } catch {
    return null;
  }
}

function parseStringList(
  values: unknown[],
  max: number,
): { kept: string[]; dropped: string[] } {
  const unique = new Map<string, string>();
  for (const item of values.flat()) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !unique.has(trimmed.toLowerCase())) {
      unique.set(trimmed.toLowerCase(), trimmed);
    }
  }
  const all = [...unique.values()];
  return { kept: all.slice(0, max), dropped: all.slice(max) };
}

function droppedEntriesNote(
  kind: string,
  max: number,
  dropped: readonly string[],
): string {
  if (dropped.length === 0) return "";
  return `Only the first ${max} ${kind} were used; ${dropped.length} more were ignored (${truncate(dropped.join(", "), 200)}). Request them in another call.`;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function summarizeParameters(schema: unknown): ToolParameterSummary[] {
  if (!schema || typeof schema !== "object") return [];
  const obj = schema as {
    properties?: Record<string, unknown>;
    required?: unknown;
  };
  const properties = obj.properties;
  if (!properties || typeof properties !== "object") return [];
  const required = new Set(
    Array.isArray(obj.required)
      ? obj.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );

  return Object.entries(properties).map(([name, raw]) => {
    const prop =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const enumValues = Array.isArray(prop.enum)
      ? prop.enum
          .slice(0, MAX_ENUM_VALUES)
          .map((value) => truncate(String(value), MAX_ENUM_VALUE_CHARS))
      : undefined;
    return {
      name,
      type: summarizeType(prop.type),
      required: required.has(name),
      description:
        typeof prop.description === "string"
          ? normalizeWhitespace(prop.description)
          : undefined,
      ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
    };
  });
}

function boundParameterSummary(
  parameter: ToolParameterSummary,
): ToolParameterSummary {
  return {
    ...parameter,
    ...(parameter.description
      ? {
          description: truncate(
            parameter.description,
            MAX_PARAMETER_DESCRIPTION_CHARS,
          ),
        }
      : {}),
  };
}

function summarizeType(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string");
    return parts.length > 0 ? parts.join(" | ") : undefined;
  }
  return undefined;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const NAME_PHRASE_BONUS = 5;
const SYNONYM_WEIGHT = 0.5;

// BM25F: each field is length-normalised on its own, then weighted, so a long
// description cannot drown a one-word name match. Search hints are words users
// say for the action, so they rank just below the name; the first sentence of
// a description says what the tool is for and outranks the caveats after it.
const FIELD_WEIGHTS = {
  name: 5,
  hints: 4,
  source: 2,
  summary: 2,
  details: 1,
  parameters: 0.5,
} as const;

type SearchField = keyof typeof FIELD_WEIGHTS;
const SEARCH_FIELDS = Object.keys(FIELD_WEIGHTS) as SearchField[];

type FieldTerms = { counts: Map<string, number>; length: number };
type RankableTool = {
  candidate: ToolSearchResult;
  /** Multiplies the text score; see `FRAMEWORK_TOOL_PRIOR`. */
  prior: number;
  fields: Record<SearchField, FieldTerms>;
};

// Framework tools (sharing, review comments, usage, settings) ship in every
// app and share its vocabulary: in Mail, "email" also names transactional
// email logs. A request made in an app is usually about that app's own work,
// so on similar text the app's actions rank first. Exact names still win.
const FRAMEWORK_TOOL_PRIOR = 0.8;

// Stemming would fold these nouns into an unrelated word ("news" into "new",
// which then expands to the create synonyms; "setting" into "set"), so they
// are indexed as themselves. Declared before the stemmed set below, which
// calls `stem` as the module loads.
const PROTECTED_TERMS: ReadonlyMap<string, string> = new Map([
  ["news", "news"],
  ["setting", "setting"],
  ["settings", "setting"],
  ["recording", "recording"],
  ["recordings", "recording"],
  ["mapping", "mapping"],
  ["mappings", "mapping"],
  ["heading", "heading"],
  ["headings", "heading"],
]);

const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set(
  [
    "delete",
    "remove",
    "trash",
    "erase",
    "clear",
    "destroy",
    "wipe",
    "purge",
    "cancel",
  ].map(stem),
);

/**
 * Whether a result is marked `destructive`. Ranking ignores it: whether the
 * user wants the change ("delete it" or "don't delete it") is the agent's call,
 * so a search finds the tool either way and the mark tells the agent to check.
 * A tool is destructive when it declares `destructiveHint`, or when one of its
 * operations deletes (`manage-gmail-filters`' `operation: "delete"`).
 * Without annotations, a name that leads with a destructive verb also counts,
 * since most delete actions declare none.
 */
function isDestructiveTool(name: string, entry: ActionEntry): boolean {
  if (entry.mcpAnnotations?.destructiveHint === true) return true;
  if (hasDestructiveOperation(entry.tool.parameters)) return true;
  if (entry.mcpAnnotations) return false;
  const verb = searchTerms(parseMcpToolName(name)?.toolName ?? name).at(0);
  return verb !== undefined && DESTRUCTIVE_VERBS.has(verb);
}

const OPERATION_PARAMETERS: ReadonlySet<string> = new Set([
  "action",
  "operation",
  "op",
  "mode",
]);

function hasDestructiveOperation(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const { properties } = schema as { properties?: unknown };
  if (!properties || typeof properties !== "object") return false;
  return Object.entries(properties).some(([key, property]) => {
    if (!OPERATION_PARAMETERS.has(key)) return false;
    const values: unknown =
      property && typeof property === "object"
        ? (property as { enum?: unknown }).enum
        : undefined;
    return (
      Array.isArray(values) &&
      values.some(
        (value) =>
          typeof value === "string" &&
          searchTerms(value).some((term) => DESTRUCTIVE_VERBS.has(term)),
      )
    );
  });
}

function fieldTerms(value: string): FieldTerms {
  const terms = searchTerms(value);
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return { counts, length: terms.length };
}

function searchDocumentFields(doc: {
  name: string;
  source: string | undefined;
  hints: readonly string[] | undefined;
  description: string;
  parameters: ToolParameterSummary[];
}): Record<SearchField, FieldTerms> {
  const sentenceEnd = doc.description.search(/[.!?](\s|$)/);
  const summaryEnd = sentenceEnd < 0 ? doc.description.length : sentenceEnd + 1;
  return {
    name: fieldTerms(doc.name),
    hints: fieldTerms((doc.hints ?? []).join(" ")),
    source: fieldTerms(doc.source ?? ""),
    summary: fieldTerms(doc.description.slice(0, summaryEnd)),
    details: fieldTerms(doc.description.slice(summaryEnd)),
    parameters: fieldTerms(
      doc.parameters.map((p) => `${p.name} ${p.description ?? ""}`).join(" "),
    ),
  };
}

// Common verbs and nouns users say in place of the words tool names use. They
// count for half of a literal match, so the user's own word still wins.
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["create", "make", "new", "add"],
  ["delete", "remove", "trash", "erase", "clear"],
  ["update", "change", "edit", "modify", "rename", "adjust"],
  ["search", "find", "look", "lookup"],
  ["list", "show"],
  ["view", "see", "open"],
  ["restore", "undo", "revert", "recover"],
  ["export", "download"],
  ["duplicate", "copy", "clone"],
  ["reply", "respond", "answer"],
  ["image", "picture", "photo"],
  ["document", "doc", "page"],
  ["email", "mail", "message"],
  ["setting", "preference"],
];

const SYNONYMS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const stems = group.map(stem);
    for (const word of stems) {
      const others = stems.filter((other) => other !== word);
      map.set(word, [...(map.get(word) ?? []), ...others]);
    }
  }
  return map;
})();

function weightedQueryTerms(queryTokens: string[]): Map<string, number> {
  const weights = new Map(queryTokens.map((term) => [term, 1]));
  for (const term of queryTokens) {
    for (const synonym of SYNONYMS.get(term) ?? []) {
      if (!weights.has(synonym)) weights.set(synonym, SYNONYM_WEIGHT);
    }
  }
  return weights;
}

// Corpus statistics come from every tool that survived this call's filters, so
// a word most tools share ("get", "list", "app") ranks below a rare one.
function rankByBm25(
  query: string,
  queryTokens: string[],
  docs: RankableTool[],
): ToolSearchResult[] {
  if (queryTokens.length === 0 || docs.length === 0) return [];
  const queryTerms = weightedQueryTerms(queryTokens);
  // Averaged over the tools that fill the field: most tools have no search
  // hints, and counting them would make every hint list look too long.
  const averageLength = Object.fromEntries(
    SEARCH_FIELDS.map((field) => {
      const lengths = docs
        .map((doc) => doc.fields[field].length)
        .filter((length) => length > 0);
      return [
        field,
        lengths.reduce((sum, length) => sum + length, 0) / lengths.length || 1,
      ];
    }),
  ) as Record<SearchField, number>;
  const idf = new Map(
    [...queryTerms.keys()].map((term) => {
      const frequency = docs.filter((doc) =>
        SEARCH_FIELDS.some((field) => doc.fields[field].counts.has(term)),
      ).length;
      return [
        term,
        Math.log(1 + (docs.length - frequency + 0.5) / (frequency + 0.5)),
      ] as const;
    }),
  );
  const wholeQuery = query.trim().toLowerCase();
  return docs.flatMap((doc) => {
    const { candidate } = doc;
    if (candidate.name.toLowerCase() === wholeQuery) {
      return [{ ...candidate, score: EXACT_NAME_SCORE }];
    }
    let score = 0;
    for (const [term, queryWeight] of queryTerms) {
      let weightedFrequency = 0;
      for (const field of SEARCH_FIELDS) {
        const count = doc.fields[field].counts.get(term);
        if (!count) continue;
        weightedFrequency +=
          (FIELD_WEIGHTS[field] * count) /
          (1 -
            BM25_B +
            (BM25_B * doc.fields[field].length) / averageLength[field]);
      }
      if (weightedFrequency === 0) continue;
      score +=
        queryWeight *
        (idf.get(term) ?? 0) *
        ((weightedFrequency * (BM25_K1 + 1)) / (weightedFrequency + BM25_K1));
    }
    if (score <= 0) return [];
    if (
      queryTokens.length > 1 &&
      containsTokenRun(tokenize(candidate.name), queryTokens)
    ) {
      score += NAME_PHRASE_BONUS;
    }
    score *= doc.prior;
    return [{ ...candidate, score: Math.round(score * 100) / 100 }];
  });
}

// Whole tokens in order, so "view email" never matches inside "preview-email"
// and "archive email" never matches inside "unarchive-email".
function containsTokenRun(tokens: string[], run: string[]): boolean {
  for (let start = 0; start + run.length <= tokens.length; start++) {
    if (run.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

// Suggestions are never loaded, so a query with no exact term still points the
// model at real names instead of an empty result.
function suggestCloseTools(
  docs: RankableTool[],
  queryTokens: string[],
): Array<{ name: string; description: string }> {
  const prefixes = queryTokens
    .filter((token) => token.length >= 3)
    .map((token) => token.slice(0, 3));
  if (prefixes.length === 0) return [];
  return docs
    .map(({ candidate, fields }) => {
      const terms = [
        ...fields.name.counts.keys(),
        ...fields.hints.counts.keys(),
        ...fields.summary.counts.keys(),
        ...fields.details.counts.keys(),
      ];
      const overlap = prefixes.filter((prefix) =>
        terms.some((term) => term.startsWith(prefix)),
      ).length;
      return { candidate, overlap };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.candidate.name.localeCompare(b.candidate.name),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map(({ candidate }) => ({
      name: candidate.name,
      description: truncate(
        candidate.description,
        MAX_SUGGESTION_DESCRIPTION_CHARS,
      ),
    }));
}

// Function words carry no capability, and conversational requests are full of
// them ("can you show me what I have"). Indexed text drops them too, so a
// description's "you can" never matches a request's.
const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a about after again also am an and any are as at be been before being " +
    "but by can could did do does doing done for from had has have having " +
    "he her here hers him his how i if in into is it its just let lets me " +
    "mine my myself no not now of off on once only or our ours please she " +
    "should so some such than thank thanks that the their theirs them then " +
    "there these they this those to too up us very want was we were what " +
    "when where which while who whom why will with would you your yours"
  ).split(" "),
);

// Light, inflection-only stemming, the same on both sides of the match:
// plurals, "-ed" and "-ing" (undoubling "running" to "run"), and a final
// "-e", so "archived", "archiving" and "archive" meet at "archiv" and "saved"
// meets "save". Full Porter stemming was measured on the benchmark and lost a
// held-out case: it folds derivations together ("engineering" into "engine").
function stem(term: string): string {
  const protectedTerm = PROTECTED_TERMS.get(term);
  if (protectedTerm) return protectedTerm;
  let stemmed = term;
  if (stemmed.length > 4 && stemmed.endsWith("ies")) {
    stemmed = `${stemmed.slice(0, -3)}y`;
  } else if (stemmed.length > 4 && /(ches|shes|sses|xes|zes)$/.test(stemmed)) {
    stemmed = stemmed.slice(0, -2);
  } else if (
    stemmed.length > 3 &&
    stemmed.endsWith("s") &&
    !/(ss|us|is)$/.test(stemmed)
  ) {
    stemmed = stemmed.slice(0, -1);
  }
  if (/^[aeiou][^aeiouy](?:ing|ed)$/u.test(stemmed)) {
    // "using" and "used" lost the "e" of "use", as "owing" did of "owe".
    stemmed = `${stemmed.slice(0, 2)}e`;
  } else if (stemmed.length > 5 && stemmed.endsWith("ing")) {
    stemmed = undoubleFinalConsonant(stemmed.slice(0, -3));
  } else if (stemmed.length > 4 && stemmed.endsWith("ied")) {
    stemmed = `${stemmed.slice(0, -3)}y`;
  } else if (stemmed.length > 4 && stemmed.endsWith("ed")) {
    stemmed = undoubleFinalConsonant(stemmed.slice(0, -2));
  }
  if (stemmed.length >= 4 && stemmed.endsWith("e")) {
    stemmed = stemmed.slice(0, -1);
  }
  return stemmed;
}

// "running" and "stopped" double the consonant before the suffix, so their
// stems must drop it to meet "run" and "stop". Base words that end in a double
// letter ("fill", "dress", "buzz", "stuff") keep it, as do stems that would
// shrink to two letters ("adding" stays "add"). A long "-ell" stem is the
// British doubling of "cancelled" and "labelled"; "spell" and "sell" are short.
function undoubleFinalConsonant(stemmed: string): string {
  return (stemmed.length >= 4 && /([bcdgkmnprt])\1$/.test(stemmed)) ||
    (stemmed.length >= 6 && stemmed.endsWith("ell"))
    ? stemmed.slice(0, -1)
    : stemmed;
}

function searchTerms(value: string): string[] {
  return value
    .split(/[^A-Za-z0-9]+/)
    .flatMap((word) => {
      const parts = word
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(" ");
      // Users type "PowerPoint" and "HubSpot" as one word, too.
      return parts.length > 1 ? [...parts, word.toLowerCase()] : parts;
    })
    .filter(
      (term) => (term.length > 1 || /\d/.test(term)) && !STOP_WORDS.has(term),
    )
    .map(stem);
}

function tokenize(value: string): string[] {
  return [...new Set(searchTerms(value))];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
