import type { DesignSystemSourceInput } from "@builder.io/ai-utils";

import { withBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
import { FeatureNotConfiguredError } from "./credential-provider.js";
import {
  getBuilderProxyOrigin,
  resolveSecret,
  resolveBuilderCredentials,
} from "./credential-provider.js";
import {
  canonicalGitHubRepoUrl,
  fetchGitHubJsonResult,
  fetchGitHubRaw,
  parseGitHubRepoReference,
  type GitHubRepoReference,
} from "./design-token-utils.js";

const DEFAULT_TIMEOUT_MS = 120_000;

// GCS resumable uploads require every chunk except the last to be a multiple
// of 256 KiB. 16 MiB is the recommended default and keeps very large `.fig`
// files off a single unbounded request body.
const GCS_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 5;

export interface BuilderDesignSystemIndexFile {
  name: string;
  data: Uint8Array;
  mimeType?: string;
}

export interface BuilderDesignSystemCodeFileInput {
  filename: string;
  content: string;
  mimeType?: string;
  /**
   * How `content` is encoded. Defaults to `"utf8"` (existing behavior,
   * unchanged for every current text-file caller). Pass `"base64"` for
   * binary files -- most importantly `.fig` (a zip/kiwi binary container,
   * never valid UTF-8 text). Without this, a `.fig` upload silently
   * corrupts: `mimeTypeForBuilderDesignSystemFilename` already special-cases
   * `.fig` as `application/octet-stream`, but the actual byte pipeline ran
   * every file through `TextEncoder().encode()` regardless, which mangles
   * any byte >= 0x80 in a binary-as-string payload (or, if the caller
   * base64-encoded first with no decode step here, stores the literal
   * base64 text instead of the decoded binary). Callers sending `.fig`/PDF/
   * other binary bytes must base64-encode `content` and set this to
   * `"base64"`.
   */
  encoding?: "utf8" | "base64";
}

export interface BuildBuilderDesignSystemIndexFilesOptions {
  codeFiles?: BuilderDesignSystemCodeFileInput[];
  designMd?: string;
  designMdFilename?: string;
  maxCodeFiles?: number;
  maxTotalCodeBytes?: number;
  /** Default keeps legacy best-effort code indexing; upload/chat surfaces should fail loudly. */
  overflowBehavior?: "skip" | "throw";
}

export interface BuilderDesignSystemProxyFieldsOptions {
  result: BuilderDesignSystemIndexResult;
  projectName?: string;
  description?: string;
  surface: "design" | "slides";
  sourceKind?: BuilderDesignSystemSourceKind;
  githubSources?: BuilderDesignSystemGitHubSource[];
  syncedAt?: string;
}

export type BuilderDesignSystemSourceKind =
  | "figma"
  | "code"
  | "github"
  | "mixed";

export interface BuilderDesignSystemProxyFields {
  title: string;
  description: string;
  data: string;
  customInstructions: string;
}

export interface BuilderDesignSystemProxyReference {
  source: "builder";
  sourceKind?: BuilderDesignSystemSourceKind;
  builderDesignSystemId: string;
  builderJobId: string;
  builderProjectId?: string;
  builderUrl?: string;
  builderStatus?: string;
  githubSources?: BuilderDesignSystemGitHubSource[];
  syncedAt?: string;
}

export interface BuilderDesignSystemDocsOptions {
  page?: number;
  pageSize?: number;
  minimal?: boolean;
  type?: string;
}

export interface BuilderDesignSystemDocument {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  content?: string;
  tokenValues?: Record<string, string>;
  rawTokens?: string[];
  relevantFiles?: string[];
  relatedComponents?: string[];
}

export interface BuilderDesignSystemHydratedReference extends BuilderDesignSystemProxyReference {
  docs: BuilderDesignSystemDocument[];
  tokenValues: Record<string, string>;
  docCount: number;
}

export interface BuilderDesignSystemIndexOptions {
  projectName?: string;
  description?: string;
  githubRepoUrl?: string;
  githubRepos?: BuilderDesignSystemGitHubSource[];
  connectedProjectId?: string;
  files?: BuilderDesignSystemIndexFile[];
  selection?: Record<string, string[]>;
  devToolsVersion?: string;
}

/** A durable, replayable GitHub source configuration for a Builder DSI kit. */
export interface BuilderDesignSystemGitHubSource {
  repoUrl: string;
  ref?: string;
  include?: string[];
  exclude?: string[];
  instructions?: string;
}

export interface BuilderDesignSystemIndexResult {
  ok: true;
  source: "builder";
  projectId: string;
  jobId: string;
  designSystemId: string;
  suggestedTitle: string | null;
  builderUrl: string;
  status: "in-progress";
}

interface BuilderDesignSystemCredentials {
  privateKey: string;
  publicKey: string;
  userId: string | null;
}

interface UploadStartResponse {
  uploads?: Array<{ idx: number; uploadUrl: string; uploadToken: string }>;
}

interface IndexResponse {
  designSystemId?: string;
  jobId?: string;
  projectId?: string;
  branchUrl?: string;
  branchName?: string;
}

export interface BuilderDesignSystemUploadAttachment {
  name: string;
  mimetype: string;
  declaredSize: number;
}

export interface BuilderDesignSystemUploadSlot {
  idx: number;
  uploadUrl: string;
  uploadToken: string;
}

export interface BuilderDesignSystemIndexFromSourcesOptions {
  sources: DesignSystemSourceInput[];
  projectName?: string;
  devToolsVersion?: string;
}

export interface BuilderDesignSystemDecodeJobStatus {
  jobId: string;
  status: "pending" | "processing" | "complete" | "error";
  framesProcessed: number;
  totalFrames: number;
  branchName: string | null;
  branchUrl: string | null;
  error: string | null;
  partialFailure?: boolean;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_MAX_CODE_FILES = 50;
const DEFAULT_MAX_TOTAL_CODE_BYTES = 2 * 1024 * 1024;
const MAX_DOC_CONTENT_CHARS = 4_000;
const MAX_GITHUB_FILES = 50;
const MAX_GITHUB_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_FILE_BYTES = 512 * 1024;
const MAX_GITHUB_DIRECTORIES = 250;
const SKIPPED_GITHUB_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

export interface BuilderDesignSystemGitHubFile {
  path: string;
  content: string;
}

export interface BuilderDesignSystemGitHubFileCollection {
  source: BuilderDesignSystemGitHubSource;
  owner: string;
  repo: string;
  ref?: string;
  files: BuilderDesignSystemGitHubFile[];
  totalBytes: number;
  truncated: boolean;
}

function normalizeGitHubPath(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "GitHub file and folder scopes cannot contain . or .. segments.",
    );
  }
  return normalized;
}

