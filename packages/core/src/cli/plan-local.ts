/**
 * Plan helper commands.
 *
 * The `plan local` commands are intentionally separate from the Plan app
 * actions. They do not call MCP, hosted write actions, SQLite, or hosted
 * storage; they only read local files or serve them from a localhost bridge so
 * privacy-focused users have an auditable no-DB path. The top-level
 * `plan blocks` command is a schema-only, no-auth helper for fetching the
 * public block catalog before authoring local MDX; it never sends plan content.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_PLAN_APP_URL,
  defaultPlanBlocksOut,
  fetchPlanBlockCatalog,
  normalizePlanBlockFormat,
  planActionEndpoint,
} from "./plan-blocks.js";

type LocalPlanKind = "plan" | "recap";

type LocalPlanFiles = {
  dir: string;
  planMdx: string;
  canvasMdx?: string;
  prototypeMdx?: string;
  stateJson?: string;
  assets?: Record<string, string>;
};

export type LocalPlanValidationIssue = {
  file: string;
  line: number;
  message: string;
};

type LocalPlanPreviewInput = {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
  appUrl?: string;
};

type LocalPlanPreviewResult = {
  ok: true;
  dir: string;
  out?: string;
  url: string;
  title: string;
  kind: LocalPlanKind;
  files: string[];
  opened?: boolean;
  openCommand?: string;
  openError?: string;
};

type LocalPlanBridgeMdxFolder = {
  "plan.mdx": string;
  "canvas.mdx"?: string;
  "prototype.mdx"?: string;
  ".plan-state.json"?: string;
  "assets/"?: Record<string, string>;
};

type LocalPlanBridgeComment = {
  id: string;
  planId: string;
  parentCommentId: string | null;
  sectionId: string | null;
  kind: string;
  status: string;
  anchor: string | null;
  message: string;
  createdBy: string;
  authorEmail: string | null;
  authorName: string | null;
  resolutionTarget: string | null;
  mentions: unknown[];
  mentionsJson: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  consumedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type LocalPlanBridgeCommentInput = {
  id?: string;
  parentCommentId?: string | null;
  sectionId?: string | null;
  kind?: string;
  status?: string;
  anchor?: string | null;
  message?: string;
  createdBy?: string;
  authorEmail?: string | null;
  authorName?: string | null;
  resolutionTarget?: string | null;
  mentions?: unknown[];
  resolvedBy?: string | null;
  resolvedAt?: string | null;
};

type LocalPlanBridgeCommentUpdate = {
  comments?: LocalPlanBridgeCommentInput[];
  deletedCommentIds?: string[];
};

type VisualAnswerSourcePayload = {
  question?: string;
  title?: string;
  brief?: string;
  repoPath?: string;
  sourceUrl?: string;
  sourceType?: string;
  mdx: {
    "plan.mdx": string;
    "canvas.mdx"?: string;
    "prototype.mdx"?: string;
    "assets/"?: Record<string, string>;
  };
};

export type PublishVisualAnswerInput = {
  appUrl: string;
  token: string;
  question?: string;
  sourcePath?: string;
  out?: string;
  prevPlanId?: string;
  repo?: string;
  sourceUrl?: string;
  sourceType?: string;
  visibility?: "private" | "org" | "public";
  fetchFn?: typeof fetch;
  cwd?: string;
};

export type LocalPlanBridgePayload = {
  ok: true;
  version: 1;
  source: "agent-native-local-bridge";
  localOnly: true;
  slug: string;
  dir: string;
  title: string;
  brief: string;
  kind: LocalPlanKind;
  updatedAt: string;
  files: string[];
  mdx: LocalPlanBridgeMdxFolder;
  comments: LocalPlanBridgeComment[];
};

export type LocalPlanServeResult = {
  ok: true;
  dir: string;
  url: string;
  urlFile?: string;
  bridgeUrl: string;
  appUrl: string;
  title: string;
  kind: LocalPlanKind;
  files: string[];
  host: string;
  port: number;
  opened?: boolean;
  openCommand?: string;
  openError?: string;
};

export type LocalPlanBridgeServer = {
  server: Server;
  result: LocalPlanServeResult;
};

export type RendererValidationIssue = {
  path: string;
  message: string;
};

export type RendererValidation = {
  /** Whether the renderer validate endpoint was reachable and answered. */
  ran: boolean;
  endpoint: string;
  /** Renderer verdict — present only when `ran` is true. */
  valid?: boolean;
  issues?: RendererValidationIssue[];
  /** Transport/endpoint error when `ran` is false (unreachable, 404, old deploy). */
  error?: string;
};

export type LocalPlanVerifyResult = {
  ok: boolean;
  dir: string;
  url: string;
  urlFile?: string;
  bridgeUrl: string;
  appUrl: string;
  title: string;
  kind: LocalPlanKind;
  files: string[];
  preflight: {
    status: number;
    allowOrigin: string | null;
    allowPrivateNetwork: string | null;
  };
  bridge: {
    status: number;
    ok: boolean;
    source?: string;
    localOnly?: boolean;
    files?: string[];
    mdxFiles?: string[];
    error?: string;
  };
  validation: RendererValidation;
  warnings: string[];
};

type OpenLocalUrlResult = {
  ok: boolean;
  command: string;
  error?: string;
};

const LOCAL_PLAN_COMMENTS_FILE = "comments.json";
const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";
const LOCAL_PLAN_BRIDGE_COMMENT_BODY_LIMIT = 1024 * 1024;

const LOCAL_PLAN_ASSET_MAX_SINGLE_BYTES = 2 * 1024 * 1024;
const LOCAL_PLAN_ASSET_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const AGENT_NATIVE_MANIFEST_FILE = "agent-native.json";
const VISUAL_ANSWER_SOURCE_FILENAME = "visual-answer-source.json";
const VISUAL_ANSWER_URL_FILENAME = "visual-answer-url.txt";
const PLAN_ACTION_HTTP_TIMEOUT_MS = 45_000;
const LOCAL_PLAN_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stringArg(
  args: Record<string, string | boolean>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function optionalArg(
  args: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolArg(args: Record<string, string | boolean>, key: string): boolean {
  return args[key] === true;
}

function sanitizeHttpDetail(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeVisibility(
  value: string | undefined,
): "private" | "org" | "public" | undefined {
  if (!value) return undefined;
  if (value === "private" || value === "org" || value === "public") {
    return value;
  }
  throw new Error(
    `Invalid --visibility "${value}" (expected private, org, or public)`,
  );
}

function normalizeVisualAnswerSourceType(value: string | undefined): string {
  if (!value) return "code";
  if (
    [
      "code",
      "pull-request",
      "commit",
      "branch",
      "diff",
      "issue",
      "page",
    ].includes(value)
  ) {
    return value;
  }
  throw new Error(
    `Invalid --source-type "${value}" (expected code, pull-request, commit, branch, diff, issue, or page)`,
  );
}

function visualAnswerUrlFromPublishResult(
  result: unknown,
  appUrl: string,
): string | null {
  const base = appUrl.replace(/\/$/, "");
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const rawUrl =
    typeof record.url === "string"
      ? record.url
      : record.path && typeof record.path === "string"
        ? record.path
        : null;
  if (rawUrl) {
    try {
      return new URL(rawUrl, `${base}/`).toString();
    } catch {
      return null;
    }
  }
  const planId =
    typeof record.planId === "string"
      ? record.planId
      : record.plan &&
          typeof record.plan === "object" &&
          typeof (record.plan as Record<string, unknown>).id === "string"
        ? ((record.plan as Record<string, unknown>).id as string)
        : null;
  return planId ? `${base}/plans/${encodeURIComponent(planId)}` : null;
}

async function fetchActionWithTimeout(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<Response> {
  return await fetchFn(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PLAN_ACTION_HTTP_TIMEOUT_MS),
  });
}

export function localPlanFolderName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "untitled-plan";
}

function normalizeKind(value: string | undefined): LocalPlanKind {
  if (!value) return "plan";
  if (value === "plan" || value === "recap") return value;
  throw new Error(`Invalid --kind "${value}" (expected plan or recap)`);
}

function normalizeSlash(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeRelativePath(filePath: string): string | null {
  if (!filePath.trim() || path.isAbsolute(filePath)) return null;
  const normalized = path.posix
    .normalize(normalizeSlash(filePath.trim()))
    .replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function findUpward(startDir: string, filename: string): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function manifestRootPath(value: unknown): string | null {
  if (typeof value === "string") return normalizeRelativePath(value);
  if (isRecord(value) && typeof value.path === "string") {
    return normalizeRelativePath(value.path);
  }
  return null;
}

function planManifestConfig(): { rootDir: string; plansPath: string } | null {
  const configuredManifest =
    process.env.AGENT_NATIVE_MANIFEST?.trim() ||
    process.env.AGENT_NATIVE_MANIFEST_PATH?.trim();
  const manifestPath = configuredManifest
    ? path.resolve(configuredManifest)
    : findUpward(process.cwd(), AGENT_NATIVE_MANIFEST_FILE);
  if (!manifestPath) return null;

  try {
    const parsed = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as unknown;
    const apps = isRecord(parsed) && isRecord(parsed.apps) ? parsed.apps : null;
    const planApp = apps && isRecord(apps.plan) ? apps.plan : null;
    const roots = planApp && Array.isArray(planApp.roots) ? planApp.roots : [];
    const plansPath = roots
      .map(manifestRootPath)
      .find((item): item is string => Boolean(item));
    return plansPath
      ? { rootDir: path.dirname(manifestPath), plansPath }
      : null;
  } catch {
    return null;
  }
}

function localPlanWorkspaceRoot(startDir = process.cwd()): string {
  const manifestPath = findUpward(startDir, AGENT_NATIVE_MANIFEST_FILE);
  if (manifestPath) return path.dirname(manifestPath);
  const gitDir = findUpward(startDir, ".git");
  if (gitDir) return path.dirname(gitDir);

  const configuredManifest =
    process.env.AGENT_NATIVE_MANIFEST?.trim() ||
    process.env.AGENT_NATIVE_MANIFEST_PATH?.trim();
  if (configuredManifest) return path.dirname(path.resolve(configuredManifest));
  return process.cwd();
}

function defaultPlansDir(): string {
  const configured = process.env.PLAN_LOCAL_DIR;
  if (configured?.trim()) return path.resolve(configured.trim());
  const manifest = planManifestConfig();
  if (manifest) return path.resolve(manifest.rootDir, manifest.plansPath);
  return path.resolve("plans");
}

function defaultLocalPlanAppUrl(): string {
  return (
    process.env.PLAN_LOCAL_APP_URL ||
    process.env.PLAN_BASE_URL ||
    "http://localhost:8096"
  );
}

function defaultLocalPlanBridgeAppUrl(): string {
  return (
    process.env.PLAN_LOCAL_BRIDGE_APP_URL ||
    process.env.PLAN_BASE_URL ||
    DEFAULT_PLAN_APP_URL
  );
}

function normalizeAppUrl(value: string | undefined): string {
  return (value || defaultLocalPlanAppUrl()).replace(/\/+$/, "");
}

function normalizeBridgeAppUrl(value: string | undefined): string {
  return (value || defaultLocalPlanBridgeAppUrl()).replace(/\/+$/, "");
}

function localPlanPreviewUrl(dir: string, appUrl?: string): string {
  const base = `${normalizeAppUrl(appUrl)}/local-plans/${encodeURIComponent(
    path.basename(path.resolve(dir)),
  )}`;
  const repoPath = repoRelativePlanPath(dir);
  if (!repoPath) return base;
  return `${base}?${new URLSearchParams({ path: repoPath }).toString()}`;
}

function realpathIfExists(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function repoRelativePlanPath(dir: string): string | null {
  const resolved = realpathIfExists(dir);
  const root = realpathIfExists(localPlanWorkspaceRoot(resolved));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return normalizeSlash(relative);
}

function localPlanBridgePageUrl(input: {
  dir: string;
  bridgeUrl: string;
  appUrl?: string;
}): string {
  return `${normalizeBridgeAppUrl(input.appUrl)}/local-plans/${encodeURIComponent(
    path.basename(path.resolve(input.dir)),
  )}?bridge=${encodeURIComponent(input.bridgeUrl)}`;
}

function writeLocalPlanUrlFile(dir: string, url: string, urlFile?: string) {
  const file = path.resolve(urlFile || path.join(dir, ".plan-url"));
  fs.writeFileSync(file, `${url}\n`, { encoding: "utf-8", mode: 0o600 });
  return file;
}

function runOpenCommand(command: string, args: string[]): OpenLocalUrlResult {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    windowsHide: true,
  });
  const commandDisplay = [command, ...args].join(" ");
  if (result.error) {
    return {
      ok: false,
      command: commandDisplay,
      error: result.error.message,
    };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      ok: false,
      command: commandDisplay,
      error: `exit code ${result.status}`,
    };
  }
  return { ok: true, command: commandDisplay };
}

function openLocalUrl(url: string): OpenLocalUrlResult {
  const platform = process.platform;
  if (platform === "darwin") {
    for (const appName of [
      "Google Chrome",
      "Chromium",
      "Microsoft Edge",
      "Brave Browser",
    ]) {
      const result = runOpenCommand("open", ["-a", appName, url]);
      if (result.ok) return result;
    }
    return runOpenCommand("open", [url]);
  }
  if (platform === "win32") {
    return runOpenCommand("cmd", ["/c", "start", "", url]);
  }
  return runOpenCommand("xdg-open", [url]);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripFrontmatter(source: string): {
  body: string;
  frontmatter: Record<string, string>;
} {
  if (!source.startsWith("---\n")) return { body: source, frontmatter: {} };
  const end = source.indexOf("\n---", 4);
  if (end < 0) return { body: source, frontmatter: {} };
  const frontmatterSource = source.slice(4, end).trim();
  const body = source.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterSource.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2]
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .trim();
    frontmatter[match[1]] = value;
  }
  return { body, frontmatter };
}

