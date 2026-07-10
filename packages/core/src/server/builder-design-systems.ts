import { FeatureNotConfiguredError } from "./credential-provider.js";
import {
  getBuilderProxyOrigin,
  resolveBuilderCredentials,
} from "./credential-provider.js";

const DEFAULT_TIMEOUT_MS = 120_000;

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
}

export interface BuilderDesignSystemProxyFields {
  title: string;
  description: string;
  data: string;
  customInstructions: string;
}

export interface BuilderDesignSystemProxyReference {
  source: "builder";
  builderDesignSystemId: string;
  builderJobId: string;
  builderProjectId?: string;
  builderUrl?: string;
  builderStatus?: string;
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
  connectedProjectId?: string;
  files?: BuilderDesignSystemIndexFile[];
  selection?: Record<string, string[]>;
  devToolsVersion?: string;
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

interface GenerateResponse {
  projectId?: string;
  jobId?: string;
  designSystemId?: string;
}

const DEFAULT_MAX_CODE_FILES = 50;
const DEFAULT_MAX_TOTAL_CODE_BYTES = 2 * 1024 * 1024;
const MAX_DOC_CONTENT_CHARS = 4_000;

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
        "Connect Builder.io before indexing a design system from Figma or code.",
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

async function uploadToResumableUrl(
  slot: { uploadUrl: string },
  file: BuilderDesignSystemIndexFile,
): Promise<void> {
  const mimeType = mimeTypeForFile(file);
  const bytes = file.data;
  const start = await fetchWithTimeout(slot.uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-resumable": "start",
      "x-goog-content-length-range": `0,${bytes.byteLength}`,
      "Content-Type": mimeType,
    },
  });
  await assertOk(start, "Builder design-system upload session failed");
  const sessionUrl = start.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("Builder design-system upload session returned no URL.");
  }

  const response = await fetchWithTimeout(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
      "Content-Type": mimeType,
    },
    body: makeBody(bytes, mimeType),
  });
  await assertOk(response, "Builder design-system file upload failed");
}

function nonEmptyFiles(
  files: BuilderDesignSystemIndexFile[] | undefined,
): BuilderDesignSystemIndexFile[] {
  return (files ?? []).filter((file) => file.data.byteLength > 0);
}

export function builderDesignSystemUrl(designSystemId?: string | null): string {
  const host = trimTrailingSlash(getBuilderAppHost());
  return designSystemId
    ? `${host}/app/design-system-intelligence/${encodeURIComponent(
        designSystemId,
      )}`
    : `${host}/app/design-system-intelligence`;
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
}: BuilderDesignSystemProxyFieldsOptions): BuilderDesignSystemProxyFields {
  const title = projectName?.trim() || "Builder indexed design system";
  const fallbackDescription =
    description ?? `Builder indexed design system ${result.designSystemId}`;
  const surfaceNoun = surface === "slides" ? "slides" : "designs";
  const spacingKey = surface === "slides" ? "slidePadding" : "pagePadding";
  const data = JSON.stringify({
    source: "builder",
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
  return {
    source: "builder",
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
  if (!Array.isArray(json)) return [];
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
    !options.connectedProjectId
  ) {
    throw new Error(
      "Provide at least one .fig/code/text file or a GitHub repository URL to index with Builder.",
    );
  }

  const credentials = await resolveBuilderDesignSystemCredentials();
  let uploadTokens: string[] = [];
  if (files.length > 0) {
    const uploadStart = await fetchWithTimeout(
      makeBuilderDesignSystemUrl("upload/start", credentials),
      {
        method: "POST",
        headers: {
          ...makeBuilderHeaders(credentials),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attachments: files.map((file) => ({
            name: file.name,
            mimetype: mimeTypeForFile(file),
            declaredSize: file.data.byteLength,
          })),
        }),
      },
    );
    await assertOk(uploadStart, "Builder design-system upload start failed");
    const uploadJson = (await uploadStart.json()) as UploadStartResponse;
    const slots = [...(uploadJson.uploads ?? [])].sort((a, b) => a.idx - b.idx);
    if (slots.length !== files.length) {
      throw new Error("Builder did not return upload slots for all files.");
    }
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].idx !== i) {
        throw new Error(`Builder upload slot mismatch: expected ${i}.`);
      }
      await uploadToResumableUrl(slots[i], files[i]);
    }
    uploadTokens = slots.map((slot) => slot.uploadToken);
  }

  const generate = await fetchWithTimeout(
    makeBuilderDesignSystemUrl("generate", credentials),
    {
      method: "POST",
      headers: {
        ...makeBuilderHeaders(credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uploads: uploadTokens,
        ...(options.projectName?.trim()
          ? { projectName: options.projectName.trim() }
          : {}),
        ...(options.githubRepoUrl?.trim()
          ? { githubRepoUrl: options.githubRepoUrl.trim() }
          : {}),
        ...(options.connectedProjectId?.trim()
          ? { connectedProjectId: options.connectedProjectId.trim() }
          : {}),
        ...(options.selection ? { selection: options.selection } : {}),
        ...(options.devToolsVersion?.trim()
          ? { devToolsVersion: options.devToolsVersion.trim() }
          : {}),
      }),
    },
  );
  await assertOk(generate, "Builder design-system indexing failed");
  const generated = (await generate.json()) as GenerateResponse;
  if (!generated.projectId || !generated.jobId || !generated.designSystemId) {
    throw new Error(
      "Builder design-system indexing returned an incomplete response.",
    );
  }

  return {
    ok: true,
    source: "builder",
    projectId: generated.projectId,
    jobId: generated.jobId,
    designSystemId: generated.designSystemId,
    suggestedTitle: options.projectName?.trim() || null,
    builderUrl: builderDesignSystemUrl(generated.designSystemId),
    status: "in-progress",
  };
}
