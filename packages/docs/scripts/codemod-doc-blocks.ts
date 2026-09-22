import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BlockRegistry,
  registerLibraryBlockConfigs,
  serializeSpecBlock,
  type BlockSpec,
} from "../../core/src/client/blocks/server";
import { isDocSourceFile } from "../lib/docs-source";

const DOCS_CONTENT_ROOT = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  "../core/docs/content",
);
const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_GLOB_LABEL = "packages/core/docs/content/**/*.{md,mdx}";
const FENCE_RE = /^(`{3,})([^\n]*)$/;

const BLOCK_TYPE_ALIASES: Record<string, string> = {
  "an-diagram": "diagram",
  "an-wireframe": "wireframe",
  "an-api": "api-endpoint",
  "an-api-endpoint": "api-endpoint",
  "an-endpoint": "api-endpoint",
  "an-openapi": "openapi-spec",
  "an-openapi-spec": "openapi-spec",
  "an-schema": "data-model",
  "an-data-model": "data-model",
  "an-model": "data-model",
  "an-annotated-code": "annotated-code",
  "an-walkthrough": "annotated-code",
  "an-file-tree": "file-tree",
  "an-files": "file-tree",
  "an-tree": "file-tree",
  "an-callout": "callout",
  "an-note": "callout",
  "an-columns": "columns",
  "an-tabs": "tabs",
  "an-diff": "diff",
  "an-table": "table",
  "an-checklist": "checklist",
  "an-json": "json-explorer",
  "an-json-explorer": "json-explorer",
};

export type DocsBlockCodemodAction = "convert" | "convert-mermaid" | "ignore";

export interface FenceAttrs {
  id?: string;
  title?: string;
  summary?: string;
  editable?: boolean;
}

export interface DocsBlockFence {
  alias: string;
  attrs: FenceAttrs;
  body: string;
  startLine: number;
  endLine: number;
  raw: string;
}

export interface ConvertedDocsBlock {
  action: DocsBlockCodemodAction;
  alias: string;
  startLine: number;
  endLine: number;
  output: string;
  blockType?: string;
  error?: string;
}

export interface DocsBlockCodemodReport {
  changed: boolean;
  converted: ConvertedDocsBlock[];
  errors: ConvertedDocsBlock[];
  output: string;
}

function createRegistry(): BlockRegistry {
  const registry = new BlockRegistry();
  registerLibraryBlockConfigs(registry);
  return registry;
}

const defaultRegistry = createRegistry();

function parseFenceAttrs(info: string): FenceAttrs {
  const attrs: FenceAttrs = {};
  const pattern =
    /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'|([\w-]+)\s*=\s*(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(info)) !== null) {
    const key = match[1] ?? match[3] ?? match[5];
    const value = match[2] ?? match[4] ?? match[6] ?? "";
    if (key === "editable") {
      attrs.editable = value === "true";
    } else if (key === "id" || key === "title" || key === "summary") {
      attrs[key] = value;
    }
  }
  return attrs;
}

function hashSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getFenceAlias(info: string): string | undefined {
  return /^\s*([\w-]+)/.exec(info)?.[1]?.toLowerCase();
}

export function findDocsBlockFences(markdown: string): DocsBlockFence[] {
  const lines = markdown.split("\n");
  const blocks: DocsBlockFence[] = [];

  for (let index = 0; index < lines.length; index++) {
    const open = FENCE_RE.exec(lines[index]);
    if (!open) continue;

    const fence = open[1];
    const info = open[2] ?? "";
    const alias = getFenceAlias(info);
    const closeRe = new RegExp(`^${fence}\`*\\s*$`);
    const bodyLines: string[] = [];
    let closeIndex = index + 1;
    let closed = false;

    for (; closeIndex < lines.length; closeIndex++) {
      if (closeRe.test(lines[closeIndex])) {
        closed = true;
        break;
      }
      bodyLines.push(lines[closeIndex]);
    }

    if (!closed) continue;

    if (alias?.startsWith("an-")) {
      blocks.push({
        alias,
        attrs: parseFenceAttrs(info),
        body: bodyLines.join("\n"),
        startLine: index + 1,
        endLine: closeIndex + 1,
        raw: lines.slice(index, closeIndex + 1).join("\n"),
      });
    }

    index = closeIndex;
  }

  return blocks;
}

function parseJsonBlockBody(
  spec: BlockSpec<any>,
  body: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = body.trim();
  let data: unknown;
  if (!trimmed) {
    data = spec.empty?.() ?? {};
  } else {
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      return {
        ok: false,
        error: `invalid JSON: ${(error as Error).message}`,
      };
    }
  }

  const parsed = spec.schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      error: `schema: ${path}${issue?.message ?? "invalid block data"}`,
    };
  }

  return { ok: true, data: parsed.data };
}