function firstHeading(source: string): string | null {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

function splitMdxBlocks(source: string): Array<{
  type: "markdown" | "component";
  name?: string;
  value: string;
}> {
  const blocks: Array<{
    type: "markdown" | "component";
    name?: string;
    value: string;
  }> = [];
  const lines = source.split(/\r?\n/);
  let markdown: string[] = [];
  let component: string[] | null = null;
  let componentName = "";

  function flushMarkdown() {
    const value = markdown.join("\n").trim();
    if (value) blocks.push({ type: "markdown", value });
    markdown = [];
  }

  function flushComponent() {
    if (!component) return;
    blocks.push({
      type: "component",
      name: componentName || "MDX component",
      value: component.join("\n").trim(),
    });
    component = null;
    componentName = "";
  }

  for (const line of lines) {
    const start = line.match(/^<([A-Z][A-Za-z0-9_]*)\b/);
    if (!component && start) {
      flushMarkdown();
      component = [line];
      componentName = start[1];
      if (/\/>\s*$/.test(line)) flushComponent();
      continue;
    }

    if (component) {
      component.push(line);
      if (new RegExp(`</${componentName}>\\s*$`).test(line)) {
        flushComponent();
      }
      continue;
    }

    markdown.push(line);
  }

  flushComponent();
  flushMarkdown();
  return blocks;
}

function renderMarkdownish(source: string): string {
  const lines = source.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listLines: string[] = [];

  function flushList() {
    if (listLines.length === 0) return;
    html.push(
      `<ul>${listLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    );
    listLines = [];
  }

  function flushCode() {
    if (!inCode) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    inCode = false;
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) flushCode();
      else {
        flushList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${escapeHtml(heading[2].trim())}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      listLines.push(bullet[1]);
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    html.push(`<p>${escapeHtml(line.trim())}</p>`);
  }

  flushCode();
  flushList();
  return html.join("\n");
}

function readLocalPlanAssets(dir: string): Record<string, string> | undefined {
  const assetsDir = path.join(dir, "assets");
  if (!fs.existsSync(assetsDir)) return undefined;

  const assets: Record<string, string> = {};
  let totalBytes = 0;
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filename = path.basename(entry.name);
    if (!filename || filename !== entry.name) continue;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!LOCAL_PLAN_ASSET_EXTENSIONS.has(ext)) continue;

    const abs = path.join(assetsDir, filename);
    const bytes = fs.readFileSync(abs);
    if (bytes.byteLength > LOCAL_PLAN_ASSET_MAX_SINGLE_BYTES) continue;
    if (totalBytes + bytes.byteLength > LOCAL_PLAN_ASSET_MAX_TOTAL_BYTES) {
      continue;
    }
    totalBytes += bytes.byteLength;
    assets[filename] = bytes.toString("base64");
  }

  return Object.keys(assets).length > 0 ? assets : undefined;
}

export function readLocalPlanFiles(dir: string): LocalPlanFiles {
  const resolved = path.resolve(dir);
  const planPath = path.join(resolved, "plan.mdx");
  if (!fs.existsSync(planPath)) {
    throw new Error(`Missing local plan source: ${planPath}`);
  }
  const readOptional = (file: string) => {
    const abs = path.join(resolved, file);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : undefined;
  };
  return {
    dir: resolved,
    planMdx: fs.readFileSync(planPath, "utf-8"),
    canvasMdx: readOptional("canvas.mdx"),
    prototypeMdx: readOptional("prototype.mdx"),
    stateJson: readOptional(".plan-state.json"),
    assets: readLocalPlanAssets(resolved),
  };
}

function localPlanMdxFolder(files: LocalPlanFiles): LocalPlanBridgeMdxFolder {
  return {
    "plan.mdx": files.planMdx,
    ...(files.canvasMdx ? { "canvas.mdx": files.canvasMdx } : {}),
    ...(files.prototypeMdx ? { "prototype.mdx": files.prototypeMdx } : {}),
    ...(files.stateJson ? { ".plan-state.json": files.stateJson } : {}),
    ...(files.assets ? { "assets/": files.assets } : {}),
  };
}

function localPlanFileList(files: LocalPlanFiles): string[] {
  return [
    "plan.mdx",
    ...(files.canvasMdx ? ["canvas.mdx"] : []),
    ...(files.prototypeMdx ? ["prototype.mdx"] : []),
    ...(files.stateJson ? [".plan-state.json"] : []),
    ...Object.keys(files.assets ?? {}).map((filename) => `assets/${filename}`),
  ];
}

function localPlanSourceEntries(files: LocalPlanFiles): Array<{
  file: string;
  source: string;
}> {
  return [
    { file: "plan.mdx", source: files.planMdx },
    ...(files.canvasMdx
      ? [{ file: "canvas.mdx", source: files.canvasMdx }]
      : []),
    ...(files.prototypeMdx
      ? [{ file: "prototype.mdx", source: files.prototypeMdx }]
      : []),
  ];
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function maskFencedCode(source: string): string {
  return source.replace(
    /(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*(?=\n|$))/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
}

function findJsxOpeningTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  let braceDepth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\" && i + 1 < source.length) {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === ">" && braceDepth === 0) return i;
  }
  return -1;
}

function addValidationIssue(
  issues: LocalPlanValidationIssue[],
  file: string,
  source: string,
  index: number,
  message: string,
) {
  issues.push({ file, line: lineNumberAt(source, index), message });
}

const ENTITY_RE = /&(?:[a-z][a-z0-9]+|#[0-9]+|#x[0-9a-f]+);/gi;
const HTML_TEXT_ATTR_RE =
  /\b(?:aria-label|alt|placeholder|title|value)=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi;
const WIREFRAME_TEXT_ATTR_RE =
  /\b(?:text|value|label|placeholder|title|note|due)=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi;

function normalizeVisibleText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(ENTITY_RE, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTextLength(value: string | undefined): number {
  return normalizeVisibleText(value ?? "").length;
}

function htmlMeaningfulTextLength(html: string): number {
  let length = 0;
  for (const match of html.matchAll(HTML_TEXT_ATTR_RE)) {
    length += meaningfulTextLength(match[1] ?? match[2] ?? match[3]);
  }

  const visibleText = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  length += meaningfulTextLength(visibleText);

  return length;
}

function hasSkeletonGeometry(html: string): boolean {
  return (
    /<(?:div|span|section|main|article|ul|li)\b/i.test(html) &&
    /\b(?:height|width|background|border|padding|wf-card|wf-box|wf-pill|wf-chip)\b/i.test(
      html,
    )
  );
}

function stringAttributeValues(source: string, name: string): string[] {
  const values: string[] = [];
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:\\{\\s*\`([\\s\\S]*?)\`\\s*\\}|\\{\\s*"([^"]*)"\\s*\\}|\\{\\s*'([^']*)'\\s*\\}|"([^"]*)"|'([^']*)')`,
    "g",
  );
  for (const match of source.matchAll(re)) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (value !== undefined) values.push(value);
  }
  return values;
}

function hasUnparsedAttributeExpression(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*=\\s*\\{`).test(source);
}

function hasMeaningfulWireframeHtml(screenOpening: string): boolean | null {
  const htmlValues = stringAttributeValues(screenOpening, "html");
  if (htmlValues.length === 0) {
    return hasUnparsedAttributeExpression(screenOpening, "html") ? null : false;
  }
  return htmlValues.some(
    (html) => htmlMeaningfulTextLength(html) >= 2 || hasSkeletonGeometry(html),
  );
}

function hasMeaningfulKitScreen(screenSource: string): boolean {
  for (const match of screenSource.matchAll(WIREFRAME_TEXT_ATTR_RE)) {
    if (meaningfulTextLength(match[1] ?? match[2] ?? match[3]) >= 2) {
      return true;
    }
  }
  if (/\bitems\s*=\s*\{[\s\S]*?\blabel\s*:/i.test(screenSource)) return true;
  if (/\brows\s*=\s*\{[\s\S]*?\b[klv]\s*:/i.test(screenSource)) return true;
  return false;
}

function hasMeaningfulWireframeScreen(blockSource: string): boolean | null {
  const screenMatch = /<Screen\b/.exec(blockSource);
  if (!screenMatch) return false;
  const screenStart = screenMatch.index;
  const screenOpeningEnd = findJsxOpeningTagEnd(blockSource, screenStart);
  if (screenOpeningEnd < 0) return false;
  const screenOpening = blockSource.slice(screenStart, screenOpeningEnd + 1);
  const htmlMeaningful = hasMeaningfulWireframeHtml(screenOpening);
  if (htmlMeaningful === true) return true;

  const selfClosing = /\/\s*>$/.test(screenOpening);
  const closeIndex = selfClosing
    ? -1
    : blockSource.indexOf("</Screen>", screenOpeningEnd + 1);
  const screenSource =
    closeIndex >= 0
      ? blockSource.slice(screenStart, closeIndex + "</Screen>".length)
      : screenOpening;
  if (hasMeaningfulKitScreen(screenSource)) return true;

  return htmlMeaningful === null ? null : false;
}

function lintWireframeBlocks(
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const scanSource = maskFencedCode(source);
  const re = /<WireframeBlock\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scanSource))) {
    const start = match.index;
    const openingEnd = findJsxOpeningTagEnd(scanSource, start);
    if (openingEnd < 0) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        "WireframeBlock opening tag is not closed.",
      );
      continue;
    }

    const opening = scanSource.slice(start, openingEnd + 1);
    const unsupportedAttr = opening.match(
      /\b(data|screens|screen|elements)\s*=/,
    );
    if (unsupportedAttr) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        `WireframeBlock uses unsupported "${unsupportedAttr[1]}" prop. Put content inside a <Screen> child instead.`,
      );
    }

    const selfClosing = /\/\s*>$/.test(opening);
    const closeTag = "</WireframeBlock>";
    const closeIndex = selfClosing
      ? -1
      : scanSource.indexOf(closeTag, openingEnd + 1);
    const blockSource = selfClosing
      ? opening
      : closeIndex >= 0
        ? scanSource.slice(start, closeIndex + closeTag.length)
        : scanSource.slice(start, openingEnd + 1);

    if (!selfClosing && closeIndex < 0) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        "WireframeBlock must have a closing </WireframeBlock> tag.",
      );
    }

    if (selfClosing || !/<Screen\b/.test(blockSource)) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        'WireframeBlock must wrap a <Screen> child; self-closing wireframes render empty. Use <WireframeBlock><Screen surface="browser">...</Screen></WireframeBlock>.',
      );
      continue;
    }

    const meaningfulScreen = hasMeaningfulWireframeScreen(blockSource);
    if (meaningfulScreen === false) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        'WireframeBlock contains an empty <Screen>; local previews render blank wireframes. Add visible html text/controls or kit nodes such as <Title text="Checkout" /> and <Btn label="Pay" />.',
      );
    }
  }
}

function lintColumnsBlocks(
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const scanSource = maskFencedCode(source);
  const re = /<Columns\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scanSource))) {
    const start = match.index;
    const openingEnd = findJsxOpeningTagEnd(scanSource, start);
    if (openingEnd < 0) continue;
    const opening = source.slice(start, openingEnd + 1);
    const columnsAttr = readJsxAttribute(opening, "columns");
    if (!columnsAttr) continue;
    const entries =
      columnsAttr.kind === "expression"
        ? extractTopLevelObjectLiterals(columnsAttr.value)
        : null;
    if (entries && entries.length > 0) continue;
    addValidationIssue(
      issues,
      file,
      source,
      start,
      'Columns must use <Column> children or a columns={[{ id, label, blocks }]} array, not a bare columns= prop. Use <Columns><Column label="Before">...</Column><Column label="After">...</Column></Columns>.',
    );
  }
}

type JsxAttributeValue = {
  name: string;
  kind: "expression" | "string" | "bare" | "boolean";
  value: string;
  start: number;
};

function findBalancedEnd(
  source: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\" && i + 1 < source.length) {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readJsxAttribute(
  opening: string,
  name: string,
): JsxAttributeValue | null {
  let i = 0;
  while (i < opening.length) {
    if (!/[A-Za-z_:]/.test(opening[i] ?? "")) {
      i += 1;
      continue;
    }
    const nameStart = i;
    i += 1;
    while (/[\w:.-]/.test(opening[i] ?? "")) i += 1;
    const attrName = opening.slice(nameStart, i);
    while (/\s/.test(opening[i] ?? "")) i += 1;
    if (opening[i] !== "=") {
      if (attrName === name) {
        return { name, kind: "boolean", value: "true", start: nameStart };
      }
      continue;
    }
    i += 1;
    while (/\s/.test(opening[i] ?? "")) i += 1;
    const valueStart = i;
    const quote = opening[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      i += 1;
      while (i < opening.length) {
        if (opening[i] === "\\" && i + 1 < opening.length) {
          i += 2;
          continue;
        }
        if (opening[i] === quote) break;
        i += 1;
      }
      const value = opening.slice(valueStart + 1, i);
      i += 1;
      if (attrName === name) {
        return { name, kind: "string", value, start: valueStart + 1 };
      }
      continue;
    }
    if (quote === "{") {
      const end = findBalancedEnd(opening, i, "{", "}");
      if (end < 0) {
        if (attrName === name) {
          return {
            name,
            kind: "expression",
            value: opening.slice(valueStart + 1),
            start: valueStart + 1,
          };
        }
        break;
      }
      const value = opening.slice(valueStart + 1, end);
      i = end + 1;
      if (attrName === name) {
        return { name, kind: "expression", value, start: valueStart + 1 };
      }
      continue;
    }
    while (i < opening.length && !/[\s>]/.test(opening[i] ?? "")) i += 1;
    if (attrName === name) {
      return {
        name,
        kind: "bare",
        value: opening.slice(valueStart, i),
        start: valueStart,
      };
    }
  }
  return null;
}

function expressionOffset(expression: string): number {
  return expression.search(/\S/);
}

function extractTopLevelObjectLiterals(expression: string): Array<{
  source: string;
  start: number;
}> | null {
  const leading = expressionOffset(expression);
  if (leading < 0 || expression[leading] !== "[") return null;
  const arrayEnd = findBalancedEnd(expression, leading, "[", "]");
  if (arrayEnd < 0) return null;
  const objects: Array<{ source: string; start: number }> = [];
  let i = leading + 1;
  while (i < arrayEnd) {
    const char = expression[i];
    if (/\s|,/.test(char ?? "")) {
      i += 1;
      continue;
    }
    if (char !== "{") {
      return null;
    }
    const objectEnd = findBalancedEnd(expression, i, "{", "}");
    if (objectEnd < 0 || objectEnd > arrayEnd) return null;
    objects.push({
      source: expression.slice(i, objectEnd + 1),
      start: i,
    });
    i = objectEnd + 1;
  }
  return objects;
}

function findValueEnd(source: string, start: number): number {
  let i = start;
  let quote: string | null = null;
  let depth = 0;
  while (i < source.length) {
    const char = source[i];
    if (quote) {
      if (char === "\\" && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      i += 1;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      if (depth === 0) return i;
      depth -= 1;
      i += 1;
      continue;
    }
    if (char === "," && depth === 0) return i;
    i += 1;
  }
  return source.length;
}

function readObjectKey(
  source: string,
  start: number,
): {
  key: string;
  keyStart: number;
  colon: number;
} | null {
  let i = start;
  while (/\s|,/.test(source[i] ?? "")) i += 1;
  const keyStart = i;
  const quote = source[i];
  let key = "";
  if (quote === '"' || quote === "'") {
    i += 1;
    const valueStart = i;
    while (i < source.length) {
      if (source[i] === "\\" && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === quote) break;
      i += 1;
    }
    key = source.slice(valueStart, i);
    i += 1;
  } else if (/[A-Za-z_$]/.test(quote ?? "")) {
    i += 1;
    while (/[\w$]/.test(source[i] ?? "")) i += 1;
    key = source.slice(keyStart, i);
  } else {
    return null;
  }
  while (/\s/.test(source[i] ?? "")) i += 1;
  if (source[i] !== ":") return null;
  return { key, keyStart, colon: i };
}

function readTopLevelObjectProperty(
  objectSource: string,
  name: string,
): { value: string; valueStart: number } | null {
  const body = objectSource.trim().startsWith("{")
    ? objectSource.slice(1, objectSource.lastIndexOf("}"))
    : objectSource;
  let i = 0;
  while (i < body.length) {
    const key = readObjectKey(body, i);
    if (!key) {
      i += 1;
      continue;
    }
    const valueStart = key.colon + 1;
    const valueEnd = findValueEnd(body, valueStart);
    if (key.key === name) {
      return { value: body.slice(valueStart, valueEnd), valueStart };
    }
    i = valueEnd + 1;
  }
  return null;
}

function isStaticNonEmptyStringLiteral(value: string): boolean {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return false;
  if (!trimmed.endsWith(quote)) return false;
  if (quote === "`" && /\$\{/.test(trimmed)) return false;
  return trimmed.slice(1, -1).trim().length > 0;
}

function hasRequiredStaticString(objectSource: string, name: string): boolean {
  const prop = readTopLevelObjectProperty(objectSource, name);
  return prop ? isStaticNonEmptyStringLiteral(prop.value) : false;
}

function hasRequiredStaticId(objectSource: string): boolean {
  return hasRequiredStaticString(objectSource, "id");
}

function hasRequiredEnumLiteral(
  objectSource: string,
  name: string,
  allowed: readonly string[],
): boolean {
  const prop = readTopLevelObjectProperty(objectSource, name);
  if (!prop) return false;
  const trimmed = prop.value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return false;
  if (!trimmed.endsWith(quote)) return false;
  if (quote === "`" && /\$\{/.test(trimmed)) return false;
  return allowed.includes(trimmed.slice(1, -1).trim());
}

// Shared per-item checks so the top-level `<Checklist items={[…]} />` tag and
// blocks authored as JSON inside a container's `tabs={[…]}` / `columns={[…]}`
// array enforce the SAME required fields. `listBase` is the absolute offset of
// the items array in the original source so line numbers point near the item.
function checkChecklistItemList(
  items: Array<{ source: string; start: number }>,
  listBase: number,
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  items.forEach((item, index) => {
    const base = listBase + item.start;
    if (!hasRequiredStaticId(item.source)) {
      addValidationIssue(
        issues,
        file,
        source,
        base,
        `Checklist items[${index}].id is required by the Plan renderer schema; add a stable string id.`,
      );
    }
    if (!hasRequiredStaticString(item.source, "label")) {
      addValidationIssue(
        issues,
        file,
        source,
        base,
        `Checklist items[${index}].label is required by the Plan renderer schema; add a non-empty string label.`,
      );
    }
  });
}

function checkQuestionObjectList(
  questionObjects: Array<{ source: string; start: number }>,
  listBase: number,
  tag: string,
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  questionObjects.forEach((question, questionIndex) => {
    const questionBase = listBase + question.start;
    if (!hasRequiredStaticId(question.source)) {
      addValidationIssue(
        issues,
        file,
        source,
        questionBase,
        `${tag} questions[${questionIndex}].id is required by the Plan renderer schema; add a stable string id.`,
      );
    }
    if (!hasRequiredStaticString(question.source, "title")) {
      addValidationIssue(
        issues,
        file,
        source,
        questionBase,
        `${tag} questions[${questionIndex}].title is required by the Plan renderer schema; add a non-empty string title.`,
      );
    }
    if (
      !hasRequiredEnumLiteral(question.source, "mode", [
        "single",
        "multi",
        "freeform",
      ])
    ) {
      addValidationIssue(
        issues,
        file,
        source,
        questionBase,
        `${tag} questions[${questionIndex}].mode is required by the Plan renderer schema; use "single", "multi", or "freeform".`,
      );
    }
    const options = readTopLevelObjectProperty(question.source, "options");
    if (!options) return;
    const optionObjects = extractTopLevelObjectLiterals(options.value);
    if (!optionObjects) {
      addValidationIssue(
        issues,
        file,
        source,
        questionBase + options.valueStart,
        `${tag} questions[${questionIndex}].options must be an inline array of object literals.`,
      );
      return;
    }
    optionObjects.forEach((option, optionIndex) => {
      const optionBase = questionBase + options.valueStart + option.start;
      if (!hasRequiredStaticId(option.source)) {
        addValidationIssue(
          issues,
          file,
          source,
          optionBase,
          `${tag} questions[${questionIndex}].options[${optionIndex}].id is required by the Plan renderer schema; add a stable string id.`,
        );
      }
      if (!hasRequiredStaticString(option.source, "label")) {
        addValidationIssue(
          issues,
          file,
          source,
          optionBase,
          `${tag} questions[${questionIndex}].options[${optionIndex}].label is required by the Plan renderer schema; add a non-empty string label.`,
        );
      }
    });
  });
}

function lintChecklistShape(
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const scanSource = maskCodeRegions(source);
  const re = /<Checklist\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scanSource))) {
    const start = match.index;
    const openingEnd = findJsxOpeningTagEnd(scanSource, start);
    if (openingEnd < 0) continue;
    const opening = source.slice(start, openingEnd + 1);
    const items = readJsxAttribute(opening, "items");
    if (!items) continue;
    if (items.kind !== "expression") {
      addValidationIssue(
        issues,
        file,
        source,
        start + items.start,
        "Checklist items must be an inline array expression with stable item ids.",
      );
      continue;
    }
    const objects = extractTopLevelObjectLiterals(items.value);
    if (!objects) {
      addValidationIssue(
        issues,
        file,
        source,
        start + items.start,
        "Checklist items must be an inline array of object literals so local check can validate the renderer schema.",
      );
      continue;
    }
    checkChecklistItemList(objects, start + items.start, file, source, issues);
  }
}

