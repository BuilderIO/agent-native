import type { ActionEntry } from "./production-agent.js";
import { parseMcpToolName } from "../mcp-client/manager.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";

export const TOOL_SEARCH_ACTION_NAME = "tool-search";

type ToolSearchArgs = {
  query?: unknown;
  limit?: unknown;
  includeSchemas?: unknown;
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
  parameters: ToolParameterSummary[];
  inputSchema?: unknown;
};

type ToolSearchOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export function createToolSearchEntry(
  getRegistry: () => Record<string, ActionEntry>,
  options: ToolSearchOptions = {},
): ActionEntry {
  return {
    tool: {
      description:
        "Search the live registry of callable tools/actions, including connected MCP server tools named `mcp__<server>__<tool>`. Use this when you need a capability but are not sure which tool to call, especially after users connect new MCP servers. Returns exact tool names and parameter summaries so you can call the matching tool directly.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What capability to find, e.g. `send slack message`, `create calendar event`, `zapier gmail`, or `browser screenshot`.",
          },
          limit: {
            type: "number",
            description: `Maximum results to return. Defaults to ${options.defaultLimit ?? DEFAULT_LIMIT}.`,
          } as any,
          includeSchemas: {
            type: "boolean",
            description:
              "When true, include each matching tool's full input schema. Default false.",
          } as any,
        },
        required: ["query"],
      },
    },
    http: false,
    readOnly: true,
    run: async (args: Record<string, string>) =>
      searchToolRegistry(getRegistry(), args, options),
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

export function searchToolRegistry(
  registry: Record<string, ActionEntry>,
  args: ToolSearchArgs = {},
  options: ToolSearchOptions = {},
): {
  query: string;
  totalTools: number;
  count: number;
  results: ToolSearchResult[];
} {
  const query = String(args.query ?? "").trim();
  const includeSchemas = parseBoolean(args.includeSchemas);
  const limit = parseLimit(
    args.limit,
    options.defaultLimit ?? DEFAULT_LIMIT,
    options.maxLimit ?? MAX_LIMIT,
  );
  const queryTokens = tokenize(query);

  const candidates: ToolSearchResult[] = [];
  let totalTools = 0;

  for (const [name, entry] of Object.entries(registry)) {
    if (!entry?.tool || name === TOOL_SEARCH_ACTION_NAME) continue;
    if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
      continue;
    }

    totalTools++;
    const description = normalizeWhitespace(entry.tool.description ?? "");
    const parameters = summarizeParameters(entry.tool.parameters);
    const parsedMcp = parseMcpToolName(name);
    const kind = parsedMcp ? "mcp" : "action";
    const source = parsedMcp?.serverId;
    const score = scoreTool({
      query,
      queryTokens,
      name,
      source,
      description,
      parameters,
      kind,
    });

    if (queryTokens.length > 0 && score <= 0) continue;

    candidates.push({
      name,
      kind,
      ...(source ? { source } : {}),
      description,
      score,
      parameters,
      ...(includeSchemas ? { inputSchema: entry.tool.parameters ?? {} } : {}),
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  return {
    query,
    totalTools,
    count: Math.min(candidates.length, limit),
    results: candidates.slice(0, limit),
  };
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
      ? prop.enum.map((value) => String(value)).slice(0, 20)
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
