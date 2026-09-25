import { createHash } from "node:crypto";

import { z } from "zod";

export const RESOURCE_PACK_VERSION = 1;
export const RESOURCE_PACK_MAX_FILES = 200;
export const RESOURCE_PACK_MAX_BYTES = 1_000_000;

export type ResourcePackScope = "personal" | "organization" | "workspace";
export type ResourcePackRedactionReason = "secret" | "binary" | "unreadable";

export interface ResourcePackResource {
  path: string;
  scope: ResourcePackScope;
  content: string;
  sha256: string;
}

export interface ResourcePackRedaction {
  path: string;
  reason: ResourcePackRedactionReason;
}

export interface ResourcePack {
  version: typeof RESOURCE_PACK_VERSION;
  exportedAt: number;
  source: { appId?: string; scope: ResourcePackScope };
  resources: ResourcePackResource[];
  redactions: ResourcePackRedaction[];
  checksum: string;
}

export interface ResourcePackEntry {
  path: string;
  scope: ResourcePackScope;
  content: string;
}

const packResourceSchema = z.object({
  path: z.string().min(1),
  scope: z.enum(["personal", "organization", "workspace"]),
  content: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const packSchema = z.object({
  version: z.literal(RESOURCE_PACK_VERSION),
  exportedAt: z.number(),
  source: z.object({
    appId: z.string().optional(),
    scope: z.enum(["personal", "organization", "workspace"]),
  }),
  resources: z.array(packResourceSchema),
  redactions: z.array(
    z.object({
      path: z.string().min(1),
      reason: z.enum(["secret", "binary", "unreadable"]),
    }),
  ),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Same standalone-key matcher `observability/traces.ts` uses. Copied rather
 * than imported so a pack never pulls the tracing surface in as a side effect.
 */
const STANDALONE_API_KEY_PATTERN =
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g;

const CREDENTIAL_NAME =
  "authorization|cookie|api[_ -]?key|password|secret|token|access[_ -]?token|refresh[_ -]?token";

const UNQUOTED_CREDENTIAL_TERMINATORS = new Set([
  ",",
  ";",
  ")",
  "}",
  "]",
  "\n",
  "\r",
]);

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeysDeep(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function checksumResourcePackResources(
  resources: ResourcePackResource[],
): string {
  const sorted = [...resources].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return sha256Hex(canonicalJson(sorted));
}

function isMcpResourcePath(path: string): boolean {
  const normalized = path.replace(/^\/+/, "").toLowerCase();
  return (
    normalized.startsWith("mcp-servers/") ||
    normalized === "mcp.config.json" ||
    normalized === ".mcp.json" ||
    normalized === "mcp.json" ||
    normalized.endsWith("/mcp.config.json") ||
    normalized.endsWith("/.mcp.json")
  );
}

function dropMcpSecretFields(value: unknown): {
  value: unknown;
  redacted: boolean;
} {
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const result = dropMcpSecretFields(item);
      redacted = redacted || result.redacted;
      return result.value;
    });
    return { value: next, redacted };
  }
  if (!value || typeof value !== "object") {
    return { value, redacted: false };
  }
  const next: Record<string, unknown> = {};
  let redacted = false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "env" || key === "headers") {
      redacted = true;
      continue;
    }
    const result = dropMcpSecretFields(child);
    next[key] = result.value;
    redacted = redacted || result.redacted;
  }
  return { value: next, redacted };
}

