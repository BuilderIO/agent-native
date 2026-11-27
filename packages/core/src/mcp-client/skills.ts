import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** MCP Skills extension identifier (SEP-2640). */
export const MCP_SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";

/** Error codes raised by client-side MCP Skills discovery and verified reads. */
export type McpSkillErrorCode =
  | "INVALID_SKILL_URI"
  | "SKILLS_UNSUPPORTED"
  | "RESOURCE_NOT_IN_MANIFEST"
  | "INVALID_DIGEST"
  | "DIGEST_MISMATCH"
  | "MALFORMED_SKILL_RESPONSE";

/** Typed error for client-side MCP Skills validation, discovery, and digest failures. */
export class McpSkillError extends Error {
  readonly code: McpSkillErrorCode;
  readonly uri?: string | undefined;
  readonly serverId?: string | undefined;

  constructor(
    code: McpSkillErrorCode,
    message: string,
    details?: {
      uri?: string | undefined;
      serverId?: string | undefined;
      cause?: unknown;
    },
  ) {
    super(
      message,
      details?.cause !== undefined ? { cause: details.cause } : undefined,
    );
    this.name = "McpSkillError";
    this.code = code;
    this.uri = details?.uri;
    this.serverId = details?.serverId;
  }
}

/** Parsed components of a validated `skill://` URI. */
export interface ParsedSkillUri {
  uri: string;
  skillName: string;
  relativePath: string;
  manifestUri: string;
}

/** Manifest entry for a single file served under a skill. */
export interface McpSkillResourceEntry {
  uri: string;
  digest: string;
  size?: number;
}

/** Skill manifest returned by `skills/list` or `skills/get`. */
export interface McpSkillEntry {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: McpSkillResourceEntry[];
}

/** Result of an MCP `skills/list` request. */
export interface McpSkillListResult {
  skills: McpSkillEntry[];
  nextCursor?: string;
  resultType?: string;
  ttlMs?: number;
  cacheScope?: string;
}

/** Result of an MCP `skills/get` request. */
export interface McpSkillGetResult {
  skill: McpSkillEntry;
  resultType?: string;
  ttlMs?: number;
  cacheScope?: string;
}

/** Verified skill resource payload returned by `readSkillResource`. */
export interface McpSkillResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  digest: string;
  size: number;
}

/** Options for `McpClientManager.listSkills`. */
export interface McpSkillListOptions {
  cursor?: string;
}

/** Options for `McpClientManager.readSkillResource`. */
export interface McpSkillReadOptions {
  /** Override the manifest URI used when fetching the skill's digest table. */
  skillUri?: string;
  /** Pre-validated `sha256:<hex>` digest to verify against instead of fetching the manifest. */
  expectedDigest?: string;
  /** Optional expected byte length checked alongside `expectedDigest`. */
  expectedSize?: number;
}

/** Zod schema for a single skill manifest resource entry. */
export const mcpSkillResourceEntrySchema = z.object({
  uri: z.string(),
  digest: z.string(),
  size: z.number().int().nonnegative().optional(),
});

/** Zod schema for a skill manifest entry. */
export const mcpSkillEntrySchema = z.object({
  uri: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  resources: z.array(mcpSkillResourceEntrySchema),
});

