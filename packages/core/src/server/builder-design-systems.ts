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
  if (file.mimeType?.trim()) return file.mimeType.trim();
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".fig")) return "application/octet-stream";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown"))
    return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  return "text/plain";
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