function lintQuestionFormShape(
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const scanSource = maskCodeRegions(source);
  const re = /<(QuestionForm|VisualQuestions)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scanSource))) {
    const start = match.index;
    const tag = match[1] ?? "QuestionForm";
    const openingEnd = findJsxOpeningTagEnd(scanSource, start);
    if (openingEnd < 0) continue;
    const opening = source.slice(start, openingEnd + 1);
    const questions = readJsxAttribute(opening, "questions");
    if (!questions) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        `${tag} requires a questions array with at least one question object.`,
      );
      continue;
    }
    if (questions.kind !== "expression") {
      addValidationIssue(
        issues,
        file,
        source,
        start + questions.start,
        `${tag} questions must be an inline array expression with stable question ids.`,
      );
      continue;
    }
    const questionObjects = extractTopLevelObjectLiterals(questions.value);
    if (!questionObjects || questionObjects.length === 0) {
      addValidationIssue(
        issues,
        file,
        source,
        start + questions.start,
        `${tag} questions must be a non-empty inline array of object literals.`,
      );
      continue;
    }
    checkQuestionObjectList(
      questionObjects,
      start + questions.start,
      tag,
      file,
      source,
      issues,
    );
  }
}

function staticStringLiteralValue(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  if (!trimmed.endsWith(quote) || trimmed.length < 2) return undefined;
  if (quote === "`" && /\$\{/.test(trimmed)) return undefined;
  return trimmed.slice(1, -1);
}

// Container blocks authored with a JSON attribute array (`<TabsBlock tabs={[…]}
// />`) carry their children as nested block objects, not top-level JSX tags, so
// the tag-based linters above never inspect them — the exact "false green" the
// renderer catches because it validates the whole parsed block tree. Walk those
// nested `blocks: [...]` arrays and enforce the same per-block required fields,
// recursing through nested containers. This is still a subset of the renderer
// schema (which is why `verify` is the authority), but it closes the common
// nested checklist / question-form / missing-id case offline.
const NESTED_CONTAINER_TAGS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: "TabsBlock", attr: "tabs" },
  { tag: "Tabs", attr: "tabs" },
  { tag: "Columns", attr: "columns" },
];

