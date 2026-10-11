import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sourceIndexBundleSchema } from "../server/lib/source-index-schema";
import { buildSigmaSourceIndex } from "./sigma-source-index";

const SCHEMA_VERSION = 1 as const;
const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_SOURCES = 10;
const MAX_ENTRIES = 1_500;
const MAX_BUNDLE_BYTES = 750_000;
const MAX_ROOT_BYTES = 250_000_000;
const MAX_STRING_LENGTH = 2_000;
const MAX_DESCRIPTION_LENGTH = 2_000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".playwright-mcp",
  ".tmp",
  ".turbo",
  ".venv",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
const SENSITIVE_FILE_NAME = /^\.env(?:\..*)?$/i;
const DBT_EXCLUDED_SQL_DIRECTORIES = new Set([
  "analysis",
  "analyses",
  "macro",
  "macros",
  "seed",
  "seeds",
  "snapshot",
  "snapshots",
]);
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
const SAFE_TEST_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
const SAFE_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_.:/-]{0,119}$/;
const SAFE_PROPERTY_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/;
const SENSITIVE_TEXT =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\{\{|\}\}|\b(?:bearer|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+|\b\d{3}[-.\s)]?\d{3}[-.\s]?\d{4}\b|\b\d{13,19}\b)/i;

export interface SourceIndexSource {
  id: string;
  revision?: string;
  contentFingerprint: string;
}

export type SemanticScope =
  | "analytics_user"
  | "product_user"
  | "person"
  | "organization"
  | "membership"
  | "product_activity"
  | "session"
  | "crm_record"
  | "unknown";

export interface SourceIndexEntry {
  id: string;
  metric: string;
  definition: string;
  source: string;
  sourceKind?: "dbt" | "code" | "sigma";
  entryType?: "model" | "event" | "semantic_model" | "metric";
  status?: "active" | "deprecated";
  semanticScope?: SemanticScope;
  owner?: string;
  grain?: string;
  primaryEntity?: string;
  timeDimension?: string;
  semanticModel?: string;
  table?: string;
  columnsUsed?: string;
  dependencies?: string;
  joinPattern?: string;
  commonQuestions?: string;
  knownGotchas?: string;
  updateFrequency?: string;
  sourcePath?: string;
  sourceRevision?: string;
}

export interface SourceIndexBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  sources: SourceIndexSource[];
  entries: SourceIndexEntry[];
  scanSummary: SourceIndexScanSummary;
}

export interface SourceIndexScanSummary {
  unsafeEntriesOmitted: number;
  unsafeFieldsOmitted: number;
  truncatedFields: number;
  unresolvedTrackingCallSites: number;
}

export interface SourceIndexOptions {
  dbtRoots: string[];
  codeRoots?: string[];
  sigmaReviewedManifest?: string;
  sigmaEnvFile?: string;
  generatedAt?: string;
}

export interface SourceIndexCliOptions extends SourceIndexOptions {
  out: string;
}

export class SourceIndexError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceIndexError";
  }
}

interface RootContext {
  absolutePath: string;
  id: string;
  revision?: string;
  committedAt?: string;
}

interface ColumnDoc {
  name: string;
  description?: string;
  dataType?: string;
  entityName?: string;
  entityType?: string;
  dimensionType?: string;
  granularity?: string;
  tests: Set<string>;
}

interface EmbeddedMetricDoc {
  name: string;
  type?: string;
  description?: string;
  label?: string;
  agg?: string;
  expr?: string;
  aggTimeDimension?: string;
}

interface ModelDoc {
  name: string;
  sourcePath?: string;
  description?: string;
  semanticModelEnabled?: boolean;
  semanticModelName?: string;
  group?: string;
  aggTimeDimension?: string;
  embeddedMetrics?: EmbeddedMetricDoc[];
  columns: Map<string, ColumnDoc>;
  tests: Set<string>;
  dependencies: Set<string>;
  grainHints: string[][];
}

interface DbEntryContext {
  model: ModelDoc;
  itemIndent: number;
  columnsIndent: number | null;
  column: ColumnDoc | null;
  entityIndent: number | null;
  dimensionIndent: number | null;
  testsIndent: number | null;
  testsOwner: ModelDoc | ColumnDoc | null;
  metricsIndent: number | null;
  grainListIndent: number | null;
  grainColumns: string[] | null;
}

interface DbtYamlItem {
  section: "semantic_models" | "metrics" | "groups";
  itemIndent: number;
  sourcePath?: string;
  values: Record<string, string>;
  nested: Record<string, string>;
  children: Map<string, Array<Record<string, string>>>;
  ownerName?: string;
}

interface DbtYamlMultiline {
  target: Record<string, string>;
  key: string;
  indent: number;
  lines: string[];
}

interface CodeEvent {
  name: string;
  properties: Set<string>;
  sourcePaths: Set<string>;
}

interface FileRecord {
  absolutePath: string;
  relativePath: string;
}

interface RootScanResult {
  entries: SourceIndexEntry[];
  contentFingerprint: string;
  scanSummary: SourceIndexScanSummary;
}

interface ReadBudget {
  bytes: number;
}

function codedError(code: string, message: string): never {
  throw new SourceIndexError(code, message);
}

function accountSourceBytes(size: number, budget: ReadBudget): void {
  budget.bytes += size;
  if (budget.bytes > MAX_ROOT_BYTES) {
    codedError(
      "root_size_limit_exceeded",
      "A source root exceeds the 250 MB scan limit.",
    );
  }
}

function emptyScanSummary(): SourceIndexScanSummary {
  return {
    unsafeEntriesOmitted: 0,
    unsafeFieldsOmitted: 0,
    truncatedFields: 0,
    unresolvedTrackingCallSites: 0,
  };
}

function addScanSummary(
  target: SourceIndexScanSummary,
  source: SourceIndexScanSummary,
): void {
  target.unsafeEntriesOmitted += source.unsafeEntriesOmitted;
  target.unsafeFieldsOmitted += source.unsafeFieldsOmitted;
  target.truncatedFields += source.truncatedFields;
  target.unresolvedTrackingCallSites += source.unresolvedTrackingCallSites;
}

async function readSigmaCredentialsFromEnvFile(
  envFile: string | undefined,
): Promise<{ baseUrl: string; clientId: string; clientSecret: string }> {
  if (!envFile) {
    codedError(
      "missing_sigma_env_file",
      "Sigma indexing requires --sigma-env-file pointing to ai-services/.env.",
    );
  }
  const absolutePath = path.resolve(envFile);
  const pathParts = absolutePath.split(path.sep);
  if (
    path.basename(absolutePath) !== ".env" ||
    pathParts[pathParts.length - 2] !== "ai-services"
  ) {
    codedError(
      "invalid_sigma_env_file",
      "Sigma credentials may only be read from ai-services/.env.",
    );
  }
  let contents: string;
  try {
    contents = await readFile(absolutePath, "utf8");
  } catch {
    codedError(
      "sigma_env_file_unreadable",
      "The named ai-services/.env file could not be read.",
    );
  }

  const allowedKeys = new Set([
    "SIGMA_BASE_URL",
    "SIGMA_CLIENT_ID",
    "SIGMA_CLIENT_SECRET",
  ]);
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !allowedKeys.has(match[1]!)) continue;
    let value = match[2]!;
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (value) values.set(match[1]!, value);
  }
  const baseUrl = values.get("SIGMA_BASE_URL");
  const clientId = values.get("SIGMA_CLIENT_ID");
  const clientSecret = values.get("SIGMA_CLIENT_SECRET");
  if (!baseUrl || !clientId || !clientSecret) {
    codedError(
      "sigma_env_keys_missing",
      "The named ai-services/.env file must define the three Sigma credential keys.",
    );
  }
  return { baseUrl, clientId, clientSecret };
}

function capString(value: string, max = MAX_STRING_LENGTH): string {
  return value.length <= max ? value : value.slice(0, max);
}

function boundedList(values: string[], max: number, separator: string): string {
  const full = values.join(separator);
  if (full.length <= max) return full;
  let included: string[] = [];
  let used = 0;
  for (const value of values) {
    const nextUsed =
      used + (included.length ? separator.length : 0) + value.length;
    const remaining = values.length - included.length - 1;
    const marker = `… [${remaining} additional entries omitted; inspect source]`;
    if (nextUsed + separator.length + marker.length > max) break;
    included.push(value);
    used = nextUsed;
  }
  const omitted = values.length - included.length;
  const marker = `… [${omitted} additional entries omitted; inspect source]`;
  return [...included, marker].join(separator);
}

function boundedExcerpt(value: string, max: number): string {
  if (value.length <= max) return value;
  const marker = " … [definition excerpt truncated; inspect source]";
  return `${value.slice(0, max - marker.length).trimEnd()}${marker}`;
}

function safeIdentifier(value: string): string | null {
  const candidate = value.trim();
  return SAFE_IDENTIFIER.test(candidate) ? candidate : null;
}

function safeSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function entryId(source: string, kind: string, identity: string): string {
  const readable = identity
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 40);
  return `${source}-${kind}-${readable || "entry"}-${shortHash(`${kind}:${identity}`)}`;
}

function inferSemanticScope(identity: string): SemanticScope {
  const value = identity.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const hasUser =
    /(?:^|_)(?:user|users|person|people|member|members)(?:_|$)/.test(value);
  if (hasUser && /(?:^|_)agent_native(?:_|$)/.test(value)) {
    return "analytics_user";
  }
  if (hasUser && /(?:^|_)analytics(?:_|$)/.test(value)) {
    return "analytics_user";
  }
  if (
    /(?:^|_)(?:membership|memberships|member|members)(?:_|$)/.test(value) ||
    /(?:^|_)(?:user_organization|organization_user|org_user|user_org)(?:_|$)/.test(
      value,
    )
  ) {
    return "membership";
  }
  if (/(?:^|_)(?:session|sessions|visitor_session)(?:_|$)/.test(value)) {
    return "session";
  }
  if (
    /(?:^|_)(?:event|events|activity|activities|action|actions|tracking|usage)(?:_|$)/.test(
      value,
    ) ||
    /(?:^|_)(?:active_users?|user_activity)(?:_|$)/.test(value)
  ) {
    return "product_activity";
  }
  if (hasUser && /(?:^|_)(?:builder|product)(?:_|$)/.test(value)) {
    return "product_user";
  }
  if (
    /(?:^|_)(?:crm|hubspot|salesforce|contact|contacts|deal|deals|opportunity|opportunities)(?:_|$)/.test(
      value,
    )
  ) {
    return "crm_record";
  }
  if (
    /(?:^|_)(?:person|people|user|users|profile|profiles)(?:_|$)/.test(value)
  ) {
    return "person";
  }
  if (/(?:^|_)(?:organization|organizations|org|orgs)(?:_|$)/.test(value)) {
    return "organization";
  }
  return "unknown";
}

