import { createHash } from "node:crypto";

import { parse as parseYaml } from "yaml";

import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";
import { ASSETS_SKILL_MD } from "../cli/skills-content/assets-skill.js";
import { CONTENT_SKILL_MD } from "../cli/skills-content/content-skill.js";

/** MCP Skills extension (SEP-2640): skills are files served as `skill://` resources. */
export const MCP_SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";

export type McpBuiltinSkillId = "an" | "assets" | "content";

export type McpSkillReferenceFileInput =
  | string
  | {
      content: string;
      mimeType?: string;
    };

export interface McpSkillAuthContext {
  userEmail: string;
  orgId: string | null;
  identityAssurance?: "user" | "org-member" | "organization" | "service";
  oauthScopes?: readonly string[];
}

export interface McpSkillDefinition {
  /** Skill slug matching YAML frontmatter `name`. */
  name: string;
  /** Full `SKILL.md` markdown with verified YAML frontmatter (`name`, `description`, `metadata.visibility: exported`). */
  skillMd: string;
  /**
   * Optional supporting reference files served under `skill://<name>/references/...`.
   * Keys must be relative paths starting with `references/` with safe segments only.
   */
  references?: Readonly<Record<string, McpSkillReferenceFileInput>>;
  /**
   * Optional organization allowlist. When set, only callers verified for one
   * of these organization ids may discover or read this skill.
   */
  orgIds?: readonly string[];
  /**
   * Optional per-request authorization check enforced identically across
   * `skills/list`, `skills/get`, and `resources/read`.
   */
  authorize?: (context: McpSkillAuthContext) => boolean | Promise<boolean>;
}

export type McpSkillConfig = McpBuiltinSkillId | McpSkillDefinition;

export interface ServedMcpSkillFile {
  uri: string;
  text: string;
  mimeType: string;
}

export interface McpSkillResourceDigest {
  uri: string;
  digest: string;
  size: number;
}

export interface McpSkillEntry {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: McpSkillResourceDigest[];
}

export interface BuiltMcpSkill {
  name: string;
  entry: McpSkillEntry;
  files: readonly ServedMcpSkillFile[];
  requiresLab?: string;
  orgIds?: readonly string[];
  authorize?: (context: McpSkillAuthContext) => boolean | Promise<boolean>;
}

export interface BuildSkillOptions {
  references?: Readonly<Record<string, McpSkillReferenceFileInput>>;
  requireExportedVisibility?: boolean;
  orgIds?: readonly string[];
  authorize?: (context: McpSkillAuthContext) => boolean | Promise<boolean>;
}

export interface McpSkillCatalog {
  list: () => {
    resultType: "complete";
    ttlMs: 0;
    cacheScope: "private";
    skills: McpSkillEntry[];
  };
  get: (uri: unknown) => {
    resultType: "complete";
    ttlMs: 0;
    cacheScope: "private";
    skill: McpSkillEntry;
  } | null;
  readFile: (uri: unknown) => {
    contents: [{ uri: string; mimeType: string; text: string }];
  } | null;
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUIRES_LAB_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const SAFE_MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/i;
const MAX_REFERENCE_PATH_LENGTH = 256;
const MAX_REFERENCE_PATH_SEGMENTS = 6;

const FRESHNESS = {
  resultType: "complete",
  ttlMs: 0,
  cacheScope: "private",
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return `${value}`;
  }
  return typeof value === "object" ? JSON.stringify(value) : typeof value;
}

function validateSkillName(name: string): string {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid MCP skill name "${name}": must match ${SKILL_NAME_PATTERN.source}`,
    );
  }
  return name;
}

function inferReferenceMimeType(refPath: string): string {
  const lower = refPath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "application/yaml";
  }
  return "text/plain";
}

function validateMimeType(mimeType: string, label: string): string {
  const trimmed = mimeType.trim();
  if (!SAFE_MIME_TYPE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid MIME type "${mimeType}" for ${label}`);
  }
  return trimmed;
}