function lintNestedContainerEntry(
  entrySource: string,
  entryBase: number,
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const blocksProp = readTopLevelObjectProperty(entrySource, "blocks");
  if (!blocksProp) return;
  const blockObjects = extractTopLevelObjectLiterals(blocksProp.value);
  if (!blockObjects) return;
  const blocksBase = entryBase + blocksProp.valueStart;
  for (const block of blockObjects) {
    lintNestedBlock(
      block.source,
      blocksBase + block.start,
      file,
      source,
      issues,
    );
  }
}

function lintNestedBlock(
  blockSource: string,
  blockBase: number,
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const typeProp = readTopLevelObjectProperty(blockSource, "type");
  const type = staticStringLiteralValue(typeProp?.value);
  if (!hasRequiredStaticId(blockSource)) {
    addValidationIssue(
      issues,
      file,
      source,
      blockBase,
      `Nested ${type ?? "block"} is missing a required string \`id\`; the Plan renderer schema validates every nested block.`,
    );
  }
  const dataProp = readTopLevelObjectProperty(blockSource, "data");
  if (!dataProp) return;
  const dataBase = blockBase + dataProp.valueStart;

  if (type === "checklist") {
    const itemsProp = readTopLevelObjectProperty(dataProp.value, "items");
    if (!itemsProp) return;
    const items = extractTopLevelObjectLiterals(itemsProp.value);
    if (items) {
      checkChecklistItemList(
        items,
        dataBase + itemsProp.valueStart,
        file,
        source,
        issues,
      );
    }
    return;
  }
  // visual-questions shares question-form's schema; lint both.
  if (type === "question-form" || type === "visual-questions") {
    const questionsProp = readTopLevelObjectProperty(
      dataProp.value,
      "questions",
    );
    if (!questionsProp) return;
    const questionObjects = extractTopLevelObjectLiterals(questionsProp.value);
    if (questionObjects) {
      checkQuestionObjectList(
        questionObjects,
        dataBase + questionsProp.valueStart,
        type,
        file,
        source,
        issues,
      );
    }
    return;
  }
  if (type === "tabs" || type === "columns") {
    const innerAttr = type === "tabs" ? "tabs" : "columns";
    const innerProp = readTopLevelObjectProperty(dataProp.value, innerAttr);
    if (!innerProp) return;
    const innerEntries = extractTopLevelObjectLiterals(innerProp.value);
    if (!innerEntries) return;
    const innerBase = dataBase + innerProp.valueStart;
    for (const entry of innerEntries) {
      lintNestedContainerEntry(
        entry.source,
        innerBase + entry.start,
        file,
        source,
        issues,
      );
    }
  }
}

