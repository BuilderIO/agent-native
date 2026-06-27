import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import {
  BlockRegistry,
  createAttrReader,
  parseSpecBlock,
  registerLibraryBlockConfigs,
  type MdxJsxNode,
} from "../../core/src/client/blocks/server";

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
  "an-mermaid": "mermaid",
  mermaid: "mermaid",
};

export const DOC_BLOCK_LANGUAGES = new Set(Object.keys(BLOCK_TYPE_ALIASES));

export type DocSegment =
  | { kind: "markdown"; text: string }
  | {
      kind: "block";
      source: "fence";
      alias: string;
      attrs: Record<string, string>;
      body: string;
    }
  | {
      kind: "block";
      source: "mdx";
      type: string;
      id?: string;
      title?: string;
      summary?: string;
      editable?: boolean;
      data: unknown;
    };

type DocMdxNode = {
  type: string;
  name?: string;
  value?: string;
  lang?: string;
  meta?: string;
  children?: DocMdxNode[];
  attributes?: unknown[];
  [key: string]: unknown;
};

let cachedConfigRegistry: BlockRegistry | null = null;

function getDocBlockConfigRegistry(): BlockRegistry {
  if (cachedConfigRegistry) return cachedConfigRegistry;
  const registry = new BlockRegistry();
  registerLibraryBlockConfigs(registry);
  cachedConfigRegistry = registry;
  return registry;
}

function docMdxProcessor() {
  return unified().use(remarkParse).use(remarkMdx).use(remarkStringify, {
    bullet: "-",
    fences: true,
    incrementListMarker: true,
  });
}

function elementName(node: DocMdxNode | undefined): string | undefined {
  return node?.type === "mdxJsxFlowElement" ||
    node?.type === "mdxJsxTextElement"
    ? node.name
    : undefined;
}

function stringifyMarkdownNodes(nodes: DocMdxNode[]): string {
  if (nodes.length === 0) return "";
  return String(
    docMdxProcessor().stringify({
      type: "root",
      children: nodes,
    } as never),
  ).trim();
}

function maskExplicitHeadingIds(markdown: string): {
  markdown: string;
  restore: (value: string) => string;
} {
  const replacements: string[] = [];
  const masked = markdown.replace(
    /^(#{1,6}\s+.+?)\s+(\{#[\w-]+\})\s*$/gm,
    (_match, prefix: string, explicitId: string) => {
      const token = `ANMDXHEADINGID${replacements.length}TOKEN`;
      replacements.push(explicitId);
      return `${prefix} ${token}`;
    },
  );

  if (replacements.length === 0) {
    return { markdown, restore: (value) => value };
  }

  return {
    markdown: masked,
    restore: (value) =>
      replacements.reduce(
        (next, explicitId, index) =>
          next.replaceAll(`ANMDXHEADINGID${index}TOKEN`, explicitId),
        value,
      ),
  };
}

function readMdxBase(node: MdxJsxNode): {
  id?: string;
  title?: string;
  summary?: string;
  editable?: boolean;
} {
  const attrs = createAttrReader(node);
  return {
    id: attrs.string("id"),
    title: attrs.string("title"),
    summary: attrs.string("summary"),
    editable: attrs.bool("editable"),
  };
}

function parseMdxBlockFragment(
  fragment: string,
  expectedTag: string,
): Extract<DocSegment, { kind: "block"; source: "mdx" }> | undefined {
  const registry = getDocBlockConfigRegistry();
  const masked = maskExplicitHeadingIds(fragment);
  let tree: DocMdxNode;
  try {
    tree = docMdxProcessor().parse(masked.markdown) as unknown as DocMdxNode;
  } catch {
    return undefined;
  }

  if ((tree.children ?? []).length !== 1) return undefined;
  const child = tree.children?.[0];
  if (!child) return undefined;
  const tag = elementName(child);
  if (tag !== expectedTag || !registry.getByTag(tag)) return undefined;

  const base = readMdxBase(child as unknown as MdxJsxNode);
  const children = masked.restore(stringifyMarkdownNodes(child.children ?? []));
  const parsed = parseSpecBlock(
    registry,
    child as unknown as MdxJsxNode,
    { id: base.id ?? "", ...base },
    children,
    "doc-block",
  );
  if (!parsed) return undefined;

  return {
    kind: "block",
    source: "mdx",
    type: parsed.type,
    id: base.id,
    title: base.title,
    summary: base.summary,
    editable: base.editable,
    data: parsed.data,
  };
}

export function parseFenceAttrs(rest: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rest)) !== null) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4] ?? "";
    if (key) attrs[key] = value;
  }
  return attrs;
}