export function validateSkillReferencePath(
  skillName: string,
  rawPath: string,
): string {
  if (
    !rawPath ||
    rawPath.length > MAX_REFERENCE_PATH_LENGTH ||
    rawPath.startsWith("/") ||
    rawPath.includes("\\") ||
    rawPath.includes("%") ||
    rawPath.includes("?") ||
    rawPath.includes("#") ||
    hasControlChar(rawPath)
  ) {
    throw new Error(
      `Invalid reference path "${rawPath}" for skill ${skillName}: only safe relative paths under references/ are allowed`,
    );
  }
  const segments = rawPath.split("/");
  if (
    segments.length < 2 ||
    segments.length > MAX_REFERENCE_PATH_SEGMENTS ||
    segments[0] !== "references" ||
    segments.slice(1).some((segment) => !REF_SEGMENT_PATTERN.test(segment))
  ) {
    throw new Error(
      `Invalid reference path "${rawPath}" for skill ${skillName}: only safe relative paths under references/ are allowed`,
    );
  }
  return rawPath;
}

export function isValidSkillUri(uri: unknown): uri is string {
  if (
    typeof uri !== "string" ||
    !uri.startsWith("skill://") ||
    uri.includes("\\") ||
    uri.includes("%") ||
    uri.includes("?") ||
    uri.includes("#") ||
    hasControlChar(uri)
  ) {
    return false;
  }
  const remainder = uri.slice("skill://".length);
  const slashIndex = remainder.indexOf("/");
  if (slashIndex <= 0) return false;
  const skillName = remainder.slice(0, slashIndex);
  const relativePath = remainder.slice(slashIndex + 1);
  if (!SKILL_NAME_PATTERN.test(skillName)) return false;
  if (relativePath === "SKILL.md") return true;
  try {
    validateSkillReferencePath(skillName, relativePath);
    return true;
  } catch {
    // coercion-ok: invalid skill URIs must return false rather than throw during URI lookup.
    return false;
  }
}

function validateOrgIds(
  skillName: string,
  orgIds: readonly string[] | undefined,
): readonly string[] | undefined {
  if (orgIds === undefined) return undefined;
  const normalized = new Set<string>();
  for (const raw of orgIds) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(
        `Skill ${skillName} orgIds must contain non-empty organization ids`,
      );
    }
    normalized.add(raw.trim());
  }
  return [...normalized];
}