function hashFile(
  fingerprint: ReturnType<typeof createHash>,
  file: FileRecord,
  content: string,
): void {
  fingerprint.update(file.relativePath);
  fingerprint.update("\u0000");
  fingerprint.update(content);
  fingerprint.update("\u0000");
}

function safeEventName(value: string): string | null {
  const candidate = value.trim();
  if (
    !SAFE_EVENT_NAME.test(candidate) ||
    /(?:\d{5,}|@[A-Z0-9.-]+\.)/i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function safePropertyName(value: string): string | null {
  const candidate = value.trim();
  return SAFE_PROPERTY_NAME.test(candidate) ? candidate : null;
}

function safeDescription(
  value: string,
  scanSummary: SourceIndexScanSummary,
): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (SENSITIVE_TEXT.test(normalized)) {
    scanSummary.unsafeFieldsOmitted += 1;
    return undefined;
  }
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    scanSummary.truncatedFields += 1;
    return boundedExcerpt(normalized, MAX_DESCRIPTION_LENGTH);
  }
  return normalized;
}

function safeRelativePath(
  root: string,
  absolutePath: string,
  scanSummary: SourceIndexScanSummary,
): string | undefined {
  const relative = path.relative(root, absolutePath).split(path.sep);
  if (
    relative.some(
      (segment) =>
        !segment ||
        segment === ".." ||
        /(?:@|\d{7,}|https?:)/i.test(segment) ||
        SENSITIVE_TEXT.test(segment),
    )
  ) {
    scanSummary.unsafeFieldsOmitted += 1;
    return undefined;
  }
  const value = relative.join("/");
  if (value.length <= 240) return value;
  scanSummary.truncatedFields += 1;
  const marker = "… [path truncated]";
  return `${value.slice(0, 240 - marker.length).trimEnd()}${marker}`;
}

function revisionAt(
  root: string,
): { revision: string; committedAt: string } | undefined {
  let metadata: string;
  try {
    metadata = execFileSync(
      "git",
      ["-C", root, "show", "-s", "--format=%H%x00%cI", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: string | Buffer }).stderr ?? "")
        : "";
    if (
      /not a git repository|cannot change to .*no such file or directory/i.test(
        stderr,
      )
    ) {
      return undefined;
    }
    codedError(
      "source_revision_unavailable",
      "A source repository revision could not be read.",
    );
  }

  const separator = metadata.indexOf("\0");
  const fullRevision = metadata.slice(0, separator).trim();
  const committedAt = metadata.slice(separator + 1).trim();
  const committedAtMs = Date.parse(committedAt);
  if (
    separator < 0 ||
    !/^[a-f0-9]{7,64}$/i.test(fullRevision) ||
    !Number.isFinite(committedAtMs)
  ) {
    codedError(
      "source_revision_invalid",
      "A source repository returned invalid revision metadata.",
    );
  }
  return {
    revision: fullRevision.slice(0, 12),
    committedAt: new Date(committedAtMs).toISOString(),
  };
}

function sourceContext(root: string, fallback: string): RootContext {
  const absolutePath = path.resolve(root);
  const id = safeSlug(path.basename(absolutePath), fallback);
  const revision = revisionAt(absolutePath);
  return {
    absolutePath,
    id,
    ...(revision
      ? { revision: revision.revision, committedAt: revision.committedAt }
      : {}),
  };
}

function generatedAtFromDbtCommits(roots: RootContext[]): string | undefined {
  if (roots.some((root) => !root.committedAt)) return undefined;
  const latestCommit = Math.max(
    ...roots.map((root) => Date.parse(root.committedAt!)),
  );
  return Number.isFinite(latestCommit)
    ? new Date(latestCommit).toISOString()
    : undefined;
}

async function listFiles(root: string): Promise<FileRecord[]> {
  let rootEntries;
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    codedError("root_unreadable", "A supplied source root could not be read.");
  }
  const files: FileRecord[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries =
        directory === root
          ? rootEntries
          : await readdir(directory, { withFileTypes: true });
    } catch {
      codedError(
        "directory_unreadable",
        "A source directory could not be read.",
      );
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SENSITIVE_FILE_NAME.test(entry.name)) continue;
      files.push({
        absolutePath,
        relativePath: path
          .relative(root, absolutePath)
          .split(path.sep)
          .join("/"),
      });
      if (files.length > MAX_FILES) {
        codedError(
          "file_limit_exceeded",
          "A source root contains too many files to index safely.",
        );
      }
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readSourceFile(
  file: FileRecord,
  budget: ReadBudget,
): Promise<string> {
  let fileStat;
  try {
    fileStat = await stat(file.absolutePath);
  } catch {
    codedError("file_unreadable", "A source file could not be read.");
  }
  if (fileStat.size > MAX_FILE_BYTES) {
    codedError(
      "file_limit_exceeded",
      "A source file exceeds the safe index size limit.",
    );
  }
  accountSourceBytes(fileStat.size, budget);
  try {
    return await readFile(file.absolutePath, "utf8");
  } catch {
    codedError("file_unreadable", "A source file could not be read.");
  }
}

function yamlCommentFree(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && line[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (
      char === "#" &&
      (index === 0 || /\s/.test(line[index - 1]!)) &&
      !/\d/.test(line[index + 1] ?? "")
    ) {
      return line.slice(0, index);
    }
  }
  return line;
}

function yamlScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") {
        codedError("invalid_yaml_scalar", "A quoted YAML scalar is invalid.");
      }
      return parsed;
    } catch {
      codedError("invalid_yaml_scalar", "A quoted YAML scalar is invalid.");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if ([">", ">-", ">+", "|", "|-", "|+"].includes(value)) return "";
  return value.replace(/\s+#(?!\d).*$/, "").trim();
}

function parseDbtDocBlocks(markdown: string): Map<string, string | null> {
  const docs = new Map<string, string | null>();
  const pattern =
    /{%\s*docs\s+([A-Za-z_][A-Za-z0-9_-]{0,99})\s*%}([\s\S]*?){%\s*enddocs\s*%}/g;
  for (const match of markdown.matchAll(pattern)) {
    const name = match[1]!;
    const description = match[2]!.replace(/\s+/g, " ").trim();
    if (!description) continue;
    docs.set(name, docs.has(name) ? null : description);
  }
  return docs;
}

function dbtDocReferenceName(raw: string): string | null {
  const value = yamlScalar(raw);
  const reference = value.match(
    /^\{\{\s*doc\(\s*(['"])([A-Za-z_][A-Za-z0-9_-]{0,99})\1\s*\)\s*\}\}$/,
  );
  return reference?.[2] ?? null;
}

function referencedDbtDocNames(yaml: string): Set<string> {
  const names = new Set<string>();
  for (const line of yaml.split(/\r?\n/)) {
    const commentFree = yamlCommentFree(line);
    const description = commentFree.match(/^\s*description\s*:\s*(.*)$/);
    if (!description) continue;
    const name = dbtDocReferenceName(description[1]!);
    if (name) names.add(name);
  }
  return names;
}

async function containsReferencedDbtDocBlock(
  file: FileRecord,
  references: Set<string>,
): Promise<boolean> {
  let state:
    | "search"
    | "open"
    | "prefix_whitespace"
    | "docs_word"
    | "docs_space"
    | "name_start"
    | "name"
    | "name_end"
    | "close_brace" = "search";
  let docsWordIndex = 0;
  let name = "";
  const isWhitespace = (value: string) => /\s/u.test(value);
  const isIdentifierStart = (value: string) => /[A-Za-z_]/u.test(value);
  const isIdentifierPart = (value: string) => /[A-Za-z0-9_-]/u.test(value);
  let found = false;
  const stream = createReadStream(file.absolutePath, { encoding: "utf8" });
  try {
    for await (const chunk of stream) {
      for (const value of chunk) {
        const restart = () => {
          state = value === "{" ? "open" : "search";
          docsWordIndex = 0;
          name = "";
        };
        switch (state) {
          case "search":
            if (value === "{") state = "open";
            break;
          case "open":
            if (value === "%") state = "prefix_whitespace";
            else restart();
            break;
          case "prefix_whitespace":
            if (isWhitespace(value)) break;
            if (value === "d") {
              state = "docs_word";
              docsWordIndex = 1;
            } else restart();
            break;
          case "docs_word":
            if (value === "docs"[docsWordIndex]) {
              docsWordIndex += 1;
              if (docsWordIndex === "docs".length) state = "docs_space";
            } else restart();
            break;
          case "docs_space":
            if (isWhitespace(value)) state = "name_start";
            else restart();
            break;
          case "name_start":
            if (isWhitespace(value)) break;
            if (isIdentifierStart(value)) {
              name = value;
              state = "name";
            } else restart();
            break;
          case "name":
            if (isIdentifierPart(value)) {
              name += value;
              if (name.length > 100) restart();
            } else if (isWhitespace(value)) state = "name_end";
            else if (value === "%") state = "close_brace";
            else restart();
            break;
          case "name_end":
            if (isWhitespace(value)) break;
            if (value === "%") state = "close_brace";
            else restart();
            break;
          case "close_brace":
            if (value === "}") {
              if (references.has(name)) {
                found = true;
                break;
              }
              state = "search";
              name = "";
            } else restart();
            break;
        }
        if (found) break;
      }
      if (found) break;
    }
  } catch {
    codedError("file_unreadable", "A source file could not be read.");
  }
  return found;
}

function resolveDbtDocReferences(
  yaml: string,
  docs: Map<string, string | null>,
): string {
  return yaml
    .split(/\r?\n/)
    .map((line) => {
      const commentFree = yamlCommentFree(line);
      const description = commentFree.match(/^(\s*description\s*:\s*)(.*)$/);
      if (!description) return line;
      const name = dbtDocReferenceName(description[2]!);
      if (!name) return line;
      const resolved = docs.get(name);
      if (!resolved) return line;
      return `${description[1]}${JSON.stringify(resolved)}`;
    })
    .join("\n");
}

function yamlList(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((part) => safeIdentifier(yamlScalar(part)))
    .filter((part): part is string => part !== null);
}

function addGrainHint(model: ModelDoc, columns: string[]): void {
  const normalized = [
    ...new Set(
      columns
        .map(safeIdentifier)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (!normalized.length) return;
  const key = normalized.join("\u0000");
  if (!model.grainHints.some((hint) => hint.join("\u0000") === key)) {
    model.grainHints.push(normalized);
  }
}

function parseSchemaYaml(
  raw: string,
  sourcePath: string | undefined,
  scanSummary: SourceIndexScanSummary,
): ModelDoc[] {
  const models: ModelDoc[] = [];
  let modelsIndent: number | null = null;
  let modelItemIndent: number | null = null;
  let context: DbEntryContext | null = null;
  let multiline: {
    target: ModelDoc | ColumnDoc;
    indent: number;
    lines: string[];
  } | null = null;
  let modelMetaIndent: number | null = null;

  const createModelContext = (
    name: string,
    indent: number,
  ): DbEntryContext | null => {
    const safeName = safeIdentifier(name);
    if (!safeName) {
      scanSummary.unsafeEntriesOmitted += 1;
      return null;
    }
    const model: ModelDoc = {
      name: safeName,
      ...(sourcePath ? { sourcePath } : {}),
      columns: new Map(),
      tests: new Set(),
      dependencies: new Set(),
      grainHints: [],
    };
    models.push(model);
    modelMetaIndent = null;
    return {
      model,
      itemIndent: indent,
      columnsIndent: null,
      column: null,
      entityIndent: null,
      dimensionIndent: null,
      testsIndent: null,
      testsOwner: null,
      metricsIndent: null,
      grainListIndent: null,
      grainColumns: null,
    };
  };

  const addTest = (owner: ModelDoc | ColumnDoc | null, name: string) => {
    const candidate = name.trim().replace(/:$/, "");
    const safeName = SAFE_TEST_NAME.test(candidate) ? candidate : null;
    if (safeName) owner?.tests.add(safeName);
  };

  const lines = raw.split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const original = lines[lineNumber]!;
    const line = yamlCommentFree(original);
    if (!line.trim() || /^\s*---\s*$/.test(line)) continue;
    const indent = line.match(/^ */)![0].length;
    const content = line.slice(indent).trim();
    if (
      modelItemIndent === null &&
      modelsIndent !== null &&
      indent > modelsIndent &&
      content.startsWith("-")
    ) {
      modelItemIndent = indent;
    }

    if (multiline && indent > multiline.indent) {
      multiline.lines.push(content);
      continue;
    }
    if (multiline) {
      const target = multiline.target;
      const description = safeDescription(
        multiline.lines.join(" "),
        scanSummary,
      );
      if (description) target.description = description;
      multiline = null;
    }

    if (/^models\s*:\s*(?:#.*)?$/.test(content) && modelsIndent === null) {
      modelsIndent = indent;
      continue;
    }
    if (modelsIndent === null) continue;
    if (indent <= modelsIndent && !/^models\s*:/.test(content)) {
      modelsIndent = null;
      context = null;
      continue;
    }

    const nameItem = content.match(/^-\s+name\s*:\s*(.*?)\s*$/);
    if (nameItem) {
      if (
        context &&
        context.columnsIndent !== null &&
        indent > context.columnsIndent
      ) {
        const name = safeIdentifier(yamlScalar(nameItem[1]!));
        if (!name) {
          scanSummary.unsafeFieldsOmitted += 1;
          continue;
        }
        const column: ColumnDoc = { name, tests: new Set() };
        context.model.columns.set(name, column);
        context.column = column;
        context.entityIndent = null;
        context.dimensionIndent = null;
        context.testsIndent = null;
        context.testsOwner = null;
        context.grainListIndent = null;
        context.grainColumns = null;
      } else if (indent === modelItemIndent) {
        context = createModelContext(yamlScalar(nameItem[1]!), indent);
      }
      continue;
    }
    if (!context) continue;

    const simpleKey = content.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/);
    if (simpleKey) {
      const [, key, rawValue] = simpleKey as [string, string, string];
      const value = yamlScalar(rawValue);

      if (
        context.columnsIndent !== null &&
        indent <= context.columnsIndent &&
        key !== "columns"
      ) {
        context.columnsIndent = null;
        context.column = null;
        context.entityIndent = null;
        context.dimensionIndent = null;
      }
      if (
        context.metricsIndent !== null &&
        indent <= context.metricsIndent &&
        key !== "metrics"
      ) {
        context.metricsIndent = null;
      }

      if (context.testsIndent !== null && indent <= context.testsIndent) {
        context.testsIndent = null;
        context.testsOwner = null;
      }
      if (
        context.grainListIndent !== null &&
        indent <= context.grainListIndent
      ) {
        addGrainHint(context.model, context.grainColumns ?? []);
        context.grainListIndent = null;
        context.grainColumns = null;
      }

      if (key === "columns" && indent > context.itemIndent) {
        context.columnsIndent = indent;
        context.column = null;
        continue;
      }
      if (key === "metrics" && indent > context.itemIndent) {
        context.metricsIndent = indent;
        continue;
      }
      if (
        context.metricsIndent !== null &&
        indent > context.metricsIndent &&
        key === "description"
      ) {
        continue;
      }
      if (
        (key === "tests" || key === "data_tests") &&
        indent > context.itemIndent
      ) {
        context.testsIndent = indent;
        context.testsOwner =
          context.column &&
          context.columnsIndent !== null &&
          indent > context.columnsIndent
            ? context.column
            : context.model;
        const inline = yamlList(rawValue);
        for (const name of inline) addTest(context.testsOwner, name);
        continue;
      }
      if (key === "meta" && indent > context.itemIndent && !context.column) {
        modelMetaIndent = indent;
        continue;
      }
      if (
        key === "grain" &&
        modelMetaIndent !== null &&
        indent > modelMetaIndent &&
        !context.column
      ) {
        const columns = value
          .split(/[,+\s]+/)
          .map(safeIdentifier)
          .filter((name): name is string => Boolean(name));
        addGrainHint(context.model, columns);
        continue;
      }
      if (
        context.column &&
        context.columnsIndent !== null &&
        indent > context.columnsIndent &&
        key === "entity"
      ) {
        context.entityIndent = indent;
        context.dimensionIndent = null;
        continue;
      }
      if (
        context.column &&
        context.columnsIndent !== null &&
        indent > context.columnsIndent &&
        key === "dimension"
      ) {
        context.dimensionIndent = indent;
        context.entityIndent = null;
        continue;
      }
      if (context.entityIndent !== null && indent <= context.entityIndent) {
        context.entityIndent = null;
      }
      if (
        context.dimensionIndent !== null &&
        indent <= context.dimensionIndent
      ) {
        context.dimensionIndent = null;
      }
      if (key === "description") {
        const target =
          context.column &&
          context.columnsIndent !== null &&
          indent > context.columnsIndent
            ? context.column
            : context.model;
        if ([">", ">-", ">+", "|", "|-", "|+"].includes(rawValue.trim())) {
          multiline = { target, indent, lines: [] };
        } else {
          const description = safeDescription(value, scanSummary);
          if (description) target.description = description;
        }
        continue;
      }
      if (
        context.column &&
        context.columnsIndent !== null &&
        indent > context.columnsIndent
      ) {
        if (
          key === "data_type" ||
          (key === "type" &&
            context.entityIndent === null &&
            context.dimensionIndent === null)
        ) {
          if (/^[A-Za-z][A-Za-z0-9_(), ]{0,79}$/.test(value)) {
            context.column.dataType = value;
          }
        }
        if (context.testsIndent !== null && indent > context.testsIndent) {
          addTest(context.testsOwner, key);
        }
      }
      if (
        context.grainListIndent !== null &&
        indent > context.grainListIndent
      ) {
        const column = safeIdentifier(value);
        if (column) context.grainColumns?.push(column);
      }
      if (
        context.testsIndent !== null &&
        indent > context.testsIndent &&
        key.includes("unique_combination")
      ) {
        addTest(context.testsOwner, key);
      }
      if (key === "combination_of_columns" && value.startsWith("[")) {
        const columns = yamlList(value);
        if (columns.length) addGrainHint(context.model, columns);
      } else if (key === "combination_of_columns") {
        context.grainListIndent = indent;
        context.grainColumns = [];
      }
      continue;
    }

    const listItem = content.match(/^-\s*(.*?)\s*$/);
    if (listItem) {
      if (
        context.grainListIndent !== null &&
        indent > context.grainListIndent
      ) {
        const column = safeIdentifier(yamlScalar(listItem[1]!));
        if (column) context.grainColumns?.push(column);
        continue;
      }
      if (context.testsIndent !== null && indent > context.testsIndent) {
        const rawTest = listItem[1]!;
        const testName = rawTest.includes(":")
          ? rawTest.slice(0, rawTest.indexOf(":"))
          : rawTest;
        addTest(context.testsOwner, testName);
        if (testName.includes("unique_combination")) {
          context.grainColumns = context.grainColumns ?? [];
          context.grainListIndent = indent;
        } else if (
          context.grainListIndent !== null &&
          indent > context.grainListIndent
        ) {
          const column = safeIdentifier(yamlScalar(rawTest));
          if (column) context.grainColumns?.push(column);
        }
      } else if (
        context.grainListIndent !== null &&
        indent > context.grainListIndent
      ) {
        const column = safeIdentifier(yamlScalar(listItem[1]!));
        if (column) context.grainColumns?.push(column);
      }
    }
  }
  if (multiline) {
    const description = safeDescription(multiline.lines.join(" "), scanSummary);
    if (description) multiline.target.description = description;
  }
  if (context?.grainColumns) addGrainHint(context.model, context.grainColumns);
  return models;
}

function parseEmbeddedSemanticYaml(
  raw: string,
  sourcePath: string | undefined,
): ModelDoc[] {
  const models: ModelDoc[] = [];
  let modelsIndent: number | null = null;
  let modelItemIndent: number | null = null;
  let current: ModelDoc | null = null;
  let listKind: "columns" | "metrics" | null = null;
  let listIndent: number | null = null;
  let columnItemIndent: number | null = null;
  let metricItemIndent: number | null = null;
  let currentColumn: ColumnDoc | null = null;
  let currentMetric: EmbeddedMetricDoc | null = null;
  let entityIndent: number | null = null;
  let dimensionIndent: number | null = null;
  let configIndent: number | null = null;
  let semanticModelIndent: number | null = null;

  const createModel = (nameValue: string, indent: number): ModelDoc | null => {
    modelItemIndent = indent;
    const name = safeIdentifier(yamlScalar(nameValue));
    if (!name) return null;
    const model: ModelDoc = {
      name,
      ...(sourcePath ? { sourcePath } : {}),
      columns: new Map(),
      tests: new Set(),
      dependencies: new Set(),
      grainHints: [],
      embeddedMetrics: [],
    };
    models.push(model);
    listKind = null;
    listIndent = null;
    columnItemIndent = null;
    metricItemIndent = null;
    currentColumn = null;
    currentMetric = null;
    entityIndent = null;
    dimensionIndent = null;
    configIndent = null;
    semanticModelIndent = null;
    return model;
  };

  const finishMetric = () => {
    if (current && currentMetric?.name) {
      current.embeddedMetrics ??= [];
      current.embeddedMetrics.push(currentMetric);
    }
    currentMetric = null;
    metricItemIndent = null;
  };

  for (const original of raw.split(/\r?\n/)) {
    const line = yamlCommentFree(original);
    if (!line.trim() || /^\s*---\s*$/.test(line)) continue;
    const indent = line.match(/^ */)![0].length;
    const content = line.slice(indent).trim();

    if (/^models\s*:\s*(?:#.*)?$/.test(content) && modelsIndent === null) {
      modelsIndent = indent;
      modelItemIndent = null;
      continue;
    }
    if (modelsIndent === null) continue;
    if (indent <= modelsIndent && !/^models\s*:/.test(content)) {
      finishMetric();
      modelsIndent = null;
      modelItemIndent = null;
      current = null;
      listKind = null;
      continue;
    }

    const nameItem = content.match(/^[-]\s+name\s*:\s*(.*?)\s*$/);
    if (nameItem && indent > modelsIndent) {
      if (modelItemIndent === null || indent === modelItemIndent) {
        finishMetric();
        current = createModel(nameItem[1]!, indent);
        continue;
      }
      if (current && listKind && listIndent !== null && indent > listIndent) {
        if (listKind === "columns") {
          const name = safeIdentifier(yamlScalar(nameItem[1]!));
          currentColumn = name ? { name, tests: new Set() } : null;
          if (currentColumn) {
            current.columns.set(name!, currentColumn);
            columnItemIndent = indent;
            entityIndent = null;
            dimensionIndent = null;
          }
        } else {
          finishMetric();
          currentMetric = { name: yamlScalar(nameItem[1]!) };
          metricItemIndent = indent;
        }
        continue;
      }
    }
    if (!current || modelItemIndent === null) continue;

    const simpleKey = content.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/);
    if (!simpleKey) continue;
    const [, key, rawValue] = simpleKey as [string, string, string];
    const value = yamlScalar(rawValue);
    const modelKeyIndent = modelItemIndent + 2;

    if (indent === modelKeyIndent) {
      finishMetric();
      currentColumn = null;
      columnItemIndent = null;
      entityIndent = null;
      dimensionIndent = null;
      listKind = null;
      listIndent = null;
      configIndent = null;
      semanticModelIndent = null;
      if (key === "columns" || key === "metrics") {
        listKind = key;
        listIndent = indent;
      } else if (key === "config") {
        configIndent = indent;
      } else if (key === "semantic_model") {
        semanticModelIndent = indent;
      } else if (key === "agg_time_dimension") {
        current.aggTimeDimension = value;
      }
      continue;
    }

    if (configIndent !== null && indent > configIndent && key === "group") {
      current.group = value;
      continue;
    }
    if (semanticModelIndent !== null && indent > semanticModelIndent) {
      if (key === "enabled") {
        current.semanticModelEnabled = value.toLowerCase() === "true";
      } else if (key === "name") {
        current.semanticModelName = value;
      }
      continue;
    }

    if (currentMetric && metricItemIndent !== null) {
      if (indent <= metricItemIndent) {
        finishMetric();
      } else if (indent === metricItemIndent + 2) {
        if (key === "type") currentMetric.type = value;
        else if (key === "description") currentMetric.description = value;
        else if (key === "label") currentMetric.label = value;
        else if (key === "agg") currentMetric.agg = value;
        else if (key === "expr") currentMetric.expr = value;
        else if (key === "agg_time_dimension")
          currentMetric.aggTimeDimension = value;
        continue;
      }
    }

    if (currentColumn && columnItemIndent !== null) {
      if (indent <= columnItemIndent) {
        currentColumn = null;
        entityIndent = null;
        dimensionIndent = null;
      } else if (indent === columnItemIndent + 2) {
        if (key === "entity") {
          entityIndent = indent;
          dimensionIndent = null;
        } else if (key === "dimension") {
          dimensionIndent = indent;
          entityIndent = null;
        } else if (key === "granularity") {
          currentColumn.granularity = value;
        }
      } else if (entityIndent !== null && indent > entityIndent) {
        if (key === "name") currentColumn.entityName = value;
        else if (key === "type") currentColumn.entityType = value;
      } else if (dimensionIndent !== null && indent > dimensionIndent) {
        if (key === "type") currentColumn.dimensionType = value;
      }
    }
  }
  finishMetric();
  return models;
}

function parseSemanticYamlItems(
  raw: string,
  sourcePath: string | undefined,
  scanSummary: SourceIndexScanSummary,
): DbtYamlItem[] {
  const items: DbtYamlItem[] = [];
  let section: DbtYamlItem["section"] | null = null;
  let sectionIndent = -1;
  let itemIndent: number | null = null;
  let current: DbtYamlItem | null = null;
  let currentChild: {
    indent: number;
    fields: Record<string, string>;
  } | null = null;
  let stack: Array<{ indent: number; key: string }> = [];
  let multiline: DbtYamlMultiline | null = null;

  const startItem = (
    indent: number,
    nameValue: string,
    activeSection: DbtYamlItem["section"],
  ) => {
    current = {
      section: activeSection,
      itemIndent: indent,
      ...(sourcePath ? { sourcePath } : {}),
      values: { name: yamlScalar(nameValue) },
      nested: {},
      children: new Map(),
    };
    items.push(current);
    itemIndent = indent;
    currentChild = null;
    stack = [];
  };

  for (const original of raw.split(/\r?\n/)) {
    const line = yamlCommentFree(original);
    if (!line.trim() || /^\s*---\s*$/.test(line)) continue;
    const indent = line.match(/^ */)![0].length;
    const content = line.slice(indent).trim();

    if (multiline && indent > multiline.indent) {
      multiline.lines.push(content);
      continue;
    }
    if (multiline) {
      multiline.target[multiline.key] = multiline.lines.join(" ");
      multiline = null;
    }

    if (indent === 0) {
      const sectionHeader = content.match(
        /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/,
      );
      if (sectionHeader) {
        const name = sectionHeader[1];
        section =
          name === "semantic_models" || name === "metrics" || name === "groups"
            ? name
            : null;
        sectionIndent = indent;
        itemIndent = null;
        current = null;
        currentChild = null;
        stack = [];
        continue;
      }
    }
    const activeSection = section;
    if (!activeSection) continue;

    const mainItem = content.match(/^[-]\s+name\s*:\s*(.*?)\s*$/);
    if (
      mainItem &&
      (itemIndent === null || indent === itemIndent) &&
      indent > sectionIndent
    ) {
      startItem(indent, mainItem[1]!, activeSection);
      continue;
    }
    const currentItem = current as DbtYamlItem | null;
    if (!currentItem || itemIndent === null) continue;
    if (indent <= itemIndent) {
      current = null;
      currentChild = null;
      stack = [];
      continue;
    }

    const listItem = content.match(/^[-]\s*(.*?)\s*$/);
    if (listItem && indent > itemIndent) {
      while (stack.length && stack[stack.length - 1]!.indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]?.key;
      if (!parent) continue;
      const fields: Record<string, string> = {};
      const childName = listItem[1]!.match(/^name\s*:\s*(.*?)\s*$/);
      if (childName) fields.name = yamlScalar(childName[1]!);
      const children = currentItem.children.get(parent) ?? [];
      children.push(fields);
      currentItem.children.set(parent, children);
      currentChild = { indent, fields };
      continue;
    }

    const simpleKey = content.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/);
    const activeChild = currentChild as {
      indent: number;
      fields: Record<string, string>;
    } | null;
    if (!simpleKey) {
      if (activeChild && indent > activeChild.indent) {
        scanSummary.unsafeFieldsOmitted += 1;
      }
      continue;
    }

    const [, key, rawValue] = simpleKey as [string, string, string];
    while (stack.length && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    if (activeChild && indent <= activeChild.indent) currentChild = null;
    const parentPath = stack.map(({ key: parentKey }) => parentKey);
    const isBlock = [">", ">-", ">+", "|", "|-", "|+"].includes(
      rawValue.trim(),
    );

    if (activeChild && indent > activeChild.indent) {
      const target = activeChild.fields;
      const targetKey = [...parentPath.slice(1), key].join(".");
      if (isBlock) multiline = { target, key: targetKey, indent, lines: [] };
      else target[targetKey] = yamlScalar(rawValue);
      if (!rawValue.trim()) stack.push({ indent, key });
      continue;
    }

    if (parentPath[0] === "owner" && key === "name") {
      currentItem.ownerName = yamlScalar(rawValue);
      continue;
    }
    if (indent === itemIndent + 2 && parentPath.length === 0) {
      if (isBlock)
        multiline = { target: currentItem.values, key, indent, lines: [] };
      else currentItem.values[key] = yamlScalar(rawValue);
    } else if (parentPath.length > 0) {
      currentItem.nested[[...parentPath, key].join(".")] = yamlScalar(rawValue);
    } else {
      currentItem.values[key] = yamlScalar(rawValue);
    }
    if (!rawValue.trim()) stack.push({ indent, key });
  }

  if (multiline) multiline.target[multiline.key] = multiline.lines.join(" ");
  return items;
}

function safeOwnerName(
  value: string | undefined,
  scanSummary: SourceIndexScanSummary,
): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (SENSITIVE_TEXT.test(normalized)) {
    scanSummary.unsafeFieldsOmitted += 1;
    return undefined;
  }
  if (normalized.length > 160) {
    scanSummary.truncatedFields += 1;
    return boundedExcerpt(normalized, 160);
  }
  return normalized;
}

interface SemanticModelContext {
  name: string;
  owner?: string;
  grain?: string;
  primaryEntity?: string;
  timeDimension?: string;
  entry: SourceIndexEntry;
  item?: DbtYamlItem;
  modelDoc?: ModelDoc;
}

function semanticModelEntries(
  root: RootContext,
  yamlItems: DbtYamlItem[],
  models: ModelDoc[],
  scanSummary: SourceIndexScanSummary,
): SourceIndexEntry[] {
  const groups = new Map<string, string>();
  for (const item of yamlItems.filter(({ section }) => section === "groups")) {
    const name = safeIdentifier(item.values.name ?? "");
    const owner = safeOwnerName(
      item.ownerName ?? item.values.owner,
      scanSummary,
    );
    if (name && owner) groups.set(name, owner);
  }

  const docs = yamlItems.filter(({ section }) => section === "semantic_models");
  const semanticModels: SemanticModelContext[] = docs.flatMap((item) => {
    const name = safeIdentifier(item.values.name ?? "");
    if (!name) {
      scanSummary.unsafeEntriesOmitted += 1;
      return [];
    }
    const modelReference = item.values.model?.match(
      /(?:ref|source)\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_-]{0,99})['"]/,
    )?.[1];
    const modelName = modelReference ? safeIdentifier(modelReference) : null;
    const primary = (item.children.get("entities") ?? []).find(
      (entity) => entity.type?.toLowerCase() === "primary",
    );
    const primaryEntityKey =
      safeIdentifier(primary?.expr ?? primary?.name ?? "") ?? undefined;
    const primaryEntityName =
      safeIdentifier(primary?.name ?? "") ?? primaryEntityKey;
    const primaryEntity =
      safeIdentifier(item.values.primary_entity ?? "") ?? primaryEntityName;
    const timeDimension =
      safeIdentifier(item.nested["defaults.agg_time_dimension"] ?? "") ??
      (item.children.get("dimensions") ?? [])
        .filter((dimension) => dimension.type?.toLowerCase() === "time")
        .map((dimension) => safeIdentifier(dimension.name ?? ""))
        .find((value): value is string => Boolean(value));
    const modelDoc = modelName
      ? models.find((model) => model.name === modelName)
      : undefined;
    const uniqueGrain = modelDoc?.grainHints[0];
    const explicitGrain = safeDescription(item.values.grain ?? "", scanSummary);
    const grain =
      explicitGrain ??
      (uniqueGrain?.length
        ? `Unique key: ${uniqueGrain.join(", ")}`
        : primaryEntityKey
          ? `Primary entity: ${primaryEntityKey}`
          : undefined);
    const group = safeIdentifier(item.values.group ?? "");
    const owner =
      safeOwnerName(item.ownerName ?? item.values.owner, scanSummary) ??
      (group ? groups.get(group) : undefined);
    const description = safeDescription(
      item.values.description ?? "",
      scanSummary,
    );
    const definition = boundedExcerpt(
      [
        description ?? `dbt semantic model ${name}`,
        ...(modelName ? [`Model: ${modelName}`] : []),
        ...(primaryEntity ? [`Primary entity: ${primaryEntity}`] : []),
        ...(primaryEntity &&
        primaryEntityKey &&
        primaryEntity !== primaryEntityKey
          ? [`Primary entity expression: ${primaryEntityKey}`]
          : []),
        ...(timeDimension ? [`Time dimension: ${timeDimension}`] : []),
      ].join(". "),
      5_000,
    );
    const entry: SourceIndexEntry = {
      id: entryId(root.id, "semantic-model", name),
      metric: `semantic_model:${name}`,
      definition,
      source: root.id,
      sourceKind: "dbt",
      entryType: "semantic_model",
      ...(modelName ? { table: modelName } : {}),
      ...(owner ? { owner } : {}),
      ...(grain ? { grain } : {}),
      ...(primaryEntity ? { primaryEntity } : {}),
      ...(timeDimension ? { timeDimension } : {}),
      ...(item.values.description
        ? { commonQuestions: `semantic model ${name}` }
        : {}),
      ...(item.sourcePath ? { sourcePath: item.sourcePath } : {}),
      ...(root.revision ? { sourceRevision: root.revision } : {}),
      semanticScope: inferSemanticScope(`${name} ${modelName ?? ""}`),
    };
    return [{ name, owner, grain, primaryEntity, timeDimension, entry, item }];
  });

  const embeddedSemanticModels: SemanticModelContext[] = models.flatMap(
    (modelDoc) => {
      if (!modelDoc.semanticModelEnabled) return [];
      const name = safeIdentifier(modelDoc.semanticModelName ?? modelDoc.name);
      if (!name) {
        scanSummary.unsafeEntriesOmitted += 1;
        return [];
      }
      const primaryColumn = [...modelDoc.columns.values()].find((column) =>
        ["primary", "natural"].includes(
          (column.entityType ?? "").toLowerCase(),
        ),
      );
      const primaryEntity = primaryColumn
        ? (safeIdentifier(primaryColumn.entityName ?? "") ??
          safeIdentifier(primaryColumn.name) ??
          undefined)
        : undefined;
      const timeDimension =
        safeIdentifier(modelDoc.aggTimeDimension ?? "") ??
        [...modelDoc.columns.values()]
          .filter((column) => column.dimensionType?.toLowerCase() === "time")
          .map((column) => safeIdentifier(column.name ?? ""))
          .find((value): value is string => Boolean(value));
      const uniqueGrain = modelDoc.grainHints[0];
      const grain = uniqueGrain?.length
        ? `Unique key: ${uniqueGrain.join(", ")}`
        : primaryEntity
          ? `Primary entity: ${primaryEntity}`
          : undefined;
      const group = safeIdentifier(modelDoc.group ?? "");
      const owner = group ? groups.get(group) : undefined;
      const description = safeDescription(
        modelDoc.description ?? "",
        scanSummary,
      );
      const entities = [...modelDoc.columns.values()].flatMap((column) => {
        const type = safeIdentifier(column.entityType ?? "");
        const entity = safeIdentifier(column.entityName ?? column.name);
        return type && entity ? [`${column.name} (${type} ${entity})`] : [];
      });
      const dimensions = [...modelDoc.columns.values()].flatMap((column) => {
        const type = safeIdentifier(column.dimensionType ?? "");
        const granularity = safeIdentifier(column.granularity ?? "");
        return type
          ? [`${column.name} (${type}${granularity ? `, ${granularity}` : ""})`]
          : [];
      });
      const definition = boundedExcerpt(
        [
          description ?? `dbt semantic model ${name}`,
          `Model: ${modelDoc.name}`,
          ...(primaryEntity
            ? [
                `Primary entity: ${primaryEntity}${primaryColumn && primaryColumn.name !== primaryEntity ? ` (column ${primaryColumn.name})` : ""}`,
              ]
            : []),
          ...(timeDimension ? [`Time dimension: ${timeDimension}`] : []),
          ...(entities.length
            ? [`Entity columns: ${entities.join("; ")}`]
            : []),
          ...(dimensions.length
            ? [`Dimensions: ${dimensions.join("; ")}`]
            : []),
        ].join(". "),
        5_000,
      );
      const entry: SourceIndexEntry = {
        id: entryId(root.id, "semantic-model", name),
        metric: `semantic_model:${name}`,
        definition,
        source: root.id,
        sourceKind: "dbt",
        entryType: "semantic_model",
        table: modelDoc.name,
        ...(owner ? { owner } : {}),
        ...(grain ? { grain } : {}),
        ...(primaryEntity ? { primaryEntity } : {}),
        ...(timeDimension ? { timeDimension } : {}),
        ...(description ? { commonQuestions: `semantic model ${name}` } : {}),
        ...(modelDoc.sourcePath ? { sourcePath: modelDoc.sourcePath } : {}),
        ...(root.revision ? { sourceRevision: root.revision } : {}),
        semanticScope: inferSemanticScope(`${name} ${modelDoc.name}`),
      };
      return [
        {
          name,
          owner,
          grain,
          primaryEntity,
          timeDimension,
          entry,
          modelDoc,
        },
      ];
    },
  );
  semanticModels.push(...embeddedSemanticModels);

  const semanticMeasures = new Map<string, (typeof semanticModels)[number]>();
  for (const semanticModel of semanticModels) {
    for (const measure of semanticModel.item?.children.get("measures") ?? []) {
      const measureName = safeIdentifier(measure.name ?? "");
      if (measureName) semanticMeasures.set(measureName, semanticModel);
    }
  }

  const metricEntries = yamlItems
    .filter(({ section }) => section === "metrics")
    .flatMap((item) => {
      const name = safeIdentifier(item.values.name ?? "");
      if (!name) {
        scanSummary.unsafeEntriesOmitted += 1;
        return [];
      }
      const measure = safeIdentifier(item.nested["type_params.measure"] ?? "");
      const referencedModel = safeIdentifier(
        item.values.semantic_model ?? item.values.semanticModel ?? "",
      );
      const semanticModel = referencedModel
        ? semanticModels.find((candidate) => candidate.name === referencedModel)
        : measure
          ? semanticMeasures.get(measure)
          : undefined;
      const group = safeIdentifier(item.values.group ?? "");
      const owner =
        safeOwnerName(item.ownerName ?? item.values.owner, scanSummary) ??
        (group ? groups.get(group) : undefined) ??
        semanticModel?.owner;
      const explicitGrain = safeDescription(
        item.values.grain ?? "",
        scanSummary,
      );
      const grain = explicitGrain ?? semanticModel?.grain;
      const description = safeDescription(
        item.values.description ?? "",
        scanSummary,
      );
      const metricType = safeIdentifier(item.values.type ?? "");
      const label = safeDescription(item.values.label ?? "", scanSummary);
      const definition = boundedExcerpt(
        [
          description ?? label ?? `dbt metric ${name}`,
          ...(metricType ? [`Type: ${metricType}`] : []),
          ...(measure ? [`Measure: ${measure}`] : []),
          ...(semanticModel ? [`Semantic model: ${semanticModel.name}`] : []),
        ].join(". "),
        5_000,
      );
      return [
        {
          id: entryId(root.id, "metric", name),
          metric: `metric:${name}`,
          definition,
          source: root.id,
          sourceKind: "dbt" as const,
          entryType: "metric" as const,
          ...(owner ? { owner } : {}),
          ...(grain ? { grain } : {}),
          ...(semanticModel
            ? { semanticModel: semanticModel.name }
            : referencedModel
              ? { semanticModel: referencedModel }
              : {}),
          ...(semanticModel?.primaryEntity
            ? { primaryEntity: semanticModel.primaryEntity }
            : {}),
          ...(semanticModel?.timeDimension
            ? { timeDimension: semanticModel.timeDimension }
            : {}),
          ...(semanticModel?.entry.table
            ? { table: semanticModel.entry.table }
            : {}),
          ...(item.sourcePath ? { sourcePath: item.sourcePath } : {}),
          ...(item.values.description
            ? { commonQuestions: `metric ${name}` }
            : {}),
          ...(root.revision ? { sourceRevision: root.revision } : {}),
          semanticScope: inferSemanticScope(
            `${name} ${semanticModel?.name ?? ""} ${semanticModel?.entry.table ?? ""}`,
          ),
        },
      ];
    });

  const embeddedMetricEntries = semanticModels.flatMap((semanticModel) => {
    const modelDoc = semanticModel.modelDoc;
    if (!modelDoc) return [];
    return (modelDoc.embeddedMetrics ?? []).flatMap((metric) => {
      if (metric.type?.toLowerCase() !== "simple") return [];
      const name = safeIdentifier(metric.name);
      if (!name) {
        scanSummary.unsafeEntriesOmitted += 1;
        return [];
      }
      const description = safeDescription(
        metric.description ?? "",
        scanSummary,
      );
      const label = safeDescription(metric.label ?? "", scanSummary);
      const aggregation = safeIdentifier(metric.agg ?? "");
      const expression = safeDescription(metric.expr ?? "", scanSummary);
      const timeDimension =
        safeIdentifier(metric.aggTimeDimension ?? "") ??
        semanticModel.timeDimension;
      const definition = boundedExcerpt(
        [
          description ?? label ?? `dbt simple metric ${name}`,
          "Type: simple",
          ...(aggregation ? [`Aggregation: ${aggregation}`] : []),
          ...(expression ? [`Expression: ${expression}`] : []),
          `Semantic model: ${semanticModel.name}`,
        ].join(". "),
        5_000,
      );
      return [
        {
          id: entryId(root.id, "metric", name),
          metric: `metric:${name}`,
          definition,
          source: root.id,
          sourceKind: "dbt" as const,
          entryType: "metric" as const,
          ...(semanticModel.owner ? { owner: semanticModel.owner } : {}),
          ...(semanticModel.grain ? { grain: semanticModel.grain } : {}),
          semanticModel: semanticModel.name,
          ...(semanticModel.primaryEntity
            ? { primaryEntity: semanticModel.primaryEntity }
            : {}),
          ...(timeDimension ? { timeDimension } : {}),
          table: modelDoc.name,
          ...(modelDoc.sourcePath ? { sourcePath: modelDoc.sourcePath } : {}),
          ...(description ? { commonQuestions: `metric ${name}` } : {}),
          ...(root.revision ? { sourceRevision: root.revision } : {}),
          semanticScope: inferSemanticScope(
            `${name} ${semanticModel.name} ${modelDoc.name}`,
          ),
        },
      ];
    });
  });

  return [
    ...semanticModels.map(({ entry }) => entry),
    ...metricEntries,
    ...embeddedMetricEntries,
  ];
}

function mergeModel(target: ModelDoc, source: ModelDoc): void {
  target.sourcePath ??= source.sourcePath;
  target.description ??= source.description;
  target.semanticModelEnabled ??= source.semanticModelEnabled;
  target.semanticModelName ??= source.semanticModelName;
  target.group ??= source.group;
  target.aggTimeDimension ??= source.aggTimeDimension;
  if (source.embeddedMetrics?.length) {
    target.embeddedMetrics ??= [];
    const metricNames = new Set(target.embeddedMetrics.map(({ name }) => name));
    for (const metric of source.embeddedMetrics) {
      if (metricNames.has(metric.name)) continue;
      target.embeddedMetrics.push(metric);
      metricNames.add(metric.name);
    }
  }
  for (const test of source.tests) target.tests.add(test);
  for (const dependency of source.dependencies)
    target.dependencies.add(dependency);
  for (const grain of source.grainHints) addGrainHint(target, grain);
  for (const [name, incoming] of source.columns) {
    const current = target.columns.get(name);
    if (!current) {
      target.columns.set(name, incoming);
      continue;
    }
    current.description ??= incoming.description;
    current.dataType ??= incoming.dataType;
    current.entityName ??= incoming.entityName;
    current.entityType ??= incoming.entityType;
    current.dimensionType ??= incoming.dimensionType;
    current.granularity ??= incoming.granularity;
    for (const test of incoming.tests) current.tests.add(test);
  }
}

function sqlWithoutComments(sql: string): string {
  let result = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (escaped) {
      result += " ";
      escaped = false;
      continue;
    }
    if (quote) {
      result += char === "\n" ? "\n" : " ";
      if (char === "\\" && quote !== "`") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "{" && next === "{") {
      const end = sql.indexOf("}}", index + 2);
      if (end >= 0) {
        result += sql.slice(index, end + 2);
        index = end + 1;
        continue;
      }
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += " ";
      continue;
    }
    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < sql.length &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        if (sql[index] === "\n") result += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

function extractSqlDependencies(sql: string): string[] {
  const source = sqlWithoutComments(sql);
  const dependencies = new Set<string>();
  for (const match of source.matchAll(
    /\{\{\s*ref\s*\(\s*(['"])([A-Za-z_][A-Za-z0-9_-]{0,99})\1\s*\)\s*\}\}/g,
  )) {
    const name = safeIdentifier(match[2]!);
    if (name) dependencies.add(`ref:${name}`);
  }
  for (const match of source.matchAll(
    /\{\{\s*source\s*\(\s*(['"])([A-Za-z_][A-Za-z0-9_-]{0,99})\1\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_-]{0,99})\3\s*\)\s*\}\}/g,
  )) {
    const schema = safeIdentifier(match[2]!);
    const table = safeIdentifier(match[4]!);
    if (schema && table) dependencies.add(`source:${schema}.${table}`);
  }
  return [...dependencies].sort();
}

function extractUniqueKey(sql: string): string[][] {
  const source = sqlWithoutComments(sql);
  const hints: string[][] = [];
  for (const match of source.matchAll(
    /\bunique_key\s*[:=]\s*(\[[^\]]{0,1000}\]|['"]([A-Za-z_][A-Za-z0-9_-]{0,99})['"])/g,
  )) {
    const value = match[1]!;
    const columns = value.startsWith("[")
      ? value
          .slice(1, -1)
          .split(",")
          .map((part) => safeIdentifier(part.replace(/['"\s]/g, "")))
          .filter((part): part is string => part !== null)
      : [match[2]!];
    if (columns.length) hints.push([...new Set(columns)]);
  }
  return hints;
}

function isTestSql(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => segment.toLowerCase() === "tests");
}

function isIndexableModelSql(relativePath: string): boolean {
  const segments = relativePath
    .split("/")
    .map((segment) => segment.toLowerCase());
  if (segments.some((segment) => DBT_EXCLUDED_SQL_DIRECTORIES.has(segment)))
    return false;
  return !isTestSql(relativePath);
}

function parseLiteral(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\(['\\])/g, "$1");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (
    value.startsWith("`") &&
    value.endsWith("`") &&
    !value.slice(1, -1).includes("${")
  ) {
    return value.slice(1, -1);
  }
  return null;
}

function maskCodeStringsAndComments(source: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "*" && next === "/") {
        output += " ";
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (escaped) {
      output += " ";
      escaped = false;
      continue;
    }
    if (quote) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function maskCodeComments(source: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "*" && next === "/") {
        output += " ";
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (quote) {
      output += char;
      if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    output += char;
  }
  return output;
}

interface ObjectMember {
  key: string;
  value: string;
}

function splitTopLevel(source: string): string[] {
  const syntax = maskCodeComments(source);
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < syntax.length; index += 1) {
    const char = syntax[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(syntax.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = syntax.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function objectMembers(
  expression: string,
  scanSummary: SourceIndexScanSummary,
): ObjectMember[] {
  const value = expression.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  return splitTopLevel(value.slice(1, -1))
    .map((part) => {
      if (part.startsWith("...")) return null;
      const colon = part.indexOf(":");
      if (colon < 0) {
        const key = part.trim().replace(/^['"]|['"]$/g, "");
        if (safePropertyName(key)) return { key, value: "" };
        scanSummary.unsafeFieldsOmitted += 1;
        return null;
      }
      const rawKey = part.slice(0, colon).trim();
      const key = rawKey.replace(/^['"]|['"]$/g, "");
      if (safePropertyName(key)) {
        return { key, value: part.slice(colon + 1).trim() };
      }
      scanSummary.unsafeFieldsOmitted += 1;
      return null;
    })
    .filter((member): member is ObjectMember => member !== null);
}

function callArguments(source: string, openParen: number): string[] | null {
  const syntax = maskCodeComments(source);
  let depth = 1;
  let braceDepth = 0;
  let bracketDepth = 0;
  let start = openParen + 1;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  const args: string[] = [];
  for (let index = openParen + 1; index < syntax.length; index += 1) {
    const char = syntax[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const final = syntax.slice(start, index).trim();
        if (final) args.push(final);
        return args;
      }
    } else if (
      char === "," &&
      depth === 1 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      args.push(syntax.slice(start, index).trim());
      start = index + 1;
    }
  }
  return null;
}

function trackedEventParts(
  args: string[],
  constants: Map<string, string>,
  scanSummary: SourceIndexScanSummary,
):
  | { status: "resolved"; name: string; properties: string[] }
  | { status: "unresolved" }
  | { status: "unsafe" } {
  const first = args[0]?.trim();
  if (!first) return { status: "unresolved" };
  const firstLiteral = parseLiteral(first);
  if (firstLiteral !== null) {
    const name = safeEventName(firstLiteral);
    if (!name) {
      scanSummary.unsafeEntriesOmitted += 1;
      return { status: "unsafe" };
    }
    const direct = objectMembers(args[1] ?? "{}", scanSummary).map(
      ({ key }) => key,
    );
    return { status: "resolved", name, properties: direct };
  }
  const constantName = constants.get(first);
  if (constantName !== undefined) {
    const name = safeEventName(constantName);
    if (!name) {
      scanSummary.unsafeEntriesOmitted += 1;
      return { status: "unsafe" };
    }
    const direct = objectMembers(args[1] ?? "{}", scanSummary).map(
      ({ key }) => key,
    );
    return { status: "resolved", name, properties: direct };
  }

  const object = objectMembers(first, scanSummary);
  const eventMember = object.find(({ key }) =>
    ["event", "eventName", "name"].includes(key),
  );
  const rawName = eventMember ? parseLiteral(eventMember.value) : null;
  const name = rawName !== null ? safeEventName(rawName) : null;
  if (!name) {
    if (rawName !== null) {
      scanSummary.unsafeEntriesOmitted += 1;
      return { status: "unsafe" };
    }
    return { status: "unresolved" };
  }
  const properties = new Set<string>();
  for (const member of object) {
    if (
      [
        "event",
        "eventName",
        "name",
        "properties",
        "props",
        "eventProperties",
      ].includes(member.key)
    ) {
      continue;
    }
    properties.add(member.key);
  }
  for (const member of object) {
    if (["properties", "props", "eventProperties"].includes(member.key)) {
      for (const { key } of objectMembers(member.value, scanSummary)) {
        properties.add(key);
      }
    }
  }
  return { status: "resolved", name, properties: [...properties] };
}

function findCallClosingParen(code: string, openParen: number): number | null {
  let depth = 1;
  for (let index = openParen + 1; index < code.length; index += 1) {
    if (code[index] === "(") depth += 1;
    else if (code[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function isTrackingDeclaration(
  code: string,
  callStart: number,
  openParen: number,
  args: string[] | null,
): boolean {
  const prefix = code.slice(Math.max(0, callStart - 40), callStart);
  if (/\bfunction(?:\s*\*)?\s*$/.test(prefix)) return true;

  const firstParameter = args?.[0]?.trim();
  if (
    firstParameter &&
    /^(?:\.\.\.)?[A-Za-z_$][A-Za-z0-9_$]*(?:\?|!)?\s*:\s*/.test(firstParameter)
  ) {
    return true;
  }

  const closingParen = findCallClosingParen(code, openParen);
  if (closingParen === null) return false;
  const suffix = code.slice(closingParen + 1);
  return (
    /^\s*(?::\s*[^{};\n]+)?\s*\{/.test(suffix) ||
    /^\s*(?::\s*[^{};\n]+)?\s*=>/.test(suffix)
  );
}

function extractCodeEvents(
  source: string,
  sourcePath: string | undefined,
  scanSummary: SourceIndexScanSummary,
): CodeEvent[] {
  const events = new Map<string, CodeEvent>();
  const codeMask = maskCodeStringsAndComments(source);
  const commentMask = maskCodeComments(source);
  const constants = new Map<string, string>();
  const constantPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[\s\S])*)\2/g;
  for (const match of commentMask.matchAll(constantPattern)) {
    const name = match[1]!;
    const value = parseLiteral(`${match[2]}${match[3]}${match[2]}`);
    if (value !== null) constants.set(name, value);
  }

  const objectVariables = new Map<string, string[]>();
  const variablePattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{/g;
  for (const match of codeMask.matchAll(variablePattern)) {
    const name = match[1]!;
    const openBrace = (match.index ?? 0) + match[0].lastIndexOf("{");
    let depth = 1;
    let end = openBrace + 1;
    while (end < codeMask.length && depth > 0) {
      if (codeMask[end] === "{") depth += 1;
      else if (codeMask[end] === "}") depth -= 1;
      end += 1;
    }
    if (depth === 0) {
      objectVariables.set(
        name,
        objectMembers(commentMask.slice(openBrace, end), scanSummary).map(
          ({ key }) => key,
        ),
      );
    }
  }

  const callPattern =
    /\b(?:track|trackEvent|trackAnalyticsEvent|capture|captureEvent)\s*\(/g;
  for (const match of codeMask.matchAll(callPattern)) {
    const start = match.index ?? 0;
    const openParen = start + match[0].lastIndexOf("(");
    const args = callArguments(source, openParen);
    if (isTrackingDeclaration(codeMask, start, openParen, args)) continue;
    if (!args) {
      scanSummary.unresolvedTrackingCallSites += 1;
      continue;
    }
    const extracted = trackedEventParts(args, constants, scanSummary);
    if (extracted.status === "unresolved") {
      scanSummary.unresolvedTrackingCallSites += 1;
      continue;
    }
    if (extracted.status === "unsafe") continue;
    const properties = new Set(extracted.properties);
    const secondArgument = args[1]?.trim();
    if (secondArgument && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(secondArgument)) {
      for (const key of objectVariables.get(secondArgument) ?? [])
        properties.add(key);
    }
    const entry = events.get(extracted.name) ?? {
      name: extracted.name,
      properties: new Set<string>(),
      sourcePaths: new Set<string>(),
    };
    for (const property of properties) {
      const safe = safePropertyName(property);
      if (safe) entry.properties.add(safe);
    }
    if (sourcePath) entry.sourcePaths.add(sourcePath);
    events.set(extracted.name, entry);
  }

  return [...events.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeModels(
  root: RootContext,
  docs: ModelDoc[],
  sqlModels: ModelDoc[],
): ModelDoc[] {
  const models = new Map<string, ModelDoc>();
  for (const model of [...sqlModels, ...docs]) {
    const current = models.get(model.name);
    if (current) mergeModel(current, model);
    else models.set(model.name, model);
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function modelEntries(root: RootContext, model: ModelDoc): SourceIndexEntry[] {
  const columns = [...model.columns.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const dependencies = [...model.dependencies].sort();
  const grain = model.grainHints
    .map((hint) => [...hint].sort())
    .sort((a, b) => a.join(",").localeCompare(b.join(",")));
  const joinPattern = grain.length
    ? boundedList(
        grain.map((hint) => `Unique grain: ${hint.join(", ")}`),
        4_000,
        "; ",
      )
    : undefined;
  const columnDefinitions = columns.map((column) => {
    const type = column.dataType ? ` (${column.dataType})` : "";
    const description = column.description ? `: ${column.description}` : "";
    return `${column.name}${type}${description}`;
  });
  const definitionParts = [
    model.description ?? `dbt model ${model.name}`,
    ...(columnDefinitions.length
      ? [`Columns: ${columnDefinitions.join("; ")}`]
      : []),
  ];
  const definition = boundedExcerpt(definitionParts.join(" "), 5_000);
  const columnNames = columns.map((column) => column.name);
  const columnsUsed = boundedList(columnNames, 10_000, ", ");
  const modelGotchas = [
    ...[...model.tests].sort().map((test) => `model: ${test}`),
    ...columns.flatMap((column) =>
      [...column.tests].sort().map((test) => `${column.name}: ${test}`),
    ),
  ];
  const knownGotchas = boundedList(modelGotchas, 4_000, "; ");
  return [
    {
      id: entryId(root.id, "model", model.name),
      metric: capString(`model:${model.name}`, 200),
      definition,
      source: root.id,
      sourceKind: "dbt",
      entryType: "model",
      semanticScope: inferSemanticScope(
        `${model.name} ${model.description ?? ""}`,
      ),
      table: model.name,
      ...(columnsUsed ? { columnsUsed } : {}),
      ...(dependencies.length
        ? { dependencies: boundedList(dependencies, 4_000, "; ") }
        : {}),
      ...(joinPattern ? { joinPattern } : {}),
      ...(knownGotchas ? { knownGotchas } : {}),
      ...(model.sourcePath ? { sourcePath: model.sourcePath } : {}),
      ...(root.revision ? { sourceRevision: root.revision } : {}),
    },
  ];
}

async function readDbtRoot(root: RootContext): Promise<RootScanResult> {
  const files = await listFiles(root.absolutePath);
  const docs: ModelDoc[] = [];
  const semanticYamlItems: DbtYamlItem[] = [];
  const sqlModels: ModelDoc[] = [];
  const sqlTests: SourceIndexEntry[] = [];
  const fingerprint = createHash("sha256");
  const budget = { bytes: 0 };
  const scanSummary = emptyScanSummary();
  const dbtDocBlocks = new Map<string, string | null>();
  const docReferences = new Set<string>();
  const discoveryBudget = { bytes: 0 };
  for (const file of files) {
    const extension = path.extname(file.absolutePath).toLowerCase();
    if (extension !== ".yml" && extension !== ".yaml") continue;
    const yaml = await readSourceFile(file, discoveryBudget);
    for (const name of referencedDbtDocNames(yaml)) docReferences.add(name);
  }
  for (const file of files) {
    if (
      !docReferences.size ||
      path.extname(file.absolutePath).toLowerCase() !== ".md"
    ) {
      continue;
    }
    let fileStat;
    try {
      fileStat = await stat(file.absolutePath);
    } catch {
      codedError("file_unreadable", "A source file could not be read.");
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      accountSourceBytes(fileStat.size, discoveryBudget);
      if (await containsReferencedDbtDocBlock(file, docReferences)) {
        codedError(
          "file_limit_exceeded",
          "A referenced dbt documentation file exceeds the safe index size limit.",
        );
      }
      continue;
    }
    const markdown = await readSourceFile(file, discoveryBudget);
    const parsedBlocks = parseDbtDocBlocks(markdown);
    if (![...parsedBlocks.keys()].some((name) => docReferences.has(name))) {
      continue;
    }
    accountSourceBytes(fileStat.size, budget);
    hashFile(fingerprint, file, markdown);
    for (const [name, description] of parsedBlocks) {
      dbtDocBlocks.set(name, dbtDocBlocks.has(name) ? null : description);
    }
  }
  for (const file of files) {
    const extension = path.extname(file.absolutePath).toLowerCase();
    const relativePath = safeRelativePath(
      root.absolutePath,
      file.absolutePath,
      scanSummary,
    );
    if (extension === ".yml" || extension === ".yaml") {
      const docsRaw = await readSourceFile(file, budget);
      hashFile(fingerprint, file, docsRaw);
      const resolvedDocs = resolveDbtDocReferences(docsRaw, dbtDocBlocks);
      docs.push(...parseSchemaYaml(resolvedDocs, relativePath, scanSummary));
      docs.push(...parseEmbeddedSemanticYaml(resolvedDocs, relativePath));
      semanticYamlItems.push(
        ...parseSemanticYamlItems(resolvedDocs, relativePath, scanSummary),
      );
      continue;
    }
    if (extension !== ".sql") continue;
    const sql = await readSourceFile(file, budget);
    hashFile(fingerprint, file, sql);
    const dependencies = extractSqlDependencies(sql);
    if (isTestSql(file.relativePath)) {
      const name = safeIdentifier(path.basename(file.absolutePath, extension));
      if (name) {
        sqlTests.push({
          id: entryId(root.id, "test", name),
          metric: `test:${name}`,
          definition: boundedExcerpt(
            dependencies.length
              ? `dbt singular test referencing ${boundedList(dependencies, 4_000, ", ")}`
              : "dbt singular test.",
            5_000,
          ),
          source: root.id,
          semanticScope: inferSemanticScope(name),
          ...(dependencies.length
            ? {
                dependencies: boundedList(dependencies, 4_000, "; "),
              }
            : {}),
          ...(relativePath ? { sourcePath: relativePath } : {}),
          ...(root.revision ? { sourceRevision: root.revision } : {}),
        });
      } else {
        scanSummary.unsafeEntriesOmitted += 1;
      }
      continue;
    }
    if (!isIndexableModelSql(file.relativePath)) continue;
    const modelName = safeIdentifier(
      path.basename(file.absolutePath, extension),
    );
    if (!modelName) {
      scanSummary.unsafeEntriesOmitted += 1;
      continue;
    }
    const model: ModelDoc = {
      name: modelName,
      ...(relativePath ? { sourcePath: relativePath } : {}),
      columns: new Map(),
      tests: new Set(),
      dependencies: new Set(dependencies),
      grainHints: extractUniqueKey(sql),
    };
    sqlModels.push(model);
  }
  const mergedModels = mergeModels(root, docs, sqlModels);
  return {
    entries: [
      ...mergedModels.flatMap((model) => modelEntries(root, model)),
      ...semanticModelEntries(
        root,
        semanticYamlItems,
        mergedModels,
        scanSummary,
      ),
      ...sqlTests.sort((a, b) => a.id.localeCompare(b.id)),
    ],
    contentFingerprint: fingerprint.digest("hex"),
    scanSummary,
  };
}

function codeExtensions(filePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(filePath);
}

async function readCodeRoot(root: RootContext): Promise<RootScanResult> {
  const files = await listFiles(root.absolutePath);
  const events = new Map<string, CodeEvent>();
  const fingerprint = createHash("sha256");
  const budget = { bytes: 0 };
  const scanSummary = emptyScanSummary();
  for (const file of files) {
    if (!codeExtensions(file.absolutePath)) continue;
    const relativePath = safeRelativePath(
      root.absolutePath,
      file.absolutePath,
      scanSummary,
    );
    const source = await readSourceFile(file, budget);
    hashFile(fingerprint, file, source);
    for (const event of extractCodeEvents(source, relativePath, scanSummary)) {
      const current = events.get(event.name) ?? {
        name: event.name,
        properties: new Set<string>(),
        sourcePaths: new Set<string>(),
      };
      for (const property of event.properties) current.properties.add(property);
      for (const sourcePath of event.sourcePaths)
        current.sourcePaths.add(sourcePath);
      events.set(event.name, current);
    }
  }
  return {
    entries: [...events.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((event) => {
        const properties = [...event.properties].sort();
        const sourcePaths = [...event.sourcePaths].sort();
        return {
          id: entryId(root.id, "event", event.name),
          metric: `event:${event.name}`,
          definition: boundedExcerpt(
            properties.length
              ? `Tracked event with properties: ${boundedList(properties, 4_000, ", ")}`
              : "Tracked application event.",
            5_000,
          ),
          source: root.id,
          sourceKind: "code",
          entryType: "event",
          semanticScope: inferSemanticScope(event.name),
          ...(properties.length
            ? {
                columnsUsed: boundedList(properties, 10_000, ", "),
              }
            : {}),
          ...(sourcePaths[0] ? { sourcePath: sourcePaths[0] } : {}),
          ...(root.revision ? { sourceRevision: root.revision } : {}),
        } satisfies SourceIndexEntry;
      }),
    contentFingerprint: fingerprint.digest("hex"),
    scanSummary,
  };
}

function entryCount(bundle: SourceIndexBundle): void {
  if (bundle.entries.length > MAX_ENTRIES) {
    codedError(
      "entry_limit_exceeded",
      "The source index exceeds the maximum entry count.",
    );
  }
  if (bundle.sources.length > MAX_SOURCES) {
    codedError(
      "source_limit_exceeded",
      "The source index exceeds the maximum source count.",
    );
  }
  if (bundle.entries.length === 0) {
    codedError(
      "no_entries",
      "No dbt models, singular tests, or static tracking events were found.",
    );
  }
  const ids = new Set<string>();
  for (const entry of bundle.entries) {
    if (ids.has(entry.id)) {
      codedError(
        "duplicate_entry_id",
        "Two source index entries resolve to the same id.",
      );
    }
    ids.add(entry.id);
  }
  const byteLength = new TextEncoder().encode(
    JSON.stringify(bundle),
  ).byteLength;
  if (byteLength > MAX_BUNDLE_BYTES) {
    codedError(
      "bundle_size_limit_exceeded",
      "The source index exceeds the 750 KB size limit.",
    );
  }
}

export function parseSourceIndexArgs(argv: string[]): SourceIndexCliOptions {
  const dbtRoots: string[] = [];
  const codeRoots: string[] = [];
  let out: string | undefined;
  let sigmaReviewedManifest: string | undefined;
  let sigmaEnvFile: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      codedError(
        "help",
        "Usage: build-source-index --dbt-root <path> [--dbt-root <path>] [--code-root <path>] [--sigma-reviewed-manifest <path> --sigma-env-file <ai-services/.env>] [--out <path>]",
      );
    }
    const [flag, inlineValue] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, undefined];
    if (
      ![
        "--dbt-root",
        "--code-root",
        "--sigma-reviewed-manifest",
        "--sigma-env-file",
        "--out",
      ].includes(flag)
    ) {
      codedError(
        "unknown_argument",
        "An unknown command-line option was supplied.",
      );
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      codedError(
        "missing_argument_value",
        "A command-line option is missing its value.",
      );
    }
    if (flag === "--dbt-root") dbtRoots.push(value);
    else if (flag === "--code-root") codeRoots.push(value);
    else if (flag === "--sigma-reviewed-manifest") {
      if (sigmaReviewedManifest) {
        codedError(
          "duplicate_sigma_manifest",
          "Specify the Sigma review manifest only once.",
        );
      }
      sigmaReviewedManifest = value;
    } else if (flag === "--sigma-env-file") {
      if (sigmaEnvFile) {
        codedError(
          "duplicate_sigma_env_file",
          "Specify --sigma-env-file only once.",
        );
      }
      sigmaEnvFile = value;
    } else {
      if (out) codedError("duplicate_output", "Specify --out only once.");
      out = value;
    }
  }
  if (!dbtRoots.length)
    codedError("missing_dbt_root", "At least one --dbt-root is required.");
  if (!out) codedError("missing_output", "--out is required.");
  if (sigmaEnvFile && !sigmaReviewedManifest) {
    codedError(
      "sigma_env_without_manifest",
      "--sigma-env-file requires --sigma-reviewed-manifest.",
    );
  }
  return {
    dbtRoots,
    codeRoots,
    ...(sigmaReviewedManifest ? { sigmaReviewedManifest } : {}),
    ...(sigmaEnvFile ? { sigmaEnvFile } : {}),
    out,
  };
}

export async function compileSourceIndex(
  options: SourceIndexOptions,
): Promise<SourceIndexBundle> {
  if (!options.dbtRoots.length) {
    codedError("missing_dbt_root", "At least one dbt root is required.");
  }
  if (
    options.generatedAt !== undefined &&
    (!Number.isFinite(Date.parse(options.generatedAt)) ||
      !options.generatedAt.includes("T"))
  ) {
    codedError(
      "invalid_generated_at",
      "generatedAt must be an ISO 8601 timestamp.",
    );
  }
  const dbtRoots = options.dbtRoots.map((root, index) =>
    sourceContext(root, `dbt-${index + 1}`),
  );
  const roots = [
    ...dbtRoots.map((context) => ({ kind: "dbt" as const, context })),
    ...(options.codeRoots ?? []).map((root, index) => ({
      kind: "code" as const,
      context: sourceContext(root, `code-${index + 1}`),
    })),
  ];
  if (roots.length + (options.sigmaReviewedManifest ? 1 : 0) > MAX_SOURCES) {
    codedError(
      "source_limit_exceeded",
      "The source index supports at most 10 roots.",
    );
  }
  const seenIds = new Set<string>();
  for (const { context } of roots) {
    if (seenIds.has(context.id)) {
      codedError(
        "duplicate_source_id",
        "Two supplied roots resolve to the same source id.",
      );
    }
    seenIds.add(context.id);
  }
  const sources: SourceIndexSource[] = [];
  const entries: SourceIndexEntry[] = [];
  const scanSummary = emptyScanSummary();
  for (const { kind, context } of roots) {
    const scan =
      kind === "dbt" ? await readDbtRoot(context) : await readCodeRoot(context);
    sources.push({
      id: context.id,
      ...(context.revision ? { revision: context.revision } : {}),
      contentFingerprint: scan.contentFingerprint,
    });
    entries.push(
      ...scan.entries.map((entry) => ({ ...entry, sourceKind: kind })),
    );
    addScanSummary(scanSummary, scan.scanSummary);
  }
  if (options.sigmaReviewedManifest) {
    if (seenIds.has("sigma")) {
      codedError(
        "duplicate_source_id",
        "A supplied source root already uses the Sigma source id.",
      );
    }
    const credentials = await readSigmaCredentialsFromEnvFile(
      options.sigmaEnvFile,
    );
    const sigma = await buildSigmaSourceIndex({
      manifestPath: options.sigmaReviewedManifest,
      ...credentials,
    });
    sources.push(sigma.source);
    entries.push(
      ...sigma.entries.map((entry) => ({
        ...entry,
        sourceKind: "sigma" as const,
      })),
    );
    scanSummary.unsafeFieldsOmitted += sigma.scanSummary.unsafeFieldsOmitted;
    scanSummary.truncatedFields += sigma.scanSummary.truncatedFields;
    scanSummary.unsafeEntriesOmitted += sigma.scanSummary.unsafeEntriesOmitted;
  }
  const generatedAt =
    options.generatedAt ?? generatedAtFromDbtCommits(dbtRoots);
  if (!generatedAt) {
    codedError(
      "dbt_commit_metadata_required",
      "Each dbt root must have Git commit metadata so generatedAt is reproducible.",
    );
  }
  const indexedEntries = entries
    .map((entry) => ({ ...entry, status: entry.status ?? "active" }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const bundle: SourceIndexBundle = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sources,
    entries: indexedEntries,
    scanSummary,
  };
  const validated = sourceIndexBundleSchema.safeParse(bundle);
  if (!validated.success) {
    codedError(
      "invalid_generated_bundle",
      "Generated source metadata failed validation; no index file was written.",
    );
  }
  entryCount(bundle);
  return bundle;
}

export async function writeSourceIndex(
  options: SourceIndexCliOptions,
): Promise<SourceIndexBundle> {
  const bundle = await compileSourceIndex(options);
  const outputPath = path.resolve(options.out);
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, outputPath);
  } catch {
    await unlink(temporaryPath).catch(() => {});
    codedError(
      "output_write_failed",
      "The source index output could not be replaced.",
    );
  }
  return bundle;
}

async function runCli(): Promise<void> {
  try {
    const options = parseSourceIndexArgs(process.argv.slice(2));
    const bundle = await writeSourceIndex(options);
    process.stdout.write(
      `${JSON.stringify({ ok: true, schemaVersion: bundle.schemaVersion, sources: bundle.sources.length, entries: bundle.entries.length, scanSummary: bundle.scanSummary })}\n`,
    );
  } catch (error) {
    const known = error instanceof SourceIndexError ? error : null;
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: known?.code ?? "source_index_failed",
          message: known?.message ?? "The source index could not be built.",
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  void runCli();
}
