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
      kind: "invalid-block";
      source: "mdx";
      tag: string;
      message: string;
      body: string;
    }
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

const BASE_MDX_ATTRS = new Set(["id", "title", "summary", "editable"]);

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

function mdxAttributeNames(node: MdxJsxNode): string[] {
  return (node.attributes ?? [])
    .filter(
      (attr) =>
        attr.type === "mdxJsxAttribute" && typeof attr.name === "string",
    )
    .map((attr) => attr.name!);
}

function unknownMdxAttrs(
  node: MdxJsxNode,
  parsedType: string,
  parsedData: unknown,
): string[] {
  const spec = getDocBlockConfigRegistry().get(parsedType);
  if (!spec) return [];

  const allowed = new Set([
    ...BASE_MDX_ATTRS,
    ...Object.keys(spec.mdx.toAttrs(parsedData as never)),
  ]);

  return mdxAttributeNames(node).filter((name) => !allowed.has(name));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function formatPath(path: Array<string | number>): string {
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : part))
    .join(".")
    .replace(/\.\[/g, "[");
}

function findUnknownDataKeys(
  raw: unknown,
  parsed: unknown,
  path: Array<string | number> = [],
): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, index) =>
      findUnknownDataKeys(item, parsed[index], [...path, index]),
    );
  }

  if (!plainObject(raw) || !plainObject(parsed)) return [];

  const parsedKeys = new Set(Object.keys(parsed));
  const unknown = Object.keys(raw)
    .filter((key) => !parsedKeys.has(key))
    .map((key) => formatPath([...path, key]));

  const nested = Object.keys(raw)
    .filter((key) => parsedKeys.has(key))
    .flatMap((key) =>
      findUnknownDataKeys(raw[key], parsed[key], [...path, key]),
    );

  return [...unknown, ...nested];
}

function validationError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  const issue = error.issues[0];
  const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return `schema — ${path}${issue?.message ?? "invalid"}`;
}

function parseMdxBlockFragment(
  fragment: string,
  expectedTag: string,
):
  | { ok: true; segment: Extract<DocSegment, { kind: "block"; source: "mdx" }> }
  | { ok: false; error: string } {
  const registry = getDocBlockConfigRegistry();
  const masked = maskExplicitHeadingIds(fragment);
  let tree: DocMdxNode;
  try {
    tree = docMdxProcessor().parse(masked.markdown) as unknown as DocMdxNode;
  } catch (error) {
    return {
      ok: false,
      error: `invalid MDX syntax — ${(error as Error).message}`,
    };
  }

  if ((tree.children ?? []).length !== 1) {
    return {
      ok: false,
      error: `expected one <${expectedTag}> block, found ${
        tree.children?.length ?? 0
      } top-level nodes`,
    };
  }
  const child = tree.children?.[0];
  if (!child) return { ok: false, error: `missing <${expectedTag}> block` };
  const tag = elementName(child);
  if (tag !== expectedTag) {
    return {
      ok: false,
      error: `expected <${expectedTag}> but parsed <${tag ?? "unknown"}>`,
    };
  }
  if (!registry.getByTag(tag)) {
    return { ok: false, error: `unregistered MDX block tag <${tag}>` };
  }

  let base: ReturnType<typeof readMdxBase>;
  let parsed: { type: string; data: unknown } | null;
  const children = masked.restore(stringifyMarkdownNodes(child.children ?? []));
  try {
    base = readMdxBase(child as unknown as MdxJsxNode);
    parsed = parseSpecBlock(
      registry,
      child as unknown as MdxJsxNode,
      { id: base.id ?? "", ...base },
      children,
      "doc-block",
    );
  } catch (error) {
    return {
      ok: false,
      error: `invalid MDX attribute — ${(error as Error).message}`,
    };
  }
  if (!parsed) return { ok: false, error: `could not parse <${tag}> block` };

  const spec = registry.get(parsed.type);
  const validated = spec?.schema.safeParse(parsed.data);
  if (!validated?.success) {
    return {
      ok: false,
      error: validationError(
        validated?.error ?? { issues: [{ path: [], message: "invalid" }] },
      ),
    };
  }

  const unknownDataKeys = findUnknownDataKeys(parsed.data, validated.data);
  if (unknownDataKeys.length > 0) {
    return {
      ok: false,
      error: `unknown key${
        unknownDataKeys.length === 1 ? "" : "s"
      } — ${unknownDataKeys.join(", ")}`,
    };
  }

  const unknownAttrs = unknownMdxAttrs(
    child as unknown as MdxJsxNode,
    parsed.type,
    validated.data,
  );
  if (unknownAttrs.length > 0) {
    return {
      ok: false,
      error: `unknown attribute${
        unknownAttrs.length === 1 ? "" : "s"
      } — ${unknownAttrs.join(", ")}`,
    };
  }

  return {
    ok: true,
    segment: {
      kind: "block",
      source: "mdx",
      type: parsed.type,
      id: base.id,
      title: base.title,
      summary: base.summary,
      editable: base.editable,
      data: validated.data,
    },
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
      let parseFailure:
        | { error: string; fragment: string; endIndex: number }
        | undefined;
      for (let j = i; j <= maxEnd; j++) {
        const candidateEnd = lines[j];
        if (
          !candidateEnd.includes("/>") &&
          !candidateEnd.includes(`</${tag}>`)
        ) {
          continue;
        }
        const fragment = lines.slice(i, j + 1).join("\n");
        const result = parseMdxBlockFragment(fragment, tag);
        if (result.ok) {
          flushProse();
          segments.push(result.segment);
          i = j;
          continue lineLoop;
        }
        parseFailure = {
          error: result.error,
          fragment,
          endIndex: j,
        };
      }

      flushProse();
      if (parseFailure) {
        segments.push({
          kind: "invalid-block",
          source: "mdx",
          tag,
          message: parseFailure.error,
          body: parseFailure.fragment,
        });
        i = parseFailure.endIndex;
        continue;
      }

      segments.push({
        kind: "invalid-block",
        source: "mdx",
        tag,
        message: `missing closing </${tag}> or self-closing /> within 500 lines`,
        body: line,
      });
      continue;
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
    return {
      ok: false,
      error: validationError(parsed.error),
    };
  }

  const unknownKeys = findUnknownDataKeys(data, parsed.data);
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `unknown key${
        unknownKeys.length === 1 ? "" : "s"
      } — ${unknownKeys.join(", ")}`,
    };
  }

  return { ok: true };
}

export function validateDocSegment(
  segment:
    | Extract<DocSegment, { kind: "block" }>
    | Extract<DocSegment, { kind: "invalid-block" }>,
): { ok: true } | { ok: false; error: string } {
  if (segment.kind === "invalid-block") {
    return { ok: false, error: segment.message };
  }

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
    return {
      ok: false,
      error: validationError(parsed.error),
    };
  }
  return { ok: true };
}