export function buildSkill(
  name: string,
  skillMd: string,
  options?: BuildSkillOptions,
): BuiltMcpSkill {
  validateSkillName(name);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillMd);
  const yamlText = match?.at(1);
  let frontmatter: unknown = null;
  if (yamlText !== undefined) {
    try {
      frontmatter = parseYaml(yamlText);
    } catch {
      // coercion-ok: malformed YAML frontmatter fails the validation check below.
      frontmatter = null;
    }
  }
  if (
    !isPlainRecord(frontmatter) ||
    frontmatter.name !== name ||
    typeof frontmatter.description !== "string" ||
    !frontmatter.description.trim()
  ) {
    throw new Error(
      `Skill ${name} needs frontmatter with its name and description`,
    );
  }
  if (frontmatter["user-invocable"] === false) {
    throw new Error(`Skill ${name} is not user-invocable and cannot be served`);
  }
  const rawScope = frontmatter.scope;
  if (rawScope !== undefined) {
    const normalizedScope =
      typeof rawScope === "string" ? rawScope.trim().toLowerCase() : "";
    if (normalizedScope !== "runtime" && normalizedScope !== "both") {
      throw new Error(
        `Skill ${name} has non-exported scope "${formatUnknownValue(rawScope)}" and cannot be served over MCP`,
      );
    }
  }
  const metadata = frontmatter.metadata;
  if (metadata !== undefined && !isPlainRecord(metadata)) {
    throw new Error(`Skill ${name} has invalid frontmatter metadata`);
  }
  if (metadata?.internal === true) {
    throw new Error(
      `Skill ${name} is marked internal and cannot be served over MCP`,
    );
  }
  if (
    metadata?.visibility !== undefined &&
    metadata.visibility !== "exported"
  ) {
    throw new Error(
      `Skill ${name} has visibility "${formatUnknownValue(metadata.visibility)}" and cannot be served over MCP`,
    );
  }
  if (
    options?.requireExportedVisibility === true &&
    metadata?.visibility !== "exported"
  ) {
    throw new Error(
      `Skill ${name} must declare metadata.visibility: exported to be served over MCP`,
    );
  }
  let requiresLab: string | undefined;
  const labLines = (yamlText ?? "")
    .split("\n")
    .filter((line) => /requires-lab/i.test(line));
  if (
    labLines.length > 1 ||
    labLines.some(
      (line) => !/^requires-lab:\s*[a-zA-Z0-9_.-]+\s*\r?$/.test(line),
    )
  ) {
    throw new Error(`Skill ${name} has invalid requires-lab frontmatter`);
  }
  const rawRequiresLab = frontmatter["requires-lab"];
  if (rawRequiresLab !== undefined) {
    if (
      typeof rawRequiresLab !== "string" ||
      !REQUIRES_LAB_PATTERN.test(rawRequiresLab.trim())
    ) {
      throw new Error(`Skill ${name} has invalid requires-lab frontmatter`);
    }
    requiresLab = rawRequiresLab.trim();
  }

  const skillFile: ServedMcpSkillFile = {
    uri: `skill://${name}/SKILL.md`,
    text: skillMd,
    mimeType: "text/markdown",
  };
  const files: ServedMcpSkillFile[] = [skillFile];
  if (options?.references) {
    const seenUris = new Set<string>([skillFile.uri]);
    const sortedEntries = Object.entries(options.references).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [rawPath, input] of sortedEntries) {
      const refPath = validateSkillReferencePath(name, rawPath);
      const uri = `skill://${name}/${refPath}`;
      if (seenUris.has(uri)) {
        throw new Error(`Duplicate skill reference URI: ${uri}`);
      }
      seenUris.add(uri);
      const text = typeof input === "string" ? input : input.content;
      const mimeType = validateMimeType(
        typeof input === "string"
          ? inferReferenceMimeType(refPath)
          : (input.mimeType ?? inferReferenceMimeType(refPath)),
        uri,
      );
      files.push({ uri, text, mimeType });
    }
  }

  const entry: McpSkillEntry = {
    uri: skillFile.uri,
    frontmatter,
    resources: files.map((file) => {
      const bytes = Buffer.from(file.text, "utf8");
      return {
        uri: file.uri,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length,
      };
    }),
  };

  const orgIds = validateOrgIds(name, options?.orgIds);
  return {
    name,
    entry,
    files,
    ...(requiresLab ? { requiresLab } : {}),
    ...(orgIds !== undefined ? { orgIds } : {}),
    ...(options?.authorize ? { authorize: options.authorize } : {}),
  };
}

const BUILTIN_MCP_SKILL_SOURCES: Readonly<Record<McpBuiltinSkillId, string>> = {
  an: AN_SKILL_MD,
  assets: ASSETS_SKILL_MD,
  content: CONTENT_SKILL_MD,
};

const builtinSkillCache = new Map<McpBuiltinSkillId, BuiltMcpSkill>();

export function getBuiltinMcpSkill(id: McpBuiltinSkillId): BuiltMcpSkill {
  const existing = builtinSkillCache.get(id);
  if (existing) return existing;
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_MCP_SKILL_SOURCES, id)) {
    throw new Error(`Unknown built-in MCP skill "${String(id)}"`);
  }
  const built = buildSkill(id, BUILTIN_MCP_SKILL_SOURCES[id], {
    requireExportedVisibility: true,
  });
  builtinSkillCache.set(id, built);
  return built;
}