/** Zod schema for a `skills/list` response. */
export const mcpSkillListResultSchema = z.looseObject({
  skills: z.array(mcpSkillEntrySchema),
  nextCursor: z.string().optional(),
  resultType: z.string().optional(),
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

/** Zod schema for a `skills/get` response. */
export const mcpSkillGetResultSchema = z.looseObject({
  skill: mcpSkillEntrySchema,
  resultType: z.string().optional(),
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

const readResourceContentItemSchema = z.looseObject({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
});

const readResourceResultSchema = z.looseObject({
  contents: z.array(readResourceContentItemSchema),
});

const SKILL_URI_PREFIX = "skill://";
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNSAFE_URI_CHARS_RE = /[\s?#\\]/;
const SLASH_RE = /[/\\]/;
const SHA256_DIGEST_RE = /^sha256:([0-9a-f]{64})$/i;
const STRICT_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function invalidSkillUri(uri: string, reason: string): McpSkillError {
  return new McpSkillError(
    "INVALID_SKILL_URI",
    `Invalid MCP skill URI "${uri}": ${reason}`,
    { uri },
  );
}

/** Validates and parses a canonical `skill://<skillName>/<path>` URI. */
export function parseSkillUri(uri: string): ParsedSkillUri {
  if (!uri.startsWith(SKILL_URI_PREFIX)) {
    throw invalidSkillUri(uri, 'must start with "skill://"');
  }
  if (hasControlCharacter(uri) || UNSAFE_URI_CHARS_RE.test(uri)) {
    throw invalidSkillUri(
      uri,
      "contains disallowed whitespace, control, query, fragment, or backslash characters",
    );
  }
  const rest = uri.slice(SKILL_URI_PREFIX.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0 || slashIndex === rest.length - 1) {
    throw invalidSkillUri(uri, "must include both a skill name and file path");
  }
  const skillName = rest.slice(0, slashIndex);
  if (!SKILL_NAME_RE.test(skillName)) {
    throw invalidSkillUri(uri, `invalid skill name "${skillName}"`);
  }
  const relativePath = rest.slice(slashIndex + 1);
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw invalidSkillUri(uri, "contains empty or relative path segments");
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch (error) {
      throw new McpSkillError(
        "INVALID_SKILL_URI",
        `Invalid MCP skill URI "${uri}": malformed percent-encoding`,
        { uri, cause: error },
      );
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      hasControlCharacter(decoded) ||
      SLASH_RE.test(decoded)
    ) {
      throw invalidSkillUri(uri, "contains disallowed encoded path characters");
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (error) {
    throw new McpSkillError(
      "INVALID_SKILL_URI",
      `Invalid MCP skill URI "${uri}": failed URL parsing`,
      { uri, cause: error },
    );
  }
  if (
    parsed.protocol !== "skill:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname !== skillName ||
    parsed.pathname !== `/${relativePath}`
  ) {
    throw invalidSkillUri(uri, "URI is not in canonical form");
  }
  return {
    uri,
    skillName,
    relativePath,
    manifestUri: `${SKILL_URI_PREFIX}${skillName}/SKILL.md`,
  };
}

/** Validates and lowercases a `sha256:<64-hex>` digest string. */
export function normalizeSha256Digest(
  digest: string,
  context?: { uri?: string | undefined; serverId?: string | undefined },
): string {
  const match = SHA256_DIGEST_RE.exec(digest);
  const hex = match?.[1];
  if (!hex) {
    throw new McpSkillError(
      "INVALID_DIGEST",
      `Invalid MCP skill resource digest "${digest}" (expected sha256:<64 hex chars>)`,
      context,
    );
  }
  return `sha256:${hex.toLowerCase()}`;
}

/** Computes a `sha256:<64-hex>` digest for raw skill resource bytes. */
export function computeSha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Verifies resource bytes against an expected `sha256:<hex>` digest and optional size. */
export function verifySkillResourceDigest(
  bytes: Uint8Array,
  expectedDigest: string,
  expectedSize?: number,
  context?: { uri?: string | undefined; serverId?: string | undefined },
): { digest: string; size: number } {
  const normalizedExpected = normalizeSha256Digest(expectedDigest, context);
  const expectedHex = normalizedExpected.slice("sha256:".length);
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const actualBuf = createHash("sha256").update(bytes).digest();
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    const actualDigest = `sha256:${actualBuf.toString("hex")}`;
    throw new McpSkillError(
      "DIGEST_MISMATCH",
      `SHA-256 digest mismatch for MCP skill resource "${context?.uri ?? "unknown"}": expected ${normalizedExpected}, got ${actualDigest}`,
      context,
    );
  }
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
    throw new McpSkillError(
      "DIGEST_MISMATCH",
      `Byte size mismatch for MCP skill resource "${context?.uri ?? "unknown"}": expected ${expectedSize} bytes, got ${bytes.byteLength} bytes`,
      context,
    );
  }
  return {
    digest: `sha256:${actualBuf.toString("hex")}`,
    size: bytes.byteLength,
  };
}

/** Returns true when a server capability object advertises `io.modelcontextprotocol/skills`. */
export function capabilitiesAdvertiseSkills(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const extensions = (capabilities as { extensions?: unknown }).extensions;
  if (!extensions || typeof extensions !== "object") return false;
  if (
    !Object.prototype.hasOwnProperty.call(extensions, MCP_SKILLS_EXTENSION_ID)
  ) {
    return false;
  }
  const value = (extensions as Record<string, unknown>)[
    MCP_SKILLS_EXTENSION_ID
  ];
  return value !== null && typeof value === "object";
}

function validateSkillEntry(
  rawEntry: z.infer<typeof mcpSkillEntrySchema>,
  serverId: string,
): McpSkillEntry {
  const parsedSkill = parseSkillUri(rawEntry.uri);
  const resources: McpSkillResourceEntry[] = rawEntry.resources.map(
    (resource) => {
      const parsedResource = parseSkillUri(resource.uri);
      if (parsedResource.skillName !== parsedSkill.skillName) {
        throw new McpSkillError(
          "INVALID_SKILL_URI",
          `Skill "${rawEntry.uri}" references resource "${resource.uri}" outside its skill namespace`,
          { uri: resource.uri, serverId },
        );
      }
      return {
        uri: resource.uri,
        digest: normalizeSha256Digest(resource.digest, {
          uri: resource.uri,
          serverId,
        }),
        ...(resource.size !== undefined ? { size: resource.size } : {}),
      };
    },
  );
  return {
    uri: rawEntry.uri,
    frontmatter: rawEntry.frontmatter,
    resources,
  };
}

/** Parses and validates a raw `skills/list` response payload. */
export function parseSkillListResult(
  raw: unknown,
  serverId: string,
): McpSkillListResult {
  const parsed = mcpSkillListResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" returned a malformed skills/list response`,
      { serverId, cause: parsed.error },
    );
  }
  const data = parsed.data;
  return {
    skills: data.skills.map((entry) => validateSkillEntry(entry, serverId)),
    ...(data.nextCursor !== undefined ? { nextCursor: data.nextCursor } : {}),
    ...(data.resultType !== undefined ? { resultType: data.resultType } : {}),
    ...(data.ttlMs !== undefined ? { ttlMs: data.ttlMs } : {}),
    ...(data.cacheScope !== undefined ? { cacheScope: data.cacheScope } : {}),
  };
}

/** Parses and validates a raw `skills/get` response payload for a requested URI. */
export function parseSkillGetResult(
  raw: unknown,
  expectedUri: string,
  serverId: string,
): McpSkillGetResult {
  const parsed = mcpSkillGetResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" returned a malformed skills/get response for "${expectedUri}"`,
      { uri: expectedUri, serverId, cause: parsed.error },
    );
  }
  const data = parsed.data;
  if (data.skill.uri !== expectedUri) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" returned skill "${data.skill.uri}" when "${expectedUri}" was requested`,
      { uri: expectedUri, serverId },
    );
  }
  return {
    skill: validateSkillEntry(data.skill, serverId),
    ...(data.resultType !== undefined ? { resultType: data.resultType } : {}),
    ...(data.ttlMs !== undefined ? { ttlMs: data.ttlMs } : {}),
    ...(data.cacheScope !== undefined ? { cacheScope: data.cacheScope } : {}),
  };
}

