import {
  frontmatterFieldsToObject,
  parseFrontmatter,
  serializeFrontmatter,
} from "@agent-native/core/resources/metadata";

export interface SimpleAgentProfileInput {
  name: string;
  description?: string;
  model?: string;
  tools?: string;
  instructions: string;
  source?: string;
  sourcePath?: string;
  sourceHash?: string;
  importedAt?: string;
}

export interface ImportedAgentProfile {
  name: string;
  description?: string;
  model?: string;
  tools?: string;
  instructions: string;
  slug: string;
  source: "markdown" | "claude" | "json";
  sourcePath?: string;
  warnings: string[];
}

export interface ImportedAgentToolValidation {
  tools?: string;
  warnings: string[];
}

const SUPPORTED_FIELDS = new Set([
  "name",
  "description",
  "model",
  "tools",
  "color",
  "delegate-default",
  "source",
  "source-path",
  "source-hash",
  "imported-at",
]);

export function slugifyAgentName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

function deriveName(fileName?: string): string {
  const baseName = fileName?.replaceAll("\\", "/").split("/").pop();
  const name = baseName?.replace(/\.(md|markdown|json|txt)$/i, "");
  return name?.trim() || "Imported agent";
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toolsValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const tools = value.filter(
      (item): item is string => typeof item === "string",
    );
    return tools.length > 0 ? tools.join(", ") : undefined;
  }
  return stringValue(value);
}

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function importedToolNames(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "inherit") return [];
  const unwrapped = trimmed.replace(/^\[|\]$/g, "");
  return unwrapped
    .split(/[\n,]/)
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/**
 * Imported tool names are descriptive input, not a permission grant. Keep only
 * names the current Dispatch surface can resolve and make every omission
 * visible to the caller instead of persisting a misleading tool list.
 */
export function validateImportedAgentTools(
  tools: string | undefined,
  availableToolNames: ReadonlySet<string>,
): ImportedAgentToolValidation {
  const names = importedToolNames(tools ?? "");
  if (names.length === 0) return { warnings: [] };

  const resolvable = new Map<string, string>();
  for (const name of availableToolNames) {
    resolvable.set(normalizeToolKey(name), name);
  }

  const mapped: string[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const resolved = resolvable.get(normalizeToolKey(name));
    if (resolved) {
      if (!mapped.includes(resolved)) mapped.push(resolved);
    } else {
      warnings.push(`Skipped unmapped tool: ${name}`);
    }
  }

  return {
    tools: mapped.length > 0 ? mapped.join(", ") : undefined,
    warnings,
  };
}

function markdownProfile(
  source: string,
  fileName?: string,
): Omit<ImportedAgentProfile, "source"> & {
  source: "markdown" | "claude";
} {
  const frontmatter = parseFrontmatter(source);
  const values = frontmatterFieldsToObject(frontmatter);
  const body = (frontmatter?.body ?? source).trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = stringValue(values.name) || heading || deriveName(fileName);
  const warnings = Object.keys(values)
    .filter((key) => !SUPPORTED_FIELDS.has(key))
    .map((key) => `Ignored unsupported field: ${key}`);
  if (!body) warnings.push("The imported agent has no instructions yet.");

  return {
    name,
    description: stringValue(values.description),
    model: stringValue(values.model),
    tools: toolsValue(values.tools),
    instructions: body,
    slug: slugifyAgentName(name),
    source: fileName?.includes(".claude/") ? "claude" : "markdown",
    sourcePath: fileName,
    warnings,
  };
}

function jsonProfile(source: string, fileName?: string): ImportedAgentProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("This file looks like JSON, but it is not valid JSON.");
  }

  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const candidate =
    record?.agent &&
    typeof record.agent === "object" &&
    !Array.isArray(record.agent)
      ? (record.agent as Record<string, unknown>)
      : record;
  if (!candidate) {
    throw new Error("Import a single agent definition, not a JSON list.");
  }

  const name =
    stringValue(candidate.name) ||
    stringValue(candidate.title) ||
    deriveName(fileName);
  const instructions =
    stringValue(candidate.instructions) ||
    stringValue(candidate.systemPrompt) ||
    stringValue(candidate.prompt) ||
    stringValue(candidate.content) ||
    "";
  const warnings: string[] = [];
  for (const key of ["hooks", "env", "environment", "command", "args", "cwd"]) {
    if (candidate[key] !== undefined) {
      warnings.push(`Skipped unsafe capability: ${key}`);
    }
  }
  if (!instructions)
    warnings.push("The imported agent has no instructions yet.");

  return {
    name,
    description: stringValue(candidate.description),
    model: stringValue(candidate.model),
    tools: toolsValue(candidate.tools),
    instructions,
    slug: slugifyAgentName(name),
    source: "json",
    sourcePath: fileName,
    warnings,
  };
}

export function normalizeImportedAgent(
  source: string,
  fileName?: string,
): ImportedAgentProfile {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("Paste an agent definition or choose a file.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return jsonProfile(trimmed, fileName);
  }
  return markdownProfile(trimmed, fileName);
}

export function buildSimpleAgentContent(
  input: SimpleAgentProfileInput,
): string {
  const fields = [
    { key: "name", value: input.name.trim() },
    ...(input.description?.trim()
      ? [{ key: "description", value: input.description.trim() }]
      : []),
    { key: "model", value: input.model?.trim() || "inherit" },
    { key: "tools", value: input.tools?.trim() || "inherit" },
    { key: "delegate-default", value: "false" },
    ...(input.source ? [{ key: "source", value: input.source }] : []),
    ...(input.sourcePath
      ? [{ key: "source-path", value: input.sourcePath }]
      : []),
    ...(input.sourceHash
      ? [{ key: "source-hash", value: input.sourceHash }]
      : []),
    ...(input.importedAt
      ? [{ key: "imported-at", value: input.importedAt }]
      : []),
  ];
  return `${serializeFrontmatter(fields)}${input.instructions.trim()}\n`;
}