export function resolveConfiguredMcpSkills(options: {
  servesAnSkill?: boolean;
  skills?: readonly McpSkillConfig[];
}): readonly BuiltMcpSkill[] {
  const byName = new Map<string, BuiltMcpSkill>();
  const register = (built: BuiltMcpSkill, allowIdenticalAn = false) => {
    const existing = byName.get(built.name);
    if (existing) {
      if (
        allowIdenticalAn &&
        built.name === "an" &&
        existing === getBuiltinMcpSkill("an") &&
        built === existing
      ) {
        return;
      }
      throw new Error(`Duplicate MCP skill configured: "${built.name}"`);
    }
    byName.set(built.name, built);
  };

  if (options.servesAnSkill === true) {
    register(getBuiltinMcpSkill("an"));
  }
  for (const item of options.skills ?? []) {
    if (typeof item === "string") {
      register(getBuiltinMcpSkill(item), item === "an");
    } else {
      register(
        buildSkill(item.name, item.skillMd, {
          requireExportedVisibility: true,
          ...(item.references !== undefined
            ? { references: item.references }
            : {}),
          ...(item.orgIds !== undefined ? { orgIds: item.orgIds } : {}),
          ...(item.authorize !== undefined
            ? { authorize: item.authorize }
            : {}),
        }),
      );
    }
  }
  return [...byName.values()];
}

export async function filterAuthorizedMcpSkills(
  skills: readonly BuiltMcpSkill[],
  authContext: McpSkillAuthContext,
  options: {
    checkLab?: (lab: string) => Promise<boolean>;
  } = {},
): Promise<readonly BuiltMcpSkill[]> {
  const authorized: BuiltMcpSkill[] = [];
  for (const skill of skills) {
    if (
      skill.orgIds !== undefined &&
      (authContext.orgId === null || !skill.orgIds.includes(authContext.orgId))
    ) {
      continue;
    }
    if (skill.requiresLab !== undefined) {
      if (!options.checkLab || !(await options.checkLab(skill.requiresLab))) {
        continue;
      }
    }
    if (skill.authorize) {
      const allowed = await skill.authorize(authContext);
      if (allowed !== true) continue;
    }
    authorized.push(skill);
  }
  return authorized;
}

export function createMcpSkillCatalog(
  skills: readonly BuiltMcpSkill[],
): McpSkillCatalog {
  const entriesByUri = new Map<string, McpSkillEntry>();
  const filesByUri = new Map<string, ServedMcpSkillFile>();
  for (const skill of skills) {
    entriesByUri.set(skill.entry.uri, skill.entry);
    for (const file of skill.files) {
      filesByUri.set(file.uri, file);
    }
  }
  return {
    list: () => ({
      ...FRESHNESS,
      skills: skills.map((skill) => skill.entry),
    }),
    get: (uri: unknown) => {
      if (!isValidSkillUri(uri)) return null;
      const entry = entriesByUri.get(uri);
      return entry ? { ...FRESHNESS, skill: entry } : null;
    },
    readFile: (uri: unknown) => {
      if (!isValidSkillUri(uri)) return null;
      const file = filesByUri.get(uri);
      return file
        ? {
            contents: [
              { uri: file.uri, mimeType: file.mimeType, text: file.text },
            ],
          }
        : null;
    },
  };
}

let defaultAnCatalog: McpSkillCatalog | undefined;
function anCatalog(): McpSkillCatalog {
  return (defaultAnCatalog ??= createMcpSkillCatalog([
    getBuiltinMcpSkill("an"),
  ]));
}

export function listMcpSkills() {
  return anCatalog().list();
}

/** The entry for a skill's `SKILL.md` uri, or null when this server does not serve it. */
export function getMcpSkill(uri: unknown) {
  return anCatalog().get(uri);
}

/** The contents of a served skill file, or null for any other uri. */
export function readMcpSkillFile(uri: unknown) {
  return anCatalog().readFile(uri);
}