export function convertDocsBlockFence(
  fence: DocsBlockFence,
  registry: BlockRegistry = defaultRegistry,
): ConvertedDocsBlock {
  if (fence.alias === "an-mermaid") {
    return {
      action: "convert-mermaid",
      alias: fence.alias,
      startLine: fence.startLine,
      endLine: fence.endLine,
      output: ["```mermaid", fence.body.trim(), "```"].join("\n"),
      blockType: "mermaid",
    };
  }

  const blockType = BLOCK_TYPE_ALIASES[fence.alias];
  if (!blockType) {
    return {
      action: "ignore",
      alias: fence.alias,
      startLine: fence.startLine,
      endLine: fence.endLine,
      output: fence.raw,
      error: `unknown docs block alias "${fence.alias}"`,
    };
  }

  const spec = registry.get(blockType);
  if (!spec) {
    return {
      action: "ignore",
      alias: fence.alias,
      startLine: fence.startLine,
      endLine: fence.endLine,
      output: fence.raw,
      blockType,
      error: `no registered library block for "${blockType}"`,
    };
  }

  const parsed = parseJsonBlockBody(spec, fence.body);
  if (!parsed.ok) {
    return {
      action: "ignore",
      alias: fence.alias,
      startLine: fence.startLine,
      endLine: fence.endLine,
      output: fence.raw,
      blockType,
      error: parsed.error,
    };
  }

  return {
    action: "convert",
    alias: fence.alias,
    startLine: fence.startLine,
    endLine: fence.endLine,
    output: serializeSpecBlock(spec, {
      id: fence.attrs.id ?? `doc-block-${hashSource(fence.raw)}`,
      title: fence.attrs.title,
      summary: fence.attrs.summary,
      editable: fence.attrs.editable,
      data: parsed.data,
    }),
    blockType,
  };
}

export function convertDocsBlocksMarkdown(
  markdown: string,
  registry: BlockRegistry = defaultRegistry,
): DocsBlockCodemodReport {
  const fences = findDocsBlockFences(markdown);
  if (fences.length === 0) {
    return { changed: false, converted: [], errors: [], output: markdown };
  }

  let output = "";
  let cursor = 0;
  const converted: ConvertedDocsBlock[] = [];
  const errors: ConvertedDocsBlock[] = [];

  for (const fence of fences) {
    const start = markdown.indexOf(fence.raw, cursor);
    if (start < 0) {
      const error = {
        ...convertDocsBlockFence(fence, registry),
        error: "could not locate fence in source",
      };
      errors.push(error);
      continue;
    }

    const result = convertDocsBlockFence(fence, registry);
    output += markdown.slice(cursor, start);
    output += result.error ? fence.raw : result.output;
    cursor = start + fence.raw.length;

    if (result.error) errors.push(result);
    if (result.action === "convert" || result.action === "convert-mermaid") {
      converted.push(result);
    }
  }

  output += markdown.slice(cursor);
  return {
    changed: output !== markdown,
    converted,
    errors,
    output,
  };
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && isDocSourceFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function runCodemod(options: { write: boolean }): Promise<number> {
  const files = await collectMarkdownFiles(DOCS_CONTENT_ROOT);
  let filesWithChanges = 0;
  let convertedBlocks = 0;
  let errors = 0;

  console.log(
    `${options.write ? "Updating" : "Scanning"} ${DEFAULT_GLOB_LABEL}`,
  );

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const report = convertDocsBlocksMarkdown(source);
    if (!report.changed && report.errors.length === 0) continue;

    const displayPath = relative(REPO_ROOT, file);
    if (report.changed) filesWithChanges++;
    convertedBlocks += report.converted.length;
    errors += report.errors.length;

    if (options.write && report.changed) {
      await writeFile(file, report.output, "utf8");
    }

    console.log(`\n${displayPath}`);
    for (const item of report.converted) {
      console.log(
        `  ${item.startLine}:${item.alias} -> ${item.blockType} (${item.action})`,
      );
    }
    for (const item of report.errors) {
      console.log(`  ${item.startLine}:${item.alias} skipped: ${item.error}`);
    }
  }

  console.log(
    options.write
      ? `\nCodemod complete: ${filesWithChanges} files changed, ${convertedBlocks} blocks converted, ${errors} blocks skipped with errors.`
      : `\nDry run complete: ${filesWithChanges} files would change, ${convertedBlocks} blocks convertible, ${errors} blocks skipped with errors.`,
  );
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runCodemod({ write: process.argv.some((arg: string) => arg === "--write") })
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
