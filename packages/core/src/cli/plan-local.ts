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

import fs from "node:fs";
import crypto from "node:crypto";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_PLAN_APP_URL,
  defaultPlanBlocksOut,
  fetchPlanBlockCatalog,
  normalizePlanBlockFormat,
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
};

export type LocalPlanServeResult = {
  ok: true;
  dir: string;
  url: string;
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

type OpenLocalUrlResult = {
  ok: boolean;
  command: string;
  error?: string;
};

const LOCAL_PLAN_ASSET_MAX_SINGLE_BYTES = 2 * 1024 * 1024;
const LOCAL_PLAN_ASSET_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
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

function defaultPlansDir(): string {
  return path.resolve(process.env.PLAN_LOCAL_DIR || "plans");
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
  return `${normalizeAppUrl(appUrl)}/local-plans/${encodeURIComponent(
    path.basename(path.resolve(dir)),
  )}`;
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

function openLocalUrl(url: string): OpenLocalUrlResult {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
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
    const opening = scanSource.slice(start, openingEnd + 1);
    if (/\bcolumns\s*=/.test(opening)) {
      addValidationIssue(
        issues,
        file,
        source,
        start,
        'Columns must use <Column> children, not a columns= prop. Use <Columns><Column label="Before">...</Column><Column label="After">...</Column></Columns>.',
      );
    }
  }
}

export function validateLocalPlanFiles(
  files: LocalPlanFiles,
): LocalPlanValidationIssue[] {
  const issues: LocalPlanValidationIssue[] = [];
  for (const entry of localPlanSourceEntries(files)) {
    lintWireframeBlocks(entry.file, entry.source, issues);
    lintColumnsBlocks(entry.file, entry.source, issues);
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

function buildLocalPlanBridgePayload(input: {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
}): LocalPlanBridgePayload {
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
  const brief = input.brief || parsed.frontmatter.brief || "";

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
  };
}

function latestLocalPlanMtime(dir: string, files: LocalPlanFiles): string {
  const candidates = [
    path.join(dir, "plan.mdx"),
    ...(files.canvasMdx ? [path.join(dir, "canvas.mdx")] : []),
    ...(files.prototypeMdx ? [path.join(dir, "prototype.mdx")] : []),
    ...(files.stateJson ? [path.join(dir, ".plan-state.json")] : []),
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-agent-native-local-bridge": "1",
  });
  res.end(`${JSON.stringify(payload)}\n`);
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
  openUrl?: (url: string) => OpenLocalUrlResult;
}): Promise<LocalPlanBridgeServer> {
  const dir = path.resolve(input.dir);
  const initialPayload = buildLocalPlanBridgePayload({
    dir,
    kind: input.kind,
    title: input.title,
    brief: input.brief,
  });
  const token = input.token || crypto.randomBytes(24).toString("base64url");
  const host = input.host || "127.0.0.1";
  const appUrl = normalizeBridgeAppUrl(input.appUrl);
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      sendBridgeJson(res, 204, "");
      return;
    }
    if (req.method !== "GET") {
      sendBridgeJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const url = bridgeRequestUrl(req);
    if (url.pathname !== "/local-plan.json") {
      sendBridgeJson(res, 404, { ok: false, error: "Not found." });
      return;
    }
    if (url.searchParams.get("token") !== token) {
      sendBridgeJson(res, 403, { ok: false, error: "Invalid bridge token." });
      return;
    }

    try {
      sendBridgeJson(
        res,
        200,
        buildLocalPlanBridgePayload({
          dir,
          kind: input.kind,
          title: input.title,
          brief: input.brief,
        }),
      );
    } catch (error) {
      sendBridgeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
  const openResult = input.open
    ? (input.openUrl || openLocalUrl)(url)
    : undefined;

  return {
    server,
    result: {
      ok: true,
      dir,
      url,
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
    validation: "passed",
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
    kind: optionalArg(args, "kind")
      ? normalizeKind(optionalArg(args, "kind"))
      : undefined,
  });

  process.stdout.write(`${JSON.stringify(bridge.result, null, 2)}\n`);
  process.stderr.write(
    `Local Plan bridge running at ${bridge.result.bridgeUrl}\nPress Ctrl+C to stop.\n`,
  );

  await new Promise<void>((resolve) => {
    const stop = () => {
      bridge.server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
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
  agent-native plan local init --title <title> [--brief <text>] [--kind plan|recap] [--dir <folder>] [--force]
  agent-native plan local check --dir <folder>
  agent-native plan local serve --dir <folder> [--app-url <url>] [--kind plan|recap] [--open] [--port <port>]
  agent-native plan local preview --dir <folder> [--app-url <url>] [--kind plan|recap] [--open] [--out preview.html]

The blocks command fetches the no-auth, read-only get-plan-blocks catalog from
the Plan app and writes plan-blocks.md (or plan-blocks.schema.json). It sends no
plan content and is safe for local-files authoring before writing MDX. It uses a
clack UI in interactive terminals and prints JSON for non-interactive shells or
when --json is passed.

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
the browser; it does not write plan content to the hosted database. Use
\`plan local preview\` for a local Plan dev server route. \`preview --out\` is a
legacy/debug escape hatch that writes a standalone static HTML file.
`;

export async function runPlan(argv: string[]): Promise<void> {
  const [area, sub, ...rest] = argv;
  if (area === "blocks") {
    await runBlocks(parseArgs(argv.slice(1)));
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