function lintNestedContainerBlocks(
  file: string,
  source: string,
  issues: LocalPlanValidationIssue[],
) {
  const scanSource = maskCodeRegions(source);
  for (const { tag, attr } of NESTED_CONTAINER_TAGS) {
    const re = new RegExp(`<${tag}\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(scanSource))) {
      const start = match.index;
      const openingEnd = findJsxOpeningTagEnd(scanSource, start);
      if (openingEnd < 0) continue;
      const opening = source.slice(start, openingEnd + 1);
      const attrValue = readJsxAttribute(opening, attr);
      if (!attrValue || attrValue.kind !== "expression") continue;
      const entries = extractTopLevelObjectLiterals(attrValue.value);
      if (!entries) continue;
      const entriesBase = start + attrValue.start;
      for (const entry of entries) {
        lintNestedContainerEntry(
          entry.source,
          entriesBase + entry.start,
          file,
          source,
          issues,
        );
      }
    }
  }
}

// Blank out fenced code blocks and inline code spans (preserving newlines and
// length) so block-tag linters don't trip on documentation examples written in
// prose — e.g. an inline `<WireframeBlock><Screen>...</Screen></WireframeBlock>`
// example is not a real block to validate. Real blocks (outside code) are left
// intact, so their offsets/line numbers stay correct. Without this the default
// `plan local init` scaffold fails its own `plan local check`/`serve` lint.
function maskCodeRegions(source: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return source.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

export function validateLocalPlanFiles(
  files: LocalPlanFiles,
): LocalPlanValidationIssue[] {
  const issues: LocalPlanValidationIssue[] = [];
  for (const entry of localPlanSourceEntries(files)) {
    const source = maskCodeRegions(entry.source);
    lintWireframeBlocks(entry.file, source, issues);
    lintColumnsBlocks(entry.file, source, issues);
    lintChecklistShape(entry.file, entry.source, issues);
    lintQuestionFormShape(entry.file, entry.source, issues);
    lintNestedContainerBlocks(entry.file, entry.source, issues);
  }
  return issues;
}

export function assertLocalPlanFilesValid(files: LocalPlanFiles): void {
  const issues = validateLocalPlanFiles(files);
  if (issues.length === 0) return;
  const details = issues
    .slice(0, 8)
    .map((issue) => `${issue.file}:${issue.line} ${issue.message}`)
    .join("\n");
  const overflow =
    issues.length > 8 ? `\n...plus ${issues.length - 8} more issues` : "";
  throw new Error(
    `Local plan source validation failed:\n${details}${overflow}\nRun \`npx @agent-native/core@latest plan blocks --out plan-blocks.md\` and update the MDX to the documented block shapes.`,
  );
}

export function buildLocalPlanPreviewHtml(
  input: LocalPlanPreviewInput,
): string {
  const files = readLocalPlanFiles(input.dir);
  assertLocalPlanFilesValid(files);
  const parsed = stripFrontmatter(files.planMdx);
  const title =
    input.title ||
    parsed.frontmatter.title ||
    firstHeading(parsed.body) ||
    path.basename(files.dir);
  const brief = input.brief || parsed.frontmatter.brief || "";
  const kind = input.kind || normalizeKind(parsed.frontmatter.kind);
  const blocks = splitMdxBlocks(parsed.body);
  const sourceFiles = [
    ["plan.mdx", files.planMdx],
    ["canvas.mdx", files.canvasMdx],
    ["prototype.mdx", files.prototypeMdx],
    [".plan-state.json", files.stateJson],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8fafc;
      --paper: #ffffff;
      --ink: #0f172a;
      --muted: #64748b;
      --line: #cbd5e1;
      --accent: #2563eb;
      --soft: #eff6ff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #020617;
        --paper: #0f172a;
        --ink: #e2e8f0;
        --muted: #94a3b8;
        --line: #334155;
        --soft: #172554;
      }
    }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    main { max-width: 1040px; margin: 0 auto; padding: 40px 20px 56px; }
    header { margin-bottom: 28px; }
    h1 { font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1; margin: 0 0 12px; }
    h2 { font-size: 1.35rem; margin: 28px 0 10px; }
    h3 { font-size: 1.05rem; margin: 0 0 8px; }
    p, li { line-height: 1.65; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 0.9rem; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: var(--paper); }
    .notice { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 18px 0; }
    .block, details { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin: 14px 0; }
    .component summary { cursor: pointer; color: var(--accent); font-weight: 650; }
    pre { overflow: auto; border-radius: 8px; border: 1px solid var(--line); padding: 14px; background: rgba(148, 163, 184, 0.12); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; }
    .source-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="meta">
        <span class="pill">${kind === "recap" ? "Visual recap" : "Visual plan"}</span>
        <span class="pill">Local-files mode</span>
        <span class="pill">No DB writes</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      ${brief ? `<p>${escapeHtml(brief)}</p>` : ""}
      <div class="notice">
        This preview was generated entirely from local files. It does not call
        the Plan MCP server, the Plan app action surface, a hosted service, or a
        database. Edit the MDX files and regenerate this preview to update it.
      </div>
    </header>
    <section>
      ${blocks
        .map((block) =>
          block.type === "component"
            ? `<details class="component block" open><summary>${escapeHtml(
                block.name || "MDX component",
              )}</summary><pre><code>${escapeHtml(block.value)}</code></pre></details>`
            : `<article class="block">${renderMarkdownish(block.value)}</article>`,
        )
        .join("\n")}
    </section>
    <section>
      <h2>Local Source Files</h2>
      <div class="source-tabs">
        ${sourceFiles
          .map(
            ([name, source]) =>
              `<details><summary>${escapeHtml(name)}</summary><pre><code>${escapeHtml(
                source,
              )}</code></pre></details>`,
          )
          .join("\n")}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

export function writeLocalPlanPreview(input: {
  dir: string;
  out?: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
  appUrl?: string;
  open?: boolean;
  openUrl?: (url: string) => OpenLocalUrlResult;
}): LocalPlanPreviewResult {
  const dir = path.resolve(input.dir);
  const files = readLocalPlanFiles(dir);
  assertLocalPlanFilesValid(files);
  const parsed = stripFrontmatter(files.planMdx);
  const kind = input.kind || normalizeKind(parsed.frontmatter.kind);
  const title =
    input.title ||
    parsed.frontmatter.title ||
    firstHeading(parsed.body) ||
    path.basename(dir);
  const out = input.out ? path.resolve(input.out) : undefined;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildLocalPlanPreviewHtml({ ...input, dir, kind }));
  }
  const result: LocalPlanPreviewResult = {
    ok: true,
    dir,
    ...(out ? { out } : {}),
    url: out ? pathToFileURL(out).href : localPlanPreviewUrl(dir, input.appUrl),
    title,
    kind,
    files: localPlanFileList(files),
  };
  if (!input.open) return result;

  const openResult = (input.openUrl || openLocalUrl)(result.url);
  return {
    ...result,
    opened: openResult.ok,
    openCommand: openResult.command,
    ...(openResult.error ? { openError: openResult.error } : {}),
  };
}