function decodeStrictBase64(
  blob: string,
  context: { uri: string; serverId: string },
): Buffer {
  const compact = blob.replace(/\s+/g, "");
  if (!STRICT_BASE64_RE.test(compact)) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${context.serverId}" returned invalid base64 content for "${context.uri}"`,
      context,
    );
  }
  return Buffer.from(compact, "base64");
}

/** Extracts a matching `skill://` resource item and verifies its SHA-256 digest and size. */
export function extractVerifiedSkillResource(
  raw: unknown,
  expectedUri: string,
  expectedDigest: string,
  expectedSize: number | undefined,
  serverId: string,
): McpSkillResourceContent {
  const parsed = readResourceResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" returned a malformed resources/read response for "${expectedUri}"`,
      { uri: expectedUri, serverId, cause: parsed.error },
    );
  }
  const item = parsed.data.contents.find((entry) => entry.uri === expectedUri);
  if (!item) {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" did not return content matching "${expectedUri}"`,
      { uri: expectedUri, serverId },
    );
  }
  let bytes: Buffer;
  if (item.text !== undefined) {
    bytes = Buffer.from(item.text, "utf8");
  } else if (item.blob !== undefined) {
    bytes = decodeStrictBase64(item.blob, { uri: expectedUri, serverId });
  } else {
    throw new McpSkillError(
      "MALFORMED_SKILL_RESPONSE",
      `MCP server "${serverId}" returned empty resource content for "${expectedUri}"`,
      { uri: expectedUri, serverId },
    );
  }
  const verified = verifySkillResourceDigest(
    bytes,
    expectedDigest,
    expectedSize,
    { uri: expectedUri, serverId },
  );
  return {
    uri: expectedUri,
    ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
    ...(item.text !== undefined ? { text: item.text } : {}),
    ...(item.blob !== undefined ? { blob: item.blob } : {}),
    digest: verified.digest,
    size: verified.size,
  };
}