function endOfQuotedCredentialValue(
  input: string,
  start: number,
  quote: '"' | "'",
): number | null {
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += index + 1 < input.length ? 2 : 1;
      continue;
    }
    if (quote === "'" && char === "'" && input[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return null;
}

function endOfUnquotedCredentialValue(input: string, start: number): number {
  let index = start;
  while (
    index < input.length &&
    !UNQUOTED_CREDENTIAL_TERMINATORS.has(input[index] ?? "")
  ) {
    index += 1;
  }
  return index;
}

function endOfCredentialValue(input: string, start: number): number {
  if (start >= input.length) return start;
  const quote = input[start];
  if (quote === '"' || quote === "'") {
    const closed = endOfQuotedCredentialValue(input, start, quote);
    if (closed === start + 2) return start;
    if (closed !== null) return closed;
  }
  return endOfUnquotedCredentialValue(input, start);
}

function redactLabeledCredentials(value: string): {
  content: string;
  redacted: boolean;
} {
  // `_` is a word character, so `\b` misses env names such as
  // `SENDGRID_API_KEY` and `CLIENT_SECRET`. Treat `_` as a separator and
  // redact the whole identifier when it contains a credential word.
  const pattern = new RegExp(
    `["']?(?<![A-Za-z0-9])(?:[A-Za-z0-9]+_){0,12}(?:${CREDENTIAL_NAME})(?:_[A-Za-z0-9]+){0,12}["']?\\s*[:=]\\s*`,
    "gi",
  );
  let content = "";
  let cursor = 0;
  let redacted = false;

  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const valueStart = match.index + match[0].length;
    const valueEnd = endOfCredentialValue(value, valueStart);
    if (valueEnd <= valueStart) continue;

    // Preserve the original quoting. Replacing the quotes along with the value
    // would turn a redacted JSON or YAML resource into an unparseable one.
    const quote = value[valueStart];
    const wasQuoted =
      (quote === '"' || quote === "'") && value[valueEnd - 1] === quote;

    content += value.slice(cursor, valueStart);
    content += wasQuoted ? `${quote}[REDACTED]${quote}` : "[REDACTED]";
    cursor = valueEnd;
    redacted = true;
    pattern.lastIndex = valueEnd;
  }

  content += value.slice(cursor);
  return { content, redacted };
}

function parseJsonContent(
  content: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false };
  }
}

function redactCredentialStrings(value: string): {
  content: string;
  redacted: boolean;
} {
  const labeled = redactLabeledCredentials(value);
  const content = labeled.content
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(STANDALONE_API_KEY_PATTERN, "[REDACTED]");
  return {
    content,
    redacted: labeled.redacted || content !== labeled.content,
  };
}

export function redactResourceContent(
  path: string,
  content: string,
): { content: string; redacted: boolean } {
  let next = content;
  let redacted = false;
  if (isMcpResourcePath(path)) {
    const parsed = parseJsonContent(content);
    // Non-JSON MCP rows still go through the string redaction below.
    if (parsed.ok) {
      const stripped = dropMcpSecretFields(parsed.value);
      if (stripped.redacted) {
        next = `${JSON.stringify(stripped.value, null, 2)}\n`;
        redacted = true;
      }
    }
  }
  const strings = redactCredentialStrings(next);
  return {
    content: strings.content,
    redacted: redacted || strings.redacted,
  };
}

export function buildResourcePack(
  entries: ResourcePackEntry[],
  options?: {
    exportedAt?: number;
    source?: { appId?: string; scope: ResourcePackScope };
    redactions?: ResourcePackRedaction[];
  },
): ResourcePack {
  const resources = [...entries]
    .map((entry) => ({
      path: entry.path,
      scope: entry.scope,
      content: entry.content,
      sha256: sha256Hex(entry.content),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    version: RESOURCE_PACK_VERSION,
    exportedAt: options?.exportedAt ?? Date.now(),
    source: options?.source ?? { scope: "personal" },
    resources,
    redactions: options?.redactions ?? [],
    checksum: checksumResourcePackResources(resources),
  };
}

export function verifyResourcePack(pack: unknown):
  | { ok: true; pack: ResourcePack }
  | {
      ok: false;
      error: "invalid" | "checksum_mismatch" | "unsupported_version";
    } {
  if (!pack || typeof pack !== "object") {
    return { ok: false, error: "invalid" };
  }
  const version = (pack as { version?: unknown }).version;
  if (version !== undefined && version !== RESOURCE_PACK_VERSION) {
    return { ok: false, error: "unsupported_version" };
  }
  const parsed = packSchema.safeParse(pack);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }
  for (const resource of parsed.data.resources) {
    if (sha256Hex(resource.content) !== resource.sha256) {
      return { ok: false, error: "checksum_mismatch" };
    }
  }
  if (
    checksumResourcePackResources(parsed.data.resources) !==
    parsed.data.checksum
  ) {
    return { ok: false, error: "checksum_mismatch" };
  }
  return { ok: true, pack: parsed.data };
}
