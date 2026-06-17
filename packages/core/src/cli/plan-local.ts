/**
 * Plan helper commands.
 *
 * The `plan local` commands are intentionally separate from the Plan app
 * actions. They do not call MCP, HTTP, SQLite, or the Plan template runtime;
 * they only read and write local files so privacy-focused users have an
 * auditable no-DB path. The top-level `plan blocks` command is a schema-only,
 * no-auth helper for fetching the public block catalog before authoring local
 * MDX; it never sends plan content.
 */

import fs from "node:fs";
import path from "node:path";
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
};

type LocalPlanPreviewInput = {
  dir: string;
  kind?: LocalPlanKind;
  title?: string;
  brief?: string;
};

type LocalPlanPreviewResult = {
  ok: true;
  dir: string;
  out: string;
  url: string;
  title: string;
  kind: LocalPlanKind;
  files: string[];
};

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
  };
}

export function buildLocalPlanPreviewHtml(
  input: LocalPlanPreviewInput,
): string {
  const files = readLocalPlanFiles(input.dir);
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
}): LocalPlanPreviewResult {
  const dir = path.resolve(input.dir);
  const parsed = stripFrontmatter(readLocalPlanFiles(dir).planMdx);
  const kind = input.kind || normalizeKind(parsed.frontmatter.kind);
  const title =
    input.title ||
    parsed.frontmatter.title ||
    firstHeading(parsed.body) ||
    path.basename(dir);
  const out = path.resolve(input.out || path.join(dir, "preview.html"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildLocalPlanPreviewHtml({ ...input, dir, kind }));
  const files = [
    "plan.mdx",
    "canvas.mdx",
    "prototype.mdx",
    ".plan-state.json",
  ].filter((file) => fs.existsSync(path.join(dir, file)));
  return {
    ok: true,
    dir,
    out,
    url: pathToFileURL(out).href,
    title,
    kind,
    files,
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
    "blocks such as `<WireframeBlock />`, `<Diagram />`, `<TabsBlock />`,",
    "`<FileTree />`, or `<Diff />`; the local preview will show the source",
    "without publishing it to the Plan app.",
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
  const parsed = stripFrontmatter(files.planMdx);
  const result = {
    ok: true,
    noDb: true,
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
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runPreview(args: Record<string, string | boolean>): void {
  const result = writeLocalPlanPreview({
    dir: stringArg(args, "dir"),
    out: optionalArg(args, "out"),
    title: optionalArg(args, "title"),
    brief: optionalArg(args, "brief"),
    kind: optionalArg(args, "kind")
      ? normalizeKind(optionalArg(args, "kind"))
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
  agent-native plan local preview --dir <folder> [--out preview.html] [--kind plan|recap]

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
  agent-native plan local preview --dir plans/checkout-review
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
