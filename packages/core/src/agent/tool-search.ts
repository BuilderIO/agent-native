import { isActionHiddenFromEveryAgentSurface } from "../action.js";
import { parseMcpToolName } from "../mcp-client/manager.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
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
  return {
    tool: {
      description:
        "Find actions and connected MCP tools named `mcp__<server>__<tool>` by capability or name. A targeted search returns concise details and adds matches allowed in the current mode, with their full schemas, to the NEXT model step, not this one, so request every tool you need in one call (`queries` and/or `names`) and call them on the next step. If every match is already callable, call it directly instead of searching again. Omit query for a bounded alphabetical menu; menu entries are informational until you search for a capability or name.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Capability or exact tool name to find. A targeted search adds matches allowed in the current mode, with their full schemas, to the next model step. Omit for a bounded alphabetical inventory.",
          },
          queries: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_QUERIES,
            description: `Up to ${MAX_QUERIES} capability searches run together; all matches load on the next step.`,
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
  };
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
  if (priorSearch) {
    return {
      query,
      totalTools: priorSearch.totalTools,
      count: priorSearch.resultNames.length,
      repeated: true,
      message:
        query.length > 0
          ? "This exact tool-search query already ran in this agent run. Use the earlier result; matches allowed in the current mode are already available with their full schemas."
          : "This tool inventory already ran in this agent run. Use the earlier list, then search once by capability or tool name to load a matching tool's full schema.",
      results: priorSearch.resultNames.map((name) => ({
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
    const score = exactNames
      ? exactNames.has(name.toLowerCase())
        ? EXACT_NAME_SCORE
        : 0
      : scoreTool({
          query,
          queryTokens,
          name,
          source,
          description,
          parameters,
          kind,
        });

    if (score <= 0) continue;

    candidates.push({
      name,
      kind,
      ...(source ? { source } : {}),
      description: truncate(description, MAX_DESCRIPTION_CHARS),
      score,
      callable,
      planAvailability,
      parameters: parameters
        .slice(0, MAX_PARAMETER_COUNT)
        .map(boundParameterSummary),
    });
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
  const result = {
    query,
    totalTools,
    count: Math.min(candidates.length, cap),
    ...(missing && missing.length > 0
      ? {
          message: `No tool named ${missing.join(", ")} is available in the current mode.`,
        }
      : {}),
    results: candidates.slice(0, cap),
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

function scoreTool(input: {
  query: string;
  queryTokens: string[];
  name: string;
  source?: string;
  description: string;
  parameters: ToolParameterSummary[];
  kind: "action" | "mcp";
}): number {
  if (input.queryTokens.length === 0) return 1;

  const name = searchableText(input.name);
  const source = searchableText(input.source ?? "");
  const description = searchableText(input.description);
  const params = searchableText(
    input.parameters
      .map((p) => `${p.name} ${p.type ?? ""} ${p.description ?? ""}`)
      .join(" "),
  );
  const all = `${name} ${source} ${description} ${params} ${input.kind}`;
  const phrase = searchableText(input.query);

  let score = 0;
  if (name.includes(phrase)) score += 14;
  if (source && source.includes(phrase)) score += 10;
  if (description.includes(phrase)) score += 8;
  if (params.includes(phrase)) score += 5;

  for (const token of input.queryTokens) {
    if (name.split(" ").includes(token)) score += 9;
    else if (name.includes(token)) score += 6;

    if (source) {
      if (source.split(" ").includes(token)) score += 6;
      else if (source.includes(token)) score += 3;
    }

    if (description.includes(token)) score += 3;
    if (params.includes(token)) score += 2;
    if (all.includes(token)) score += 1;
  }

  return score;
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  for (const token of searchableText(value).split(" ")) {
    if (token.length > 0) seen.add(token);
  }
  return Array.from(seen);
}

function searchableText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