function readLocalPlanBridgeComments(dir: string): LocalPlanBridgeComment[] {
  try {
    const raw = fs.readFileSync(
      path.join(dir, LOCAL_PLAN_COMMENTS_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as LocalPlanBridgeComment[]).filter(
          (comment) => comment && typeof comment.id === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeLocalPlanBridgeComments(
  dir: string,
  comments: LocalPlanBridgeComment[],
): void {
  const target = path.join(dir, LOCAL_PLAN_COMMENTS_FILE);
  if (comments.length === 0) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.writeFileSync(target, `${JSON.stringify(comments, null, 2)}\n`, "utf-8");
}

function normalizeBridgeCommentString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBridgeCommentNullableString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeBridgeCommentStatus(value: unknown): string {
  return value === "resolved" ? "resolved" : "open";
}

function newLocalBridgeCommentId(): string {
  return `cmt_${crypto.randomBytes(8).toString("hex")}`;
}

function applyLocalPlanBridgeCommentUpdate(
  dir: string,
  update: LocalPlanBridgeCommentUpdate,
): LocalPlanBridgeComment[] {
  const existing = readLocalPlanBridgeComments(dir);
  const byId = new Map(existing.map((comment) => [comment.id, comment]));
  const now = new Date().toISOString();
  const planId = `local-${path.basename(dir)}`;

  for (const input of update.comments ?? []) {
    const id =
      normalizeBridgeCommentNullableString(input.id) ??
      newLocalBridgeCommentId();
    const prev = byId.get(id);
    const status = normalizeBridgeCommentStatus(input.status ?? prev?.status);
    const message =
      typeof input.message === "string" ? input.message : prev?.message;
    if (!message?.trim()) continue;

    if (prev) {
      byId.set(id, {
        ...prev,
        parentCommentId:
          normalizeBridgeCommentNullableString(input.parentCommentId) ??
          prev.parentCommentId,
        sectionId:
          normalizeBridgeCommentNullableString(input.sectionId) ??
          prev.sectionId,
        kind: normalizeBridgeCommentString(input.kind, prev.kind),
        status,
        anchor:
          typeof input.anchor === "string" || input.anchor === null
            ? input.anchor
            : prev.anchor,
        message,
        authorEmail:
          normalizeBridgeCommentNullableString(input.authorEmail) ??
          prev.authorEmail,
        authorName:
          normalizeBridgeCommentNullableString(input.authorName) ??
          prev.authorName,
        resolutionTarget: "agent",
        mentions: [],
        mentionsJson: null,
        resolvedAt:
          status === "resolved"
            ? (input.resolvedAt ?? prev.resolvedAt ?? now)
            : null,
        resolvedBy:
          status === "resolved"
            ? (input.resolvedBy ?? prev.resolvedBy ?? LOCAL_PLAN_OWNER_EMAIL)
            : null,
        updatedAt: now,
      });
      continue;
    }

    byId.set(id, {
      id,
      planId,
      parentCommentId: normalizeBridgeCommentNullableString(
        input.parentCommentId,
      ),
      sectionId: normalizeBridgeCommentNullableString(input.sectionId),
      kind: normalizeBridgeCommentString(input.kind, "annotation"),
      status,
      anchor: normalizeBridgeCommentNullableString(input.anchor),
      message,
      createdBy: "human",
      authorEmail:
        normalizeBridgeCommentNullableString(input.authorEmail) ??
        LOCAL_PLAN_OWNER_EMAIL,
      authorName: normalizeBridgeCommentNullableString(input.authorName),
      resolutionTarget: "agent",
      mentions: [],
      mentionsJson: null,
      resolvedBy: status === "resolved" ? LOCAL_PLAN_OWNER_EMAIL : null,
      resolvedAt: status === "resolved" ? now : null,
      consumedAt: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const id of update.deletedCommentIds ?? []) {
    byId.delete(id);
    for (const comment of byId.values()) {
      if (comment.parentCommentId === id) byId.delete(comment.id);
    }
  }

  const comments = [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt),
  );
  writeLocalPlanBridgeComments(dir, comments);
  return comments;
}

function buildLocalPlanBridgePayload(input: {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
  // `verify` brings the bridge up only to exercise transport + the authoritative
  // renderer check, so it must not be short-circuited by the weaker offline lint.
  skipSourceValidation?: boolean;
}): LocalPlanBridgePayload {
  const dir = path.resolve(input.dir);
  const files = readLocalPlanFiles(dir);
  if (!input.skipSourceValidation) assertLocalPlanFilesValid(files);
  const parsed = stripFrontmatter(files.planMdx);
  const kind = input.kind || normalizeKind(parsed.frontmatter.kind);
  const title =
    input.title ||
    parsed.frontmatter.title ||
    firstHeading(parsed.body) ||
    path.basename(dir);
  const brief = input.brief || parsed.frontmatter.brief || "";
  const comments = readLocalPlanBridgeComments(dir);

  return {
    ok: true,
    version: 1,
    source: "agent-native-local-bridge",
    localOnly: true,
    slug: path.basename(dir),
    dir,
    title,
    brief,
    kind,
    updatedAt: latestLocalPlanMtime(dir, files),
    files: localPlanFileList(files),
    mdx: localPlanMdxFolder(files),
    comments,
  };
}

function latestLocalPlanMtime(dir: string, files: LocalPlanFiles): string {
  const candidates = [
    path.join(dir, "plan.mdx"),
    ...(files.canvasMdx ? [path.join(dir, "canvas.mdx")] : []),
    ...(files.prototypeMdx ? [path.join(dir, "prototype.mdx")] : []),
    ...(files.stateJson ? [path.join(dir, ".plan-state.json")] : []),
    path.join(dir, LOCAL_PLAN_COMMENTS_FILE),
    ...Object.keys(files.assets ?? {}).map((filename) =>
      path.join(dir, "assets", filename),
    ),
  ];
  let latest = 0;
  for (const file of candidates) {
    try {
      latest = Math.max(latest, fs.statSync(file).mtimeMs);
    } catch {
      // Ignore files deleted between the read and stat passes.
    }
  }
  return new Date(latest || Date.now()).toISOString();
}

function sendBridgeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    // Required when the hosted HTTPS Plan UI fetches this localhost bridge.
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-agent-native-local-bridge": "1",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBridgeJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > LOCAL_PLAN_BRIDGE_COMMENT_BODY_LIMIT) {
        reject(new Error("Local plan comment update is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Local plan comment update must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeBridgeCommentUpdatePayload(
  payload: unknown,
): LocalPlanBridgeCommentUpdate {
  if (!payload || typeof payload !== "object") return {};
  const input = payload as LocalPlanBridgeCommentUpdate;
  return {
    comments: Array.isArray(input.comments) ? input.comments : [],
    deletedCommentIds: Array.isArray(input.deletedCommentIds)
      ? input.deletedCommentIds.filter((id) => typeof id === "string")
      : [],
  };
}

function bridgeRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url || "/", "http://127.0.0.1");
}

function bridgeHostForUrl(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

export async function startLocalPlanBridge(input: {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
  appUrl?: string;
  host?: string;
  port?: number;
  token?: string;
  open?: boolean;
  urlFile?: string | false;
  openUrl?: (url: string) => OpenLocalUrlResult;
  skipSourceValidation?: boolean;
}): Promise<LocalPlanBridgeServer> {
  const dir = path.resolve(input.dir);
  const initialPayload = buildLocalPlanBridgePayload({
    dir,
    kind: input.kind,
    title: input.title,
    brief: input.brief,
    skipSourceValidation: input.skipSourceValidation,
  });
  const token = input.token || crypto.randomBytes(24).toString("base64url");
  const host = input.host || "127.0.0.1";
  const appUrl = normalizeBridgeAppUrl(input.appUrl);
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      sendBridgeJson(res, 204, "");
      return;
    }

    const url = bridgeRequestUrl(req);
    if (
      url.pathname !== "/local-plan.json" &&
      url.pathname !== "/local-plan-comments.json"
    ) {
      sendBridgeJson(res, 404, { ok: false, error: "Not found." });
      return;
    }
    if (url.searchParams.get("token") !== token) {
      sendBridgeJson(res, 403, { ok: false, error: "Invalid bridge token." });
      return;
    }
    if (url.pathname === "/local-plan.json" && req.method !== "GET") {
      sendBridgeJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }
    if (url.pathname === "/local-plan-comments.json" && req.method !== "POST") {
      sendBridgeJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    void (async () => {
      try {
        if (url.pathname === "/local-plan-comments.json") {
          const body = await readBridgeJsonBody(req);
          applyLocalPlanBridgeCommentUpdate(
            dir,
            normalizeBridgeCommentUpdatePayload(body),
          );
        }
        sendBridgeJson(
          res,
          200,
          buildLocalPlanBridgePayload({
            dir,
            kind: input.kind,
            title: input.title,
            brief: input.brief,
            skipSourceValidation: input.skipSourceValidation,
          }),
        );
      } catch (error) {
        sendBridgeJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(input.port ?? 0, host);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Local plan bridge did not bind to a TCP port.");
  }

  const bridgeUrl = `http://${bridgeHostForUrl(host)}:${address.port}/local-plan.json?token=${encodeURIComponent(
    token,
  )}`;
  const url = localPlanBridgePageUrl({ dir, bridgeUrl, appUrl });
  const urlFile =
    input.urlFile === false
      ? undefined
      : writeLocalPlanUrlFile(dir, url, input.urlFile);
  const openResult = input.open
    ? (input.openUrl || openLocalUrl)(url)
    : undefined;

  return {
    server,
    result: {
      ok: true,
      dir,
      url,
      ...(urlFile ? { urlFile } : {}),
      bridgeUrl,
      appUrl,
      title: initialPayload.title,
      kind: initialPayload.kind,
      files: initialPayload.files,
      host,
      port: address.port,
      ...(openResult
        ? {
            opened: openResult.ok,
            openCommand: openResult.command,
            ...(openResult.error ? { openError: openResult.error } : {}),
          }
        : {}),
    },
  };
}

function localPlanBridgeWarnings(input: {
  appUrl: string;
  bridgeUrl: string;
}): string[] {
  const warnings: string[] = [];
  try {
    const appUrl = new URL(input.appUrl);
    const bridgeUrl = new URL(input.bridgeUrl);
    if (appUrl.protocol === "https:" && bridgeUrl.protocol === "http:") {
      warnings.push(
        "Safari may block the hosted HTTPS Plan UI from reading the HTTP localhost bridge. Use Chrome/Chromium/Edge, or pass --app-url http://localhost:8096 when running a local Plan app.",
      );
    }
  } catch {
    // The URLs were normalized earlier; ignore defensive parse failures.
  }
  return warnings;
}

const VALIDATE_LOCAL_PLAN_ACTION = "validate-local-plan-source";

/**
 * Ask the Plan app to validate the folder against its real renderer schema
 * (`parsePlanMdxFolder` + `planContentSchema`) via the public, no-DB
 * `validate-local-plan-source` action. This is what makes `verify`
 * authoritative: the hand-rolled `check` lint can disagree with the renderer,
 * but this runs the renderer's own parser. Degrades gracefully (`ran: false`)
 * when the endpoint is unreachable or a Plan app predates the action, so an
 * old deploy never turns into a hard failure.
 */
export async function fetchRendererValidation(input: {
  appUrl: string;
  files: LocalPlanFiles;
  fetchFn?: typeof fetch;
}): Promise<RendererValidation> {
  const fetchFn = input.fetchFn ?? fetch;
  const endpoint = planActionEndpoint(input.appUrl, VALIDATE_LOCAL_PLAN_ACTION);
  try {
    const response = await fetchActionWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ mdx: localPlanMdxFolder(input.files) }),
      },
      fetchFn,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ran: false,
        endpoint,
        error: `${VALIDATE_LOCAL_PLAN_ACTION} failed ${response.status} ${
          response.statusText
        }: ${sanitizeHttpDetail(detail, 300)}`,
      };
    }
    const json = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { result?: Record<string, unknown> })
      | null;
    const body =
      json && isRecord(json.result) ? json.result : (json ?? undefined);
    if (!body || typeof body.valid !== "boolean") {
      return {
        ran: false,
        endpoint,
        error: `${VALIDATE_LOCAL_PLAN_ACTION} returned an unexpected payload.`,
      };
    }
    const issues = Array.isArray(body.issues)
      ? body.issues.filter(isRecord).map((issue) => ({
          path: typeof issue.path === "string" ? issue.path : "",
          message:
            typeof issue.message === "string" ? issue.message : "Invalid value",
        }))
      : [];
    return { ran: true, endpoint, valid: body.valid, issues };
  } catch (err) {
    return {
      ran: false,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function rendererValidationWarnings(
  validation: RendererValidation,
  offlineIssues: LocalPlanValidationIssue[],
): string[] {
  if (!validation.ran) {
    const base = `Plan content was NOT validated against the renderer schema (${
      validation.error ?? "validate endpoint unavailable"
    }). Fell back to the offline lint. Run against a Plan app that exposes ${VALIDATE_LOCAL_PLAN_ACTION} (e.g. --app-url http://localhost:8096) for authoritative validation.`;
    if (offlineIssues.length === 0) return [base];
    const preview = offlineIssues
      .slice(0, 8)
      .map((issue) => `${issue.file}:${issue.line} ${issue.message}`)
      .join("; ");
    const overflow =
      offlineIssues.length > 8 ? ` (+${offlineIssues.length - 8} more)` : "";
    return [base, `Offline lint rejected this plan: ${preview}${overflow}`];
  }
  if (validation.valid) return [];
  const issues = validation.issues ?? [];
  const preview = issues
    .slice(0, 8)
    .map((issue) =>
      issue.path ? `${issue.path}: ${issue.message}` : issue.message,
    )
    .join("; ");
  const overflow = issues.length > 8 ? ` (+${issues.length - 8} more)` : "";
  return [
    `Renderer schema rejected this plan — it will not render. ${preview}${overflow}`,
  ];
}

export async function verifyLocalPlanBridge(input: {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
  appUrl?: string;
  host?: string;
  port?: number;
  token?: string;
  urlFile?: string | false;
  fetchFn?: typeof fetch;
}): Promise<LocalPlanVerifyResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const files = readLocalPlanFiles(input.dir);
  const bridge = await startLocalPlanBridge({
    dir: input.dir,
    kind: input.kind,
    title: input.title,
    brief: input.brief,
    appUrl: input.appUrl,
    host: input.host,
    port: input.port,
    token: input.token,
    urlFile: input.urlFile,
    // Don't let the weaker offline lint abort the bridge before the authoritative
    // renderer check runs — verify reports the renderer's verdict, not the lint's.
    skipSourceValidation: true,
  });

  try {
    const preflight = await fetchFn(bridge.result.bridgeUrl, {
      method: "OPTIONS",
      headers: {
        origin: bridge.result.appUrl,
        "access-control-request-method": "GET",
        "access-control-request-private-network": "true",
      },
    });
    const response = await fetchFn(bridge.result.bridgeUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as
      | (LocalPlanBridgePayload & { mdx?: LocalPlanBridgeMdxFolder })
      | null;
    const mdxFiles = payload?.mdx
      ? Object.keys(payload.mdx).filter((file) => file !== "assets/")
      : undefined;
    const bridgeOk =
      response.ok &&
      payload?.ok === true &&
      payload.source === "agent-native-local-bridge" &&
      payload.localOnly === true &&
      Boolean(payload.mdx?.["plan.mdx"]);
    const preflightOk =
      preflight.status === 204 &&
      preflight.headers.get("access-control-allow-origin") === "*" &&
      preflight.headers.get("access-control-allow-private-network") === "true";
    const validation = await fetchRendererValidation({
      appUrl: bridge.result.appUrl,
      files,
      fetchFn,
    });
    // The renderer's verdict is authoritative and gates `ok`. When it could not
    // run (old/unreachable Plan app), fall back to the offline lint as the
    // content signal so verify still catches the common cases offline instead
    // of silently passing unvalidated content.
    const offlineIssues = validation.ran ? [] : validateLocalPlanFiles(files);
    const contentOk = validation.ran
      ? validation.valid === true
      : offlineIssues.length === 0;
    return {
      ok: bridgeOk && preflightOk && contentOk,
      dir: bridge.result.dir,
      url: bridge.result.url,
      ...(bridge.result.urlFile ? { urlFile: bridge.result.urlFile } : {}),
      bridgeUrl: bridge.result.bridgeUrl,
      appUrl: bridge.result.appUrl,
      title: bridge.result.title,
      kind: bridge.result.kind,
      files: bridge.result.files,
      preflight: {
        status: preflight.status,
        allowOrigin: preflight.headers.get("access-control-allow-origin"),
        allowPrivateNetwork: preflight.headers.get(
          "access-control-allow-private-network",
        ),
      },
      bridge: {
        status: response.status,
        ok: bridgeOk,
        ...(payload?.source ? { source: payload.source } : {}),
        ...(typeof payload?.localOnly === "boolean"
          ? { localOnly: payload.localOnly }
          : {}),
        ...(Array.isArray(payload?.files) ? { files: payload.files } : {}),
        ...(mdxFiles ? { mdxFiles } : {}),
        ...(payload?.error ? { error: payload.error } : {}),
      },
      validation,
      warnings: [
        ...localPlanBridgeWarnings({
          appUrl: bridge.result.appUrl,
          bridgeUrl: bridge.result.bridgeUrl,
        }),
        ...rendererValidationWarnings(validation, offlineIssues),
      ],
    };
  } finally {
    await new Promise<void>((resolve) => bridge.server.close(() => resolve()));
  }
}

function writeLocalPlanSkeleton(input: {
  dir?: string;
  title: string;
  brief?: string;
  kind: LocalPlanKind;
  force?: boolean;
}): { ok: true; dir: string; files: string[] } {
  const dir = path.resolve(
    input.dir || path.join(defaultPlansDir(), localPlanFolderName(input.title)),
  );
  const planPath = path.join(dir, "plan.mdx");
  if (fs.existsSync(planPath) && !input.force) {
    throw new Error(
      `${planPath} already exists. Pass --force to replace the skeleton.`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const title = input.title;
  const brief =
    input.brief ||
    (input.kind === "recap"
      ? "Local visual recap generated without Plan app database writes."
      : "Local visual plan generated without Plan app database writes.");
  const mdx = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `brief: "${brief.replace(/"/g, '\\"')}"`,
    `kind: "${input.kind}"`,
    "localOnly: true",
    "---",
    "",
    `# ${title}`,
    "",
    brief,
    "",
    "## Review Surface",
    "",
    "Author the structured plan or recap here. You can add Agent-Native Plan MDX",
    'blocks such as `<WireframeBlock><Screen surface="browser">...</Screen></WireframeBlock>`,',
    "`<Diagram />`, `<TabsBlock />`, `<FileTree />`, or `<Diff />`; the local",
    "preview will show the source without publishing it to the Plan app.",
    "",
  ].join("\n");
  fs.writeFileSync(planPath, mdx, "utf-8");
  fs.writeFileSync(
    path.join(dir, ".plan-state.json"),
    JSON.stringify(
      {
        localOnly: true,
        kind: input.kind,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  return { ok: true, dir, files: ["plan.mdx", ".plan-state.json"] };
}

function runInit(args: Record<string, string | boolean>): void {
  const title = optionalArg(args, "title") || "Untitled local visual plan";
  const result = writeLocalPlanSkeleton({
    dir: optionalArg(args, "dir"),
    title,
    brief: optionalArg(args, "brief"),
    kind: normalizeKind(optionalArg(args, "kind")),
    force: boolArg(args, "force"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runCheck(args: Record<string, string | boolean>): void {
  const dir = stringArg(args, "dir");
  const files = readLocalPlanFiles(dir);
  assertLocalPlanFilesValid(files);
  const parsed = stripFrontmatter(files.planMdx);
  const result = {
    ok: true,
    noDb: true,
    validation: "lint-passed",
    validationScope: "offline-lint",
    note: "Quick offline lint only — NOT the full Plan renderer schema. A green here does not guarantee the plan renders. Run `plan local verify` against a Plan app for authoritative validation before handing off.",
    dir: files.dir,
    title: parsed.frontmatter.title || firstHeading(parsed.body),
    kind: normalizeKind(parsed.frontmatter.kind),
    files: {
      "plan.mdx": Buffer.byteLength(files.planMdx),
      ...(files.canvasMdx
        ? { "canvas.mdx": Buffer.byteLength(files.canvasMdx) }
        : {}),
      ...(files.prototypeMdx
        ? { "prototype.mdx": Buffer.byteLength(files.prototypeMdx) }
        : {}),
      ...(files.stateJson
        ? { ".plan-state.json": Buffer.byteLength(files.stateJson) }
        : {}),
      ...(files.assets
        ? Object.fromEntries(
            Object.entries(files.assets).map(([filename, base64]) => [
              `assets/${filename}`,
              Buffer.byteLength(base64, "base64"),
            ]),
          )
        : {}),
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function readVisualAnswerSourcePayload(
  sourcePath: string,
): VisualAnswerSourcePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Could not read ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath} must contain a JSON object.`);
  }
  const source = parsed as Record<string, unknown>;
  const mdx = source.mdx;
  if (!mdx || typeof mdx !== "object" || Array.isArray(mdx)) {
    throw new Error(`${sourcePath} must contain an mdx object.`);
  }
  const planMdx = (mdx as Record<string, unknown>)["plan.mdx"];
  if (typeof planMdx !== "string" || planMdx.trim().length === 0) {
    throw new Error(
      `${sourcePath} mdx["plan.mdx"] must be a non-empty string.`,
    );
  }
  return source as VisualAnswerSourcePayload;
}

export async function publishVisualAnswerSource(
  input: PublishVisualAnswerInput,
): Promise<{ ok: true; url: string; out: string }> {
  const cwd = input.cwd ?? process.cwd();
  const sourcePath =
    input.sourcePath ?? path.join(cwd, VISUAL_ANSWER_SOURCE_FILENAME);
  const out = input.out ?? path.join(cwd, VISUAL_ANSWER_URL_FILENAME);
  const token = input.token.trim();
  if (!token) throw new Error("Plan publish token is empty.");

  const source = readVisualAnswerSourcePayload(sourcePath);
  const question = input.question ?? source.question;
  if (!question?.trim()) {
    throw new Error(
      `Missing visual answer question. Pass --question or set question in ${sourcePath}.`,
    );
  }
  const body = {
    question,
    ...(input.prevPlanId ? { planId: input.prevPlanId } : {}),
    ...(source.title ? { title: source.title } : {}),
    ...(source.brief ? { brief: source.brief } : {}),
    visibility: input.visibility ?? "org",
    source: "imported",
    ...((input.repo ?? source.repoPath)
      ? { repoPath: input.repo ?? source.repoPath }
      : {}),
    ...((input.sourceUrl ?? source.sourceUrl)
      ? { sourceUrl: input.sourceUrl ?? source.sourceUrl }
      : {}),
    sourceType: normalizeVisualAnswerSourceType(
      input.sourceType ?? source.sourceType,
    ),
    currentFocus: `visual answer: ${question.trim().slice(0, 120)}`,
    status: "review",
    mdx: source.mdx,
  };

  const endpoint = planActionEndpoint(input.appUrl, "visual-answer");
  const fetchFn = input.fetchFn ?? fetch;
  const response = await fetchActionWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    fetchFn,
  );
  const text = await response.text().catch((error) => String(error));
  if (!response.ok) {
    throw new Error(
      `visual-answer failed ${response.status} ${
        response.statusText
      }: ${sanitizeHttpDetail(text, 800)}`,
    );
  }
  let result: unknown = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("visual-answer returned non-JSON output.");
  }
  const url = visualAnswerUrlFromPublishResult(result, input.appUrl);
  if (!url) {
    throw new Error(
      "visual-answer succeeded but did not return a usable /plans/<id> URL or plan id.",
    );
  }
  fs.writeFileSync(path.resolve(out), `${url}\n`, "utf-8");
  return { ok: true, url, out };
}

async function runVisualAnswer(
  subcommand: string | undefined,
  args: Record<string, string | boolean>,
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "help" ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    args.help === true ||
    args.h === true
  ) {
    process.stdout.write(HELP);
    return;
  }
  if (subcommand !== "publish") {
    process.stderr.write(
      `Unknown plan visual-answer subcommand: ${subcommand}\n${HELP}`,
    );
    process.exit(1);
  }
  const appUrl =
    optionalArg(args, "app-url") ||
    process.env.PLAN_VISUAL_ANSWER_APP_URL ||
    process.env.PLAN_RECAP_APP_URL ||
    DEFAULT_PLAN_APP_URL;
  const token =
    optionalArg(args, "token") ||
    process.env.PLAN_VISUAL_ANSWER_TOKEN ||
    process.env.PLAN_RECAP_TOKEN ||
    "";
  try {
    const result = await publishVisualAnswerSource({
      appUrl,
      token,
      question: optionalArg(args, "question"),
      sourcePath: optionalArg(args, "source") ?? VISUAL_ANSWER_SOURCE_FILENAME,
      out: optionalArg(args, "out") ?? VISUAL_ANSWER_URL_FILENAME,
      prevPlanId: optionalArg(args, "prev-plan-id"),
      repo: optionalArg(args, "repo"),
      sourceUrl: optionalArg(args, "source-url"),
      sourceType: optionalArg(args, "source-type"),
      visibility: normalizeVisibility(optionalArg(args, "visibility")),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    process.exit(1);
  }
}

function runPreview(args: Record<string, string | boolean>): void {
  const result = writeLocalPlanPreview({
    dir: stringArg(args, "dir"),
    out: optionalArg(args, "out"),
    appUrl: optionalArg(args, "app-url"),
    title: optionalArg(args, "title"),
    brief: optionalArg(args, "brief"),
    open: boolArg(args, "open"),
    kind: optionalArg(args, "kind")
      ? normalizeKind(optionalArg(args, "kind"))
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runServe(args: Record<string, string | boolean>): Promise<void> {
  const portValue = optionalArg(args, "port");
  const port = portValue ? Number(portValue) : undefined;
  if (portValue && (!Number.isInteger(port) || port! < 0 || port! > 65535)) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  const bridge = await startLocalPlanBridge({
    dir: stringArg(args, "dir"),
    appUrl: optionalArg(args, "app-url"),
    title: optionalArg(args, "title"),
    brief: optionalArg(args, "brief"),
    host: optionalArg(args, "host"),
    port,
    open: boolArg(args, "open"),
    urlFile: optionalArg(args, "url-file") || optionalArg(args, "out"),
    kind: optionalArg(args, "kind")
      ? normalizeKind(optionalArg(args, "kind"))
      : undefined,
  });

  process.stdout.write(`${JSON.stringify(bridge.result, null, 2)}\n`);
  process.stderr.write(
    [
      `Local Plan bridge running at ${bridge.result.bridgeUrl}`,
      bridge.result.urlFile
        ? `Open URL written to ${bridge.result.urlFile}`
        : "",
      ...localPlanBridgeWarnings({
        appUrl: bridge.result.appUrl,
        bridgeUrl: bridge.result.bridgeUrl,
      }),
      "Press Ctrl+C to stop.",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );

  await new Promise<void>((resolve) => {
    let stopped = false;
    const cleanup = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      bridge.server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runVerify(
  args: Record<string, string | boolean>,
): Promise<void> {
  const portValue = optionalArg(args, "port");
  const port = portValue ? Number(portValue) : undefined;
  if (portValue && (!Number.isInteger(port) || port! < 0 || port! > 65535)) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  const result = await verifyLocalPlanBridge({
    dir: stringArg(args, "dir"),
    appUrl: optionalArg(args, "app-url"),
    title: optionalArg(args, "title"),
    brief: optionalArg(args, "brief"),
    host: optionalArg(args, "host"),
    port,
    urlFile: optionalArg(args, "url-file") || optionalArg(args, "out") || false,
    kind: optionalArg(args, "kind")
      ? normalizeKind(optionalArg(args, "kind"))
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}

async function runBlocks(
  args: Record<string, string | boolean>,
): Promise<void> {
  const format = normalizePlanBlockFormat(optionalArg(args, "format"));
  const appUrl =
    optionalArg(args, "app-url") ||
    process.env.PLAN_BLOCKS_APP_URL ||
    process.env.PLAN_RECAP_APP_URL ||
    DEFAULT_PLAN_APP_URL;
  const out = optionalArg(args, "out") || defaultPlanBlocksOut(format);
  const useClack = Boolean(process.stdout.isTTY) && !boolArg(args, "json");
  let stopSpinner: ((message?: string) => void) | undefined;
  let clack: typeof import("@clack/prompts") | undefined;

  if (useClack) {
    clack = await import("@clack/prompts");
    const spinner = clack.spinner();
    spinner.start("Fetching Plan block catalog");
    stopSpinner = (message?: string) => spinner.stop(message);
  }

  try {
    const result = await fetchPlanBlockCatalog({
      appUrl,
      format,
      out,
    });
    if (!useClack || !clack) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    stopSpinner?.("Fetched Plan block catalog");
    clack.note(
      [
        `Output   ${path.resolve(result.out)}`,
        `Format   ${result.format}`,
        typeof result.count === "number" ? `Blocks   ${result.count}` : "",
        "Privacy  No plan content sent",
      ]
        .filter(Boolean)
        .join("\n"),
      "Plan block catalog",
    );
    clack.outro(`Wrote ${result.out}`);
  } catch (error) {
    if (useClack && clack) {
      stopSpinner?.("Plan block catalog fetch failed");
      clack.cancel(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    throw error;
  }
}

const HELP = `agent-native plan — local Agent-Native Plan helpers

Usage:
  agent-native plan blocks [--format reference|schema] [--app-url <url>] [--out <file>] [--json]
  agent-native plan visual-answer publish --question <text> [--source visual-answer-source.json] [--out visual-answer-url.txt] [--repo owner/name] [--source-url <url>] [--app-url <url>] [--token <planToken>]
  agent-native plan serve --dir <folder> [--app-url <url>] [--kind plan|recap] [--open] [--port <port>] [--url-file <file>]
  agent-native plan local init --title <title> [--brief <text>] [--kind plan|recap] [--dir <folder>] [--force]
  agent-native plan local check --dir <folder>
  agent-native plan local serve --dir <folder> [--app-url <url>] [--kind plan|recap] [--open] [--port <port>] [--url-file <file>]
  agent-native plan local verify --dir <folder> [--app-url <url>] [--kind plan|recap] [--port <port>]
  agent-native plan local preview --dir <folder> [--app-url <url>] [--kind plan|recap] [--open] [--out preview.html]

The blocks command fetches the no-auth, read-only get-plan-blocks catalog from
the Plan app and writes plan-blocks.md (or plan-blocks.schema.json). It sends no
plan content and is safe for local-files authoring before writing MDX. It uses a
clack UI in interactive terminals and prints JSON for non-interactive shells or
when --json is passed.

The visual-answer publish command sends a coding-agent-authored
visual-answer-source.json file to the Plan app's visual-answer action and writes
visual-answer-url.txt. The source file should contain a question, optional
title/brief/repoPath/sourceUrl, and MDX files under mdx. It is the terminal
handoff for /visual-answer workflows after a coding agent has inspected code via
the local repo, the Plan bridge, or GitHub and authored structured Plan blocks.

The local subcommands are the privacy-focused no-DB path. They only read and
write local files: plan.mdx, optional canvas.mdx, optional prototype.mdx, and
optional .plan-state.json. They do not call the Plan MCP server, the Plan app
write actions, hosted storage, or SQLite.

Common flow:
  agent-native plan blocks --out plan-blocks.md
  agent-native plan local init --title "Checkout review" --kind plan
  agent-native plan local serve --dir plans/checkout-review --open

\`plan local serve\` starts a tiny localhost bridge and opens the hosted Plan UI
against that local-only source. The hosted app fetches the MDX from localhost in
the browser; it does not write plan content to the hosted database. The served
URL is written to \`.plan-url\` by default; pass \`--url-file\` to choose a
different local-only file. On macOS, \`--open\` prefers Chromium browsers because
Safari may block the hosted HTTPS page from reading the HTTP localhost bridge.
Use \`plan local verify\` for headless bridge/CORS diagnostics that exit cleanly.
Use \`plan local preview\` for a local Plan dev server route. \`preview --out\` is
a legacy/debug escape hatch that writes a standalone static HTML file.
\`plan serve\` is kept as a compatibility alias for \`plan local serve\`.
`;

export async function runPlan(argv: string[]): Promise<void> {
  const [area, sub, ...rest] = argv;
  if (area === "blocks") {
    await runBlocks(parseArgs(argv.slice(1)));
    return;
  }
  if (area === "serve") {
    const args = parseArgs(argv.slice(1));
    if (args.help === true || args.h === true) {
      process.stdout.write(HELP);
      return;
    }
    await runServe(args);
    return;
  }
  if (area === "visual-answer") {
    await runVisualAnswer(sub, parseArgs(rest));
    return;
  }
  if (area !== "local") {
    // Bare `agent-native plan` / `plan help` / `plan --help` → show help on
    // stdout and exit 0 (informational, not an error).
    if (
      area === undefined ||
      area === "help" ||
      area === "--help" ||
      area === "-h"
    ) {
      process.stdout.write(HELP);
      return;
    }
    // A non-empty, unrecognised area (e.g. `agent-native plan lokal`) is an
    // error: print to stderr so the CI log captures it, and exit 1 so callers
    // can detect the failure. This mirrors the existing behaviour for unknown
    // subcommands inside `plan local`.
    process.stderr.write(`Unknown plan area: ${area}\n${HELP}`);
    process.exit(1);
  }
  const args = parseArgs(rest);
  // `plan local <sub> --help` / `-h` shows help instead of running the
  // subcommand (e.g. `plan local init --help` must not scaffold a folder).
  if (args.help === true || args.h === true) {
    process.stdout.write(HELP);
    return;
  }
  switch (sub) {
    case "init":
      runInit(args);
      return;
    case "check":
      runCheck(args);
      return;
    case "preview":
      runPreview(args);
      return;
    case "serve":
      await runServe(args);
      return;
    case "verify":
      await runVerify(args);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP);
      return;
    default:
      process.stderr.write(`Unknown plan local subcommand: ${sub}\n${HELP}`);
      process.exit(1);
  }
}