function pathMatchesScope(path: string, scope: string): boolean {
  const normalizedPath = normalizeGitHubPath(path);
  const normalizedScope = normalizeGitHubPath(scope);
  return (
    normalizedPath === normalizedScope ||
    normalizedPath.startsWith(`${normalizedScope}/`)
  );
}

function pathIsExcluded(path: string, excludes: string[]): boolean {
  return excludes.some((scope) => pathMatchesScope(path, scope));
}

function isIndexableGitHubFile(path: string): boolean {
  const name = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
  return (
    name === "package.json" ||
    /\.(css|scss|sass|less|ts|tsx|js|jsx|json|html|svg|xml|md|markdown|mdx|txt)$/.test(
      name,
    ) ||
    /(?:tailwind|postcss|theme|tokens|design)\.config\.[^/]+$/.test(name)
  );
}

function isSkippedGitHubDirectory(path: string): boolean {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  return SKIPPED_GITHUB_DIRECTORIES.has(name);
}

function githubSourceAccessError(
  owner: string,
  repo: string,
  status: number,
  hasToken: boolean,
  message?: string,
): Error {
  const suffix = message ? ` GitHub said: ${message}` : "";
  if (!hasToken && (status === 401 || status === 403 || status === 404)) {
    return new Error(
      `Could not access ${owner}/${repo}. Public repositories work without setup; private repositories require a fine-grained GitHub personal access token saved as GITHUB_TOKEN in Settings > Secrets with Repository permissions > Contents: Read-only.${suffix}`,
    );
  }
  if (hasToken && (status === 401 || status === 403 || status === 404)) {
    return new Error(
      `Could not access ${owner}/${repo} with the saved GITHUB_TOKEN. Check that the token is valid, the repository is selected, organization SSO/approval is complete, and Contents is Read-only.${suffix}`,
    );
  }
  if (status === 429) {
    return new Error(
      `GitHub rate-limited requests for ${owner}/${repo}. Save a GITHUB_TOKEN in Settings > Secrets or try again after the rate limit resets.${suffix}`,
    );
  }
  return new Error(
    `Could not read ${owner}/${repo} from GitHub (status ${status || "unknown"}).${suffix}`,
  );
}

function normalizedGitHubSource(source: BuilderDesignSystemGitHubSource): {
  source: BuilderDesignSystemGitHubSource;
  reference: GitHubRepoReference;
} {
  const reference = parseGitHubRepoReference(source.repoUrl);
  const ref = source.ref?.trim() || reference.ref;
  const impliedPath = reference.subpath ? [reference.subpath] : [];
  const include = [
    ...impliedPath,
    ...(source.include ?? []).map(normalizeGitHubPath).filter(Boolean),
  ];
  const uniqueInclude = [...new Set(include)];
  const exclude = [
    ...(source.exclude ?? []).map(normalizeGitHubPath).filter(Boolean),
  ];
  const normalized: BuilderDesignSystemGitHubSource = {
    repoUrl: canonicalGitHubRepoUrl(source.repoUrl),
    ...(ref ? { ref } : {}),
    ...(uniqueInclude.length > 0 ? { include: uniqueInclude } : {}),
    ...(exclude.length > 0 ? { exclude: [...new Set(exclude)] } : {}),
    ...(source.instructions?.trim()
      ? { instructions: source.instructions.trim() }
      : {}),
  };
  return { source: normalized, reference: { ...reference, ref } };
}

