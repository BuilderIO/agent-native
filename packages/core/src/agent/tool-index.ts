import { parseMcpToolName } from "../mcp-client/manager.js";

const DEFAULT_MAX_CHARS = 16_000;

const TOOL_INDEX_HEADER =
  "## Tool index\nThese tools exist but are not loaded yet. Load the ones you need by exact name with `tool-search` (`names`, several in one call), then call them on the next step. Search by capability only when nothing listed fits.";

const LEADING_VERBS = new Set([
  "get",
  "list",
  "create",
  "update",
  "delete",
  "remove",
  "add",
  "set",
  "manage",
  "search",
  "query",
  "find",
  "read",
  "write",
  "run",
  "send",
  "fetch",
  "import",
  "export",
  "upsert",
  "generate",
  "request",
  "open",
  "refresh",
  "sync",
  "start",
  "stop",
  "cancel",
  "check",
  "describe",
  "view",
  "edit",
  "save",
  "load",
  "apply",
  "mutate",
  "insert",
  "move",
  "copy",
  "rename",
  "publish",
  "archive",
  "restore",
  "configure",
  "ensure",
  "enable",
  "disable",
  "connect",
  "disconnect",
  "test",
  "validate",
  "verify",
  "preview",
]);

const OTHER_GROUP = "other";

// MCP tool names come from remote servers; anything that is not a plain
// identifier could carry prompt text into the cached system prompt.
const PROMPT_SAFE_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;

function isPromptSafeToolName(name: string): boolean {
  return PROMPT_SAFE_TOOL_NAME.test(name);
}

// "analysis", "alias", "status" and "analytics" are already the right group
// name; stripping their "s" would print a misspelled topic.
const KEEP_TRAILING_S = /(ss|is|us|as|ics)$/;

function singularize(word: string): string {
  if (word.length <= 3 || KEEP_TRAILING_S.test(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

function topicFor(name: string): string {
  const mcp = parseMcpToolName(name);
  if (mcp) return `mcp__${mcp.serverId}__*`;
  const tokens = name.toLowerCase().split(/[-_]+/).filter(Boolean);
  const subject = tokens.find((token) => !LEADING_VERBS.has(token));
  return singularize(subject ?? tokens[0] ?? name.toLowerCase());
}

function groupByTopic(names: readonly string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const topic = topicFor(name);
    groups.set(topic, [...(groups.get(topic) ?? []), name]);
  }
  const other: string[] = [];
  const topics: Array<[string, string[]]> = [];
  for (const [topic, members] of groups) {
    if (members.length === 1) other.push(...members);
    else topics.push([topic, members]);
  }
  topics.sort(([a], [b]) => a.localeCompare(b));
  if (other.length > 0) topics.push([OTHER_GROUP, other.sort()]);
  return topics;
}

function renderGroups(
  groups: Array<[string, string[]]>,
  perGroup: number,
): string {
  return groups
    .map(([topic, members]) => {
      const shown = members.slice(0, perGroup).join(", ");
      const hidden = members.length - perGroup;
      return `- ${topic}: ${shown}${hidden > 0 ? ` (+${hidden} more)` : ""}`;
    })
    .join("\n");
}

/**
 * Names every deferred tool, grouped by topic, so the model knows what exists
 * before it searches. Output must be deterministic for the same names: it sits
 * in the cached system-prompt prefix.
 */
export function formatToolIndex(
  names: readonly string[],
  options: { maxChars?: number } = {},
): string {
  const unique = [...new Set(names)].filter(isPromptSafeToolName).sort();
  if (unique.length === 0) return "";
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const groups = groupByTopic(unique);
  const largest = Math.max(...groups.map(([, members]) => members.length));
  for (let perGroup = largest; perGroup >= 1; perGroup -= 1) {
    const body = renderGroups(groups, perGroup);
    if (body.length <= maxChars) return `${TOOL_INDEX_HEADER}\n\n${body}`;
  }
  const counts = groups
    .map(([topic, members]) => `- ${topic} (${members.length})`)
    .join("\n");
  return `${TOOL_INDEX_HEADER} Topics below show counts only; search a topic to see its tools.\n\n${counts.slice(0, maxChars)}`;
}