export function resolveDocBlockType(alias: string): string | undefined {
  return BLOCK_TYPE_ALIASES[alias.trim().toLowerCase()];
}

export function splitDocSegments(markdown: string): DocSegment[] {
  const lines = markdown.split("\n");
  const segments: DocSegment[] = [];
  let prose: string[] = [];
  const registry = getDocBlockConfigRegistry();

  const flushProse = () => {
    if (prose.length === 0) return;
    const text = prose.join("\n").trimEnd();
    if (text.trim().length > 0) segments.push({ kind: "markdown", text });
    prose = [];
  };

  lineLoop: for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^(`{3,})([^\n]*)$/.exec(line);
    if (open) {
      const fence = open[1];
      const info = open[2] ?? "";
      const alias = /^\s*([\w-]+)/.exec(info)?.[1]?.toLowerCase();
      const closeRe = new RegExp(`^${fence}\`*\\s*$`);
      const bodyLines: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        if (closeRe.test(lines[j])) {
          closed = true;
          break;
        }
        bodyLines.push(lines[j]);
      }
      if (!closed) {
        prose.push(line);
        continue;
      }
      if (alias && DOC_BLOCK_LANGUAGES.has(alias)) {
        flushProse();
        segments.push({
          kind: "block",
          source: "fence",
          alias,
          attrs: parseFenceAttrs(info),
          body: bodyLines.join("\n"),
        });
      } else {
        prose.push(line, ...bodyLines, lines[j]);
      }
      i = j;
      continue;
    }

    const tag = /^\s*<([A-Z][\w-]*)(?:[\s/>]|$)/.exec(line)?.[1];
    if (tag && registry.hasTag(tag)) {
      const maxEnd = Math.min(lines.length - 1, i + 500);
      for (let j = i; j <= maxEnd; j++) {
        const candidateEnd = lines[j];
        if (
          !candidateEnd.includes("/>") &&
          !candidateEnd.includes(`</${tag}>`)
        ) {
          continue;
        }
        const fragment = lines.slice(i, j + 1).join("\n");
        const block = parseMdxBlockFragment(fragment, tag);
        if (block) {
          flushProse();
          segments.push(block);
          i = j;
          continue lineLoop;
        }
      }
    }

    prose.push(line);
  }

  flushProse();
  return segments;
}

export function validateDocBlock(
  alias: string,
  body: string,
): { ok: true } | { ok: false; error: string } {
  const type = resolveDocBlockType(alias);
  if (!type) return { ok: false, error: `unknown block type "${alias}"` };
  const spec = getDocBlockConfigRegistry().get(type);
  if (!spec) return { ok: false, error: `no registered spec for "${type}"` };

  let data: unknown;
  if (type === "mermaid") {
    data = { code: body.trim() };
  } else {
    const trimmed = body.trim();
    if (!trimmed) {
      data = spec.empty?.() ?? {};
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch (error) {
        return {
          ok: false,
          error: `invalid JSON — ${(error as Error).message}`,
        };
      }
    }
  }

  const parsed = spec.schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      error: `schema — ${path}${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true };
}

export function validateDocSegment(
  segment: Extract<DocSegment, { kind: "block" }>,
): { ok: true } | { ok: false; error: string } {
  if (segment.source !== "mdx") {
    return validateDocBlock(segment.alias, segment.body);
  }

  const spec = getDocBlockConfigRegistry().get(segment.type);
  if (!spec) {
    return {
      ok: false,
      error: `no registered spec for "${segment.type}"`,
    };
  }

  const parsed = spec.schema.safeParse(segment.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      error: `schema — ${path}${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true };
}