/**
 * Resolve an explicitly scoped/ref'd GitHub source into bounded file uploads.
 * Native Builder public-repo sources are preferred for unscoped public repos;
 * this path exists so branch, folder, and private-repo imports are replayable.
 */
export async function collectBuilderDesignSystemGitHubFiles(
  input: BuilderDesignSystemGitHubSource,
): Promise<BuilderDesignSystemGitHubFileCollection> {
  const { source, reference } = normalizedGitHubSource(input);
  const githubToken = await resolveSecret("GITHUB_TOKEN");
  const include = source.include ?? [];
  const explicitScope = include.length > 0 || Boolean(source.ref);
  const queue = [...(include.length > 0 ? include : [""])];
  const visited = new Set<string>();
  const files: BuilderDesignSystemGitHubFile[] = [];
  let totalBytes = 0;
  let directoriesVisited = 0;
  let truncated = false;

  while (queue.length > 0) {
    const path = normalizeGitHubPath(queue.shift() ?? "");
    if (visited.has(path) || pathIsExcluded(path, source.exclude ?? [])) {
      continue;
    }
    visited.add(path);
    directoriesVisited++;
    if (directoriesVisited > MAX_GITHUB_DIRECTORIES) {
      truncated = true;
      break;
    }

    const result = await fetchGitHubJsonResult<
      | Array<{ name?: string; path?: string; type?: string; size?: number }>
      | {
          name?: string;
          path?: string;
          type?: string;
          size?: number;
        }
    >(reference.owner, reference.repo, path, {
      token: githubToken,
      ref: reference.ref,
    });
    if (!result.ok) {
      throw githubSourceAccessError(
        reference.owner,
        reference.repo,
        result.status,
        Boolean(githubToken),
        result.message,
      );
    }

    const entries = Array.isArray(result.data)
      ? result.data
      : result.data
        ? [result.data]
        : [];
    for (const entry of entries) {
      const entryPath = normalizeGitHubPath(entry?.path ?? entry?.name ?? "");
      if (!entryPath || pathIsExcluded(entryPath, source.exclude ?? [])) {
        continue;
      }
      if (entry.type === "dir") {
        if (isSkippedGitHubDirectory(entryPath)) continue;
        queue.push(entryPath);
        continue;
      }
      if (entry.type !== "file") continue;
      if (
        include.length > 0 &&
        !include.some((scope) => pathMatchesScope(entryPath, scope))
      ) {
        continue;
      }
      if (!explicitScope && !isIndexableGitHubFile(entryPath)) continue;
      if (files.length >= MAX_GITHUB_FILES) {
        truncated = true;
        break;
      }
      if ((entry.size ?? 0) > MAX_GITHUB_FILE_BYTES) continue;
      const content = await fetchGitHubRaw(
        reference.owner,
        reference.repo,
        entryPath,
        { token: githubToken, ref: reference.ref },
      );
      if (content === null) {
        throw new Error(
          `Could not read ${entryPath} from ${reference.owner}/${reference.repo}${source.ref ? ` at ref ${source.ref}` : ""}. Check the repository Contents permission and file size.`,
        );
      }
      const bytes = new TextEncoder().encode(content).byteLength;
      if (totalBytes + bytes > MAX_GITHUB_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      files.push({ path: entryPath, content });
      totalBytes += bytes;
    }
    if (truncated) break;
  }

  if (files.length === 0) {
    throw new Error(
      `No readable design-system files were found in ${reference.owner}/${reference.repo}${source.ref ? ` at ref ${source.ref}` : ""}. Select a folder or file that contains code, styles, tokens, or design.md.`,
    );
  }
  if (truncated) {
    throw new Error(
      `The selected GitHub source ${reference.owner}/${reference.repo} is larger than the safe inline indexing limit. Select a narrower folder or file set and try again.`,
    );
  }

  return {
    source,
    owner: reference.owner,
    repo: reference.repo,
    ...(reference.ref ? { ref: reference.ref } : {}),
    files,
    totalBytes,
    truncated,
  };
}

async function isPublicGitHubSource(
  reference: GitHubRepoReference,
): Promise<{ ok: true } | { ok: false; status: number; message?: string }> {
  const result = await fetchGitHubJsonResult(
    reference.owner,
    reference.repo,
    "",
    {
      ref: reference.ref,
    },
  );
  return result.ok
    ? { ok: true }
    : { ok: false, status: result.status, message: result.message };
}

export async function fetchBuilderDesignSystemDecodeJobStatus(
  jobId: string,
): Promise<BuilderDesignSystemDecodeJobStatus> {
  const credentials = await resolveBuilderDesignSystemCredentials();
  const url = makeBuilderDesignSystemUrl(
    "decode-jobs/" + encodeURIComponent(jobId),
    credentials,
  );
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: makeBuilderHeaders(credentials),
  });
  await assertOk(response, "Builder design-system decode-job status failed");
  return (await response.json()) as BuilderDesignSystemDecodeJobStatus;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getBuilderDesignSystemsBaseUrl(): string {
  return (
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL ||
    `${trimTrailingSlash(getBuilderProxyOrigin())}/design-systems/v1`
  );
}

function getBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    "https://builder.io"
  );
}

function makeBuilderDesignSystemUrl(
  path: string,
  credentials: BuilderDesignSystemCredentials,
): URL {
  const base = `${trimTrailingSlash(getBuilderDesignSystemsBaseUrl())}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);
  url.searchParams.set("apiKey", credentials.publicKey);
  if (credentials.userId) url.searchParams.set("userId", credentials.userId);
  return url;
}

function makeBuilderHeaders(
  credentials: BuilderDesignSystemCredentials,
): Record<string, string> {
  return {
    Authorization: `Bearer ${credentials.privateKey}`,
    "x-builder-api-key": credentials.publicKey,
    ...(credentials.userId ? { "x-builder-user-id": credentials.userId } : {}),
  };
}

export function mimeTypeForBuilderDesignSystemFilename(
  filename: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  const lower = filename.toLowerCase();
  if (lower.endsWith(".fig")) return "application/octet-stream";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown"))
    return "text/markdown";
  if (lower.endsWith(".mdx")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "text/plain";
}

export function buildBuilderDesignSystemIndexFiles({
  codeFiles,
  designMd,
  designMdFilename,
  maxCodeFiles = DEFAULT_MAX_CODE_FILES,
  maxTotalCodeBytes = DEFAULT_MAX_TOTAL_CODE_BYTES,
  overflowBehavior = "skip",
}: BuildBuilderDesignSystemIndexFilesOptions): BuilderDesignSystemIndexFile[] {
  const encoder = new TextEncoder();
  const files: BuilderDesignSystemIndexFile[] = [];
  let totalBytes = 0;

  function pushFile(
    filename: string,
    content: string,
    mimeType?: string,
    encoding?: "utf8" | "base64",
  ) {
    const normalizedName = filename.replace(/^\/+/, "") || "code.txt";
    // `.fig`/PDF/other binary payloads must round-trip through base64, not
    // UTF-8 -- TextEncoder().encode() on a binary-as-string payload mangles
    // any byte >= 0x80. See BuilderDesignSystemCodeFileInput.encoding.
    const data =
      encoding === "base64"
        ? new Uint8Array(Buffer.from(content, "base64"))
        : encoder.encode(content);
    if (data.byteLength === 0) return;
    if (totalBytes + data.byteLength > maxTotalCodeBytes) {
      if (overflowBehavior === "throw") {
        throw new Error(
          `Design-system file "${normalizedName}" exceeds the ${Math.round(maxTotalCodeBytes / 1024 / 1024)} MB inline upload budget. Use the dedicated file upload instead of sending large binary files through an action payload.`,
        );
      }
      return;
    }
    totalBytes += data.byteLength;
    files.push({
      name: normalizedName,
      data,
      mimeType: mimeTypeForBuilderDesignSystemFilename(
        normalizedName,
        mimeType,
      ),
    });
  }

  if (designMd?.trim()) {
    pushFile(
      designMdFilename?.trim() || "design.md",
      designMd,
      "text/markdown",
    );
  }

  if (overflowBehavior === "throw" && (codeFiles?.length ?? 0) > maxCodeFiles) {
    throw new Error(
      `Too many design-system files (max ${maxCodeFiles}); no files were indexed.`,
    );
  }
  for (const file of (codeFiles ?? []).slice(0, maxCodeFiles)) {
    pushFile(file.filename, file.content, file.mimeType, file.encoding);
  }

  return files;
}

async function resolveBuilderDesignSystemCredentials(): Promise<BuilderDesignSystemCredentials> {
  const credentials = await resolveBuilderCredentials();
  if (!credentials.privateKey || !credentials.publicKey) {
    throw new FeatureNotConfiguredError({
      requiredCredential: "BUILDER_PRIVATE_KEY",
      message:
        "Connect Builder.io (free tier available) before indexing a design system from Figma or code.",
      builderConnectUrl: "/_agent-native/builder/connect",
    });
  }
  return {
    privateKey: credentials.privateKey,
    publicKey: credentials.publicKey,
    userId: credentials.userId ?? null,
  };
}

function mimeTypeForFile(file: BuilderDesignSystemIndexFile): string {
  return mimeTypeForBuilderDesignSystemFilename(file.name, file.mimeType);
}

function makeBody(bytes: Uint8Array, mimeType: string): BodyInit {
  return typeof Blob !== "undefined"
    ? new Blob([bytes as unknown as BlobPart], { type: mimeType })
    : (bytes as unknown as BodyInit);
}

async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || `HTTP ${response.status}`;
  try {
    const json = JSON.parse(text) as { error?: unknown };
    if (typeof json.error === "string") return json.error;
    if (json.error && typeof json.error === "object") {
      return JSON.stringify(json.error).slice(0, 500);
    }
  } catch {}
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  throw new Error(
    `${label} (${response.status}): ${await parseErrorBody(response)}`,
  );
}

// GCS reports the highest committed byte in a `Range: bytes=0-<end>` header.
function committedOffsetFromRange(response: Response): number | null {
  const match = response.headers.get("Range")?.match(/bytes=0-(\d+)/);
  return match ? parseInt(match[1], 10) + 1 : null;
}

async function queryCommittedOffset(
  sessionUrl: string,
  total: number,
): Promise<number> {
  const response = await fetchWithTimeout(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
  });
  if (response.status === 200 || response.status === 201) return total;
  if (response.status === 308) {
    return committedOffsetFromRange(response) ?? 0;
  }
  throw new Error(
    `Builder design-system upload status query failed (${response.status}).`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadToResumableUrl(
  slot: { uploadUrl: string },
  file: BuilderDesignSystemIndexFile,
): Promise<void> {
  const mimeType = mimeTypeForFile(file);
  const bytes = file.data;
  const total = bytes.byteLength;
  const start = await fetchWithTimeout(slot.uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-resumable": "start",
      "x-goog-content-length-range": `0,${total}`,
      "Content-Type": mimeType,
    },
  });
  await assertOk(start, "Builder design-system upload session failed");
  const sessionUrl = start.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("Builder design-system upload session returned no URL.");
  }

  if (total === 0) {
    const response = await fetchWithTimeout(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": "bytes */0" },
      body: makeBody(bytes, mimeType),
    });
    await assertOk(response, "Builder design-system file upload failed");
    return;
  }

  // A failed PUT may have still landed at GCS, so the local offset can't be
  // trusted after an error — only GCS's committed-offset response is
  // authoritative.
  let offset = 0;
  let retries = 0;
  while (offset < total) {
    const end = Math.min(offset + GCS_CHUNK_SIZE, total);
    const isLast = end === total;
    try {
      const response = await fetchWithTimeout(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
          "Content-Type": mimeType,
        },
        body: makeBody(bytes.subarray(offset, end), mimeType),
      });
      if (response.status === 200 || response.status === 201) {
        offset = total;
      } else if (!isLast && response.status === 308) {
        const nextOffset = committedOffsetFromRange(response) ?? offset;
        if (nextOffset <= offset) {
          throw new Error(
            `Builder design-system upload stalled at byte ${offset}.`,
          );
        }
        offset = nextOffset;
      } else {
        throw new Error(
          `Builder design-system file upload failed (${response.status}).`,
        );
      }
      retries = 0;
    } catch (err) {
      if (++retries > MAX_CHUNK_RETRIES) throw err;
      await delay(500 * retries);
      try {
        offset = await queryCommittedOffset(sessionUrl, total);
      } catch {
        // If the offset query also fails, retry from the last local offset —
        // GCS's resumable PUT safely re-acknowledges bytes it already has.
      }
    }
  }
}

function nonEmptyFiles(
  files: BuilderDesignSystemIndexFile[] | undefined,
): BuilderDesignSystemIndexFile[] {
  return (files ?? []).filter((file) => file.data.byteLength > 0);
}

export function builderDesignSystemUrl(designSystemId?: string | null): string {
  const host = trimTrailingSlash(getBuilderAppHost());
  const url = designSystemId
    ? `${host}/app/design-system-intelligence/${encodeURIComponent(
        designSystemId,
      )}`
    : `${host}/app/design-system-intelligence`;
  return withBuilderUtmTrackingParams(url, {
    campaign: "product",
    content: "design_system_intelligence",
  });
}

export function builderProjectBranchUrl(
  projectId?: string | null,
  branchName?: string | null,
): string | undefined {
  const project = projectId?.trim();
  const branch = branchName?.trim();
  if (!project || !branch) return undefined;
  const host = trimTrailingSlash(getBuilderAppHost());
  const path =
    "/app/projects/" +
    encodeURIComponent(project) +
    "/" +
    encodeURIComponent(branch);
  return withBuilderUtmTrackingParams(host + path, {
    campaign: "product",
    content: "design_system_intelligence",
  });
}

export function localBuilderDesignSystemId(
  builderDesignSystemId: string,
): string {
  const slug = builderDesignSystemId
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `builder-${slug || "design-system"}`;
}

export function createBuilderDesignSystemProxyFields({
  result,
  projectName,
  description,
  surface,
  sourceKind,
  githubSources,
  syncedAt,
}: BuilderDesignSystemProxyFieldsOptions): BuilderDesignSystemProxyFields {
  const title = projectName?.trim() || "Builder indexed design system";
  const normalizedGithubSources = githubSources?.map(
    (source) => normalizedGitHubSource(source).source,
  );
  const fallbackDescription =
    description ?? `Builder indexed design system ${result.designSystemId}`;
  const surfaceNoun = surface === "slides" ? "slides" : "designs";
  const spacingKey = surface === "slides" ? "slidePadding" : "pagePadding";
  const data = JSON.stringify({
    source: "builder",
    ...(sourceKind ? { sourceKind } : {}),
    ...(normalizedGithubSources?.length
      ? { githubSources: normalizedGithubSources }
      : {}),
    ...(syncedAt ? { syncedAt } : {}),
    builderDesignSystemId: result.designSystemId,
    builderJobId: result.jobId,
    builderProjectId: result.projectId,
    builderUrl: result.builderUrl,
    builderStatus: result.status,
    colors: {
      primary: "var(--primary)",
      secondary: "var(--secondary)",
      accent: "var(--accent)",
      background: "var(--background)",
      surface: "var(--card)",
      text: "var(--foreground)",
      textMuted: "var(--muted-foreground)",
    },
    typography: {
      headingFont: "inherit",
      bodyFont: "inherit",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "48px", h2: "32px", h3: "24px" },
    },
    spacing: { elementGap: "24px", [spacingKey]: "48px" },
    borders: { radius: "12px", accentWidth: "1px" },
    logos: [],
    notes: [
      "This is a local selectable proxy for a Builder DSI-indexed design system.",
      `Builder design system id: ${result.designSystemId}`,
      `Builder indexing job id: ${result.jobId}`,
      `Builder project id: ${result.projectId}`,
      `Builder URL: ${result.builderUrl}`,
      projectName ? `Requested name: ${projectName}` : "",
      description ? `Context: ${description}` : "",
      "Builder Design System Intelligence is the source of truth for indexed tokens, components, assets, and usage guidance.",
      normalizedGithubSources?.length
        ? "GitHub source scope is persisted so this design system can be synced without reconfiguring it."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const customInstructions = [
    "This design system is indexed by Builder Design System Intelligence (DSI).",
    `Builder design system id: ${result.designSystemId}`,
    `Builder job id: ${result.jobId}`,
    `Builder project id: ${result.projectId}`,
    `Builder URL: ${result.builderUrl}`,
    `When generating ${surfaceNoun}, treat Builder DSI as the source of truth for indexed tokens, components, assets, and usage guidance.`,
    "Call get-design-system for this local id before generation and use the returned builder docs and token values when available.",
    normalizedGithubSources?.length
      ? "Use sync-design-system-with-builder to refresh the persisted GitHub source scope before generating when the repository changed."
      : "",
  ].join("\n");

  return {
    title,
    description: fallbackDescription,
    data,
    customInstructions,
  };
}

export function parseBuilderDesignSystemProxyReference(
  data: unknown,
): BuilderDesignSystemProxyReference | null {
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.source !== "builder") return null;
  if (typeof value.builderDesignSystemId !== "string") return null;
  if (typeof value.builderJobId !== "string") return null;
  const sourceKind = value.sourceKind;
  if (
    sourceKind !== undefined &&
    sourceKind !== "figma" &&
    sourceKind !== "code" &&
    sourceKind !== "github" &&
    sourceKind !== "mixed"
  ) {
    return null;
  }
  let invalidGithubSource = false;
  const githubSources = Array.isArray(value.githubSources)
    ? value.githubSources.flatMap(
        (source): BuilderDesignSystemGitHubSource[] => {
          if (!source || typeof source !== "object") {
            invalidGithubSource = true;
            return [];
          }
          const candidate = source as Record<string, unknown>;
          if (typeof candidate.repoUrl !== "string") {
            invalidGithubSource = true;
            return [];
          }
          try {
            const normalized = normalizedGitHubSource({
              repoUrl: candidate.repoUrl,
              ...(typeof candidate.ref === "string"
                ? { ref: candidate.ref }
                : {}),
              ...(Array.isArray(candidate.include)
                ? {
                    include: candidate.include.filter(
                      (path): path is string => typeof path === "string",
                    ),
                  }
                : {}),
              ...(Array.isArray(candidate.exclude)
                ? {
                    exclude: candidate.exclude.filter(
                      (path): path is string => typeof path === "string",
                    ),
                  }
                : {}),
              ...(typeof candidate.instructions === "string"
                ? { instructions: candidate.instructions }
                : {}),
            });
            return [normalized.source];
          } catch {
            invalidGithubSource = true;
            return [];
          }
        },
      )
    : undefined;
  if (invalidGithubSource) return null;
  return {
    source: "builder",
    ...(sourceKind ? { sourceKind } : {}),
    builderDesignSystemId: value.builderDesignSystemId,
    builderJobId: value.builderJobId,
    builderProjectId:
      typeof value.builderProjectId === "string"
        ? value.builderProjectId
        : undefined,
    builderUrl:
      typeof value.builderUrl === "string" ? value.builderUrl : undefined,
    builderStatus:
      typeof value.builderStatus === "string" ? value.builderStatus : undefined,
    ...(githubSources?.length ? { githubSources } : {}),
    ...(typeof value.syncedAt === "string" ? { syncedAt: value.syncedAt } : {}),
  };
}

function truncateDocContent(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  if (content.length <= MAX_DOC_CONTENT_CHARS) return content;
  return `${content.slice(0, MAX_DOC_CONTENT_CHARS)}\n\n[truncated]`;
}

function normalizeBuilderDesignSystemDocument(
  value: unknown,
): BuilderDesignSystemDocument {
  const doc =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    id: typeof doc.id === "string" ? doc.id : undefined,
    name: typeof doc.name === "string" ? doc.name : undefined,
    type: typeof doc.type === "string" ? doc.type : undefined,
    description:
      typeof doc.description === "string" ? doc.description : undefined,
    content: truncateDocContent(doc.content),
    tokenValues:
      doc.tokenValues && typeof doc.tokenValues === "object"
        ? (doc.tokenValues as Record<string, string>)
        : undefined,
    rawTokens: Array.isArray(doc.rawTokens)
      ? doc.rawTokens.filter(
          (token): token is string => typeof token === "string",
        )
      : undefined,
    relevantFiles: Array.isArray(doc.relevantFiles)
      ? doc.relevantFiles.filter(
          (file): file is string => typeof file === "string",
        )
      : undefined,
    relatedComponents: Array.isArray(doc.relatedComponents)
      ? doc.relatedComponents.filter(
          (component): component is string => typeof component === "string",
        )
      : undefined,
  };
}

export async function fetchBuilderDesignSystemDocs(
  designSystemId: string,
  options: BuilderDesignSystemDocsOptions = {},
): Promise<BuilderDesignSystemDocument[]> {
  const credentials = await resolveBuilderDesignSystemCredentials();
  const url = makeBuilderDesignSystemUrl(
    `${encodeURIComponent(designSystemId)}/docs`,
    credentials,
  );
  if (options.page !== undefined)
    url.searchParams.set("page", String(options.page));
  if (options.pageSize !== undefined)
    url.searchParams.set("pageSize", String(options.pageSize));
  if (options.minimal !== undefined)
    url.searchParams.set("minimal", options.minimal ? "true" : "false");
  if (options.type?.trim()) url.searchParams.set("type", options.type.trim());

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: makeBuilderHeaders(credentials),
  });
  await assertOk(response, "Builder design-system docs fetch failed");
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new Error(
      "Builder design-system docs fetch returned an invalid response.",
    );
  }
  return json.map(normalizeBuilderDesignSystemDocument);
}

export async function hydrateBuilderDesignSystemReference(
  reference: BuilderDesignSystemProxyReference,
  options: BuilderDesignSystemDocsOptions = { page: 0, pageSize: 40 },
): Promise<BuilderDesignSystemHydratedReference> {
  const docs = await fetchBuilderDesignSystemDocs(
    reference.builderDesignSystemId,
    options,
  );
  const tokenValues: Record<string, string> = {};
  for (const doc of docs) {
    if (!doc.tokenValues) continue;
    for (const [name, value] of Object.entries(doc.tokenValues)) {
      if (typeof value === "string") tokenValues[name] = value;
    }
  }
  return {
    ...reference,
    docs,
    tokenValues,
    docCount: docs.length,
  };
}

/**
 * Opens signed resumable-upload slots for `.fig`/code/design attachments so
 * the browser can stream each file's bytes straight to GCS. Large `.fig`
 * files must not ride through the app server as one request body -- the
 * serverless host caps request bodies well below Figma export sizes.
 */
export async function startBuilderDesignSystemUpload(
  attachments: BuilderDesignSystemUploadAttachment[],
): Promise<BuilderDesignSystemUploadSlot[]> {
  if (attachments.length === 0) return [];
  const credentials = await resolveBuilderDesignSystemCredentials();
  const uploadStart = await fetchWithTimeout(
    makeBuilderDesignSystemUrl("upload/start", credentials),
    {
      method: "POST",
      headers: {
        ...makeBuilderHeaders(credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attachments }),
    },
  );
  await assertOk(uploadStart, "Builder design-system upload start failed");
  const uploadJson = (await uploadStart.json()) as UploadStartResponse;
  const slots = [...(uploadJson.uploads ?? [])].sort((a, b) => a.idx - b.idx);
  if (slots.length !== attachments.length) {
    throw new Error("Builder did not return upload slots for all files.");
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].idx !== i) {
      throw new Error("Builder upload slot mismatch: expected " + i + ".");
    }
  }
  return slots;
}

/**
 * Finalizes indexing from already-resolved sources (uploaded file tokens,
 * public repos, connected projects). Callers that stream uploads from the
 * browser pass the returned `uploadToken`s as `file` sources here.
 */
export async function indexBuilderDesignSystem(
  options: BuilderDesignSystemIndexFromSourcesOptions,
): Promise<BuilderDesignSystemIndexResult> {
  if (options.sources.length === 0) {
    throw new Error(
      "Provide at least one .fig/code/text file or a GitHub repository URL to index with Builder.",
    );
  }
  const credentials = await resolveBuilderDesignSystemCredentials();
  const index = await fetchWithTimeout(
    makeBuilderDesignSystemUrl("index", credentials),
    {
      method: "POST",
      headers: {
        ...makeBuilderHeaders(credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sources: options.sources,
        ...(options.projectName?.trim()
          ? { designSystemName: options.projectName.trim() }
          : {}),
        ...(options.devToolsVersion?.trim()
          ? { devToolsVersion: options.devToolsVersion.trim() }
          : {}),
      }),
    },
  );
  await assertOk(index, "Builder design-system indexing failed");
  const indexed = (await index.json()) as IndexResponse;
  if (!indexed.designSystemId) {
    throw new Error(
      "Builder design-system indexing returned an incomplete response.",
    );
  }

  const jobId = indexed.jobId ?? "";
  // The `.fig` decode job creates the Fusion branch asynchronously, so
  // `/index` usually can't return a branchUrl yet — the caller polls the
  // decode-job status endpoint for it once the job completes.
  const branchUrl = indexed.branchUrl?.trim() || null;

  return {
    ok: true,
    source: "builder",
    projectId: indexed.projectId ?? "",
    jobId,
    designSystemId: indexed.designSystemId,
    suggestedTitle: options.projectName?.trim() || null,
    builderUrl:
      branchUrl ||
      builderProjectBranchUrl(indexed.projectId, indexed.branchName) ||
      builderDesignSystemUrl(indexed.designSystemId),
    status: "in-progress",
  };
}

/**
 * Server-side indexing for in-memory files (the agent action's small inline
 * payloads). Uploads each file server->GCS in resumable chunks, then
 * finalizes. Browser callers should instead stream via
 * `startBuilderDesignSystemUpload` + `indexBuilderDesignSystem`.
 */
export async function startBuilderDesignSystemIndex(
  options: BuilderDesignSystemIndexOptions,
): Promise<BuilderDesignSystemIndexResult> {
  const files = nonEmptyFiles(options.files);
  const description = options.description?.trim();
  if (description) {
    files.unshift({
      name: "additional-context.txt",
      data: new TextEncoder().encode(description),
      mimeType: "text/plain",
    });
  }
  if (
    files.length === 0 &&
    !options.githubRepoUrl &&
    !(options.githubRepos && options.githubRepos.length > 0) &&
    !options.connectedProjectId
  ) {
    throw new Error(
      "Provide at least one .fig/code/text file or a GitHub repository URL to index with Builder.",
    );
  }

  const sources: DesignSystemSourceInput[] = [];
  const fileInstructions = new Map<string, string>();

  function appendGitHubCollection(
    collection: BuilderDesignSystemGitHubFileCollection,
  ): void {
    for (const file of collection.files) {
      const name = `github/${collection.owner}/${collection.repo}/${file.path}`;
      files.push({
        name,
        data: new TextEncoder().encode(file.content),
        mimeType: mimeTypeForBuilderDesignSystemFilename(file.path),
      });
      if (collection.source.instructions) {
        fileInstructions.set(name, collection.source.instructions);
      }
    }
  }

  const githubSources = options.githubRepos?.length
    ? options.githubRepos
    : options.githubRepoUrl?.trim()
      ? [{ repoUrl: options.githubRepoUrl.trim() }]
      : [];
  for (const input of githubSources) {
    const { source, reference } = normalizedGitHubSource(input);
    const hasExplicitScope =
      Boolean(source.ref) ||
      Boolean(source.include?.length) ||
      Boolean(source.exclude?.length);
    if (hasExplicitScope) {
      const collection = await collectBuilderDesignSystemGitHubFiles(source);
      appendGitHubCollection(collection);
      continue;
    }

    const publicAccess = await isPublicGitHubSource(reference);
    if (publicAccess.ok) {
      sources.push({
        kind: "public-repo",
        repoUrl: source.repoUrl,
        ...(source.instructions ? { instructions: source.instructions } : {}),
      });
      continue;
    }

    if (await resolveSecret("GITHUB_TOKEN")) {
      const collection = await collectBuilderDesignSystemGitHubFiles(source);
      appendGitHubCollection(collection);
      continue;
    }

    throw githubSourceAccessError(
      reference.owner,
      reference.repo,
      publicAccess.status,
      false,
      publicAccess.message,
    );
  }
  if (files.length > 0) {
    const slots = await startBuilderDesignSystemUpload(
      files.map((file) => ({
        name: file.name,
        mimetype: mimeTypeForFile(file),
        declaredSize: file.data.byteLength,
      })),
    );
    for (let i = 0; i < slots.length; i++) {
      await uploadToResumableUrl(slots[i], files[i]);
    }
    const fileSources: DesignSystemSourceInput[] = [];
    for (let i = 0; i < slots.length; i++) {
      const name = files[i].name;
      const fileSelection = options.selection?.[name];
      fileSources.push({
        kind: "file",
        uploadToken: slots[i].uploadToken,
        ...(fileInstructions.get(name)
          ? { instructions: fileInstructions.get(name) }
          : {}),
        ...(fileSelection && fileSelection.length > 0
          ? { selection: { [name]: fileSelection } }
          : {}),
      });
    }
    sources.unshift(...fileSources);
  }
  if (options.connectedProjectId?.trim()) {
    sources.push({
      kind: "connected-repo",
      fusionProjectId: options.connectedProjectId.trim(),
    });
  }

  return indexBuilderDesignSystem({
    sources,
    projectName: options.projectName,
    devToolsVersion: options.devToolsVersion,
  });
}
