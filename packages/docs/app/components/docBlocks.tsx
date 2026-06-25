/**
 * Visual block support for the docs site.
 *
 * The docs reuse the exact same first-party block library that powers Visual
 * Plans and Visual Recaps (`@agent-native/core/blocks`): hand-drawn rough.js
 * diagrams, expandable API-endpoint and OpenAPI specs, schema/data-model tables,
 * annotated code walkthroughs, file trees, callouts, tabs, and columns. They
 * share the global sketchy/clean preference (localStorage `plan-wireframe-style`)
 * and the docs light/dark theme, so a diagram in the docs looks identical to one
 * in the Plan app.
 *
 * Authoring: blocks are embedded in the markdown docs as fenced code blocks whose
 * info string names a block type, e.g.
 *
 *     ```diagram title="Request lifecycle"
 *     { "html": "<div class='diagram-row'>…</div>" }
 *     ```
 *
 * The fence body is JSON for the block's `data` (mermaid takes raw text). The
 * renderer ({@link DocContent}) splits the markdown into prose runs and block
 * runs, rendering prose through the existing markdown pipeline and blocks through
 * the shared `BlockView`.
 */

import {
  BlockRegistry,
  BlockRegistryProvider,
  BlockView,
  registerLibraryBlocks,
  useBlockRegistry,
  type BlockRenderContext,
  type NestedBlock,
} from "@agent-native/core/blocks";
import { useT } from "@agent-native/core/client";
import { useMemo, type ReactNode } from "react";

import { renderMarkdownToHtml } from "./MarkdownRenderer";

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The docs block registry. Registers the whole shared standard library once —
 * the same specs (schema + MDX + React `Read`/`Edit`) the Plan and Content apps
 * register. Docs render read-only, so only the `Read` renderers are exercised.
 */
let cachedRegistry: BlockRegistry | null = null;

function getDocBlockRegistry(): BlockRegistry {
  if (cachedRegistry) return cachedRegistry;
  const registry = new BlockRegistry();
  registerLibraryBlocks(registry);
  cachedRegistry = registry;
  return registry;
}

/**
 * Visual block aliases for fenced doc blocks. Every name is namespaced with an
 * `an-` prefix so a doc block fence can NEVER collide with an ordinary code fence
 * (```json, ```diff, ```ts …) — those keep rendering as syntax-highlighted code.
 * The alias maps to the canonical block `type` registered in the shared library.
 *
 * Authoring: ```an-diagram, ```an-api, ```an-schema, ```an-annotated-code, etc.
 */
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
};

/** The fence languages that should render as a visual block, not a code block. */
export const DOC_BLOCK_LANGUAGES = new Set(Object.keys(BLOCK_TYPE_ALIASES));

export function resolveDocBlockType(alias: string): string | undefined {
  return BLOCK_TYPE_ALIASES[alias.trim().toLowerCase()];
}

/* -------------------------------------------------------------------------- */
/* Segment parsing                                                             */
/* -------------------------------------------------------------------------- */

export type DocSegment =
  | { kind: "markdown"; text: string }
  | {
      kind: "block";
      alias: string;
      attrs: Record<string, string>;
      body: string;
    };

/** Parse `title="Foo" id="bar"` style attributes from a fence info string. */
function parseFenceAttrs(rest: string): Record<string, string> {
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

/**
 * Split a markdown document into ordered prose and block segments. A block
 * segment is a top-level fenced code block (``` at column 0) whose first info
 * token resolves to a registered block type. Everything else — including normal
 * code fences — stays in markdown segments so the existing renderer handles it.
 */
export function splitDocSegments(markdown: string): DocSegment[] {
  const lines = markdown.split("\n");
  const segments: DocSegment[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length === 0) return;
    const text = prose.join("\n");
    if (text.trim().length > 0) segments.push({ kind: "markdown", text });
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A fenced code block opener: 3+ backticks then an info string. The info may
    // contain backticks (e.g. an inline-code attribute value like
    // `summary="uses \`appFetch\`"`), so don't ban them.
    const open = /^(`{3,})([^\n]*)$/.exec(line);
    if (open) {
      const fence = open[1];
      const info = open[2] ?? "";
      const alias = /^\s*([\w-]+)/.exec(info)?.[1]?.toLowerCase();
      // Per CommonMark a fence is closed by a line of >= as many of the same
      // fence char (plus optional trailing spaces). Matching the length means a
      // ```block that closes with ```` is handled, and we step over normal code
      // fences as a unit instead of scanning their contents for `an-*` openers.
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
        // Unterminated fence — emit the opener as prose and keep scanning the
        // rest line by line so nothing is dropped.
        prose.push(line);
        continue;
      }
      if (alias && DOC_BLOCK_LANGUAGES.has(alias)) {
        flushProse();
        segments.push({
          kind: "block",
          alias,
          attrs: parseFenceAttrs(info),
          body: bodyLines.join("\n"),
        });
      } else {
        // A normal code fence — keep it verbatim in the prose stream so the
        // markdown renderer handles it (and an `an-*` line inside a code example
        // is never mistaken for a block).
        prose.push(line, ...bodyLines, lines[j]);
      }
      i = j; // skip past the closing fence
      continue;
    }
    prose.push(line);
  }

  flushProse();
  return segments;
}

/**
 * Validate a single embedded block's source without rendering it. Resolves the
 * type, parses the body (JSON, or raw text for mermaid), and runs the block's zod
 * schema. Returns a precise error string instead of throwing so the build-time
 * test can report every broken block across all docs at once.
 */
export function validateDocBlock(
  alias: string,
  body: string,
): { ok: true } | { ok: false; error: string } {
  const type = resolveDocBlockType(alias);
  if (!type) return { ok: false, error: `unknown block type "${alias}"` };
  const spec = getDocBlockRegistry().get(type);
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

/* -------------------------------------------------------------------------- */
/* Render context                                                              */
/* -------------------------------------------------------------------------- */

function MarkdownInline({ markdown }: { markdown: string }): ReactNode {
  return (
    <div
      className="docs-content"
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(markdown) }}
    />
  );
}

/**
 * The read-only render context shared by every docs block. Wires markdown-bearing
 * blocks (callout bodies, annotated-code notes) to the docs markdown renderer and
 * container blocks (tabs, columns) to a recursive dispatch so nested blocks render
 * through the same registry.
 */
function useDocBlockContext(): BlockRenderContext {
  const registry = getDocBlockRegistry();
  return useMemo<BlockRenderContext>(
    () => ({
      dialect: "gfm",
      textDirection: "ltr",
      showCodeAnnotationOverlays: false,
      renderMarkdown: (markdown) => <MarkdownInline markdown={markdown} />,
      renderBlock: ({ block, compactVisuals }) => (
        <DocNestedBlock
          block={block}
          registry={registry}
          compactVisuals={compactVisuals}
        />
      ),
    }),
    [registry],
  );
}

function DocNestedBlock({
  block,
  registry,
  compactVisuals,
}: {
  block: NestedBlock;
  registry: BlockRegistry;
  compactVisuals?: boolean;
}): ReactNode {
  const ctx = useDocBlockContext();
  const spec = registry.get(block.type);
  if (!spec) return null;
  void compactVisuals;
  return <BlockView spec={spec} block={block} editing={false} ctx={ctx} />;
}

/* -------------------------------------------------------------------------- */
/* Components                                                                   */
/* -------------------------------------------------------------------------- */

/** Provides the docs block registry + read-only render context to descendants. */
export function DocBlocksProvider({ children }: { children: ReactNode }) {
  const registry = getDocBlockRegistry();
  const ctx = useDocBlockContext();
  return (
    <BlockRegistryProvider registry={registry} ctx={ctx}>
      {children}
    </BlockRegistryProvider>
  );
}

/** A small inline error surface so a malformed block never blanks the page. */
function DocBlockError({ alias, message }: { alias: string; message: string }) {
  const t = useT();
  return (
    <div className="my-6 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--fg-secondary)]">
      <strong className="font-semibold text-[var(--fg)]">
        {t("docBlocks.blockLabel", { alias })}
      </strong>
      : {message}
    </div>
  );
}

function hashDocBlockSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Render one embedded block from a parsed {@link DocSegment}. */
export function DocBlock({
  alias,
  attrs,
  body,
  index,
}: {
  alias: string;
  attrs: Record<string, string>;
  body: string;
  /** Stable position of this block within its doc. Used to derive a fallback id
   * so SSR and client hydration agree (no module-level mutable counter). */
  index?: number;
}) {
  const { registry, ctx } = useBlockRegistry();
  const t = useT();
  const type = resolveDocBlockType(alias);
  const spec = type ? registry.get(type) : undefined;

  if (!spec) {
    return (
      <DocBlockError alias={alias} message={t("docBlocks.unknownBlockType")} />
    );
  }

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
        return (
          <DocBlockError
            alias={alias}
            message={`invalid JSON — ${(error as Error).message}`}
          />
        );
      }
    }
  }

  const parsed = spec.schema.safeParse(data);
  if (!parsed.success) {
    return (
      <DocBlockError
        alias={alias}
        message={parsed.error.issues[0]?.message ?? "invalid block data"}
      />
    );
  }

  const generatedId =
    index == null
      ? `doc-block-${hashDocBlockSource(
          JSON.stringify([alias, attrs.title ?? "", attrs.summary ?? "", body]),
        )}`
      : `doc-block-${index}`;
  const block = {
    id: attrs.id || generatedId,
    title: attrs.title || undefined,
    summary: attrs.summary || undefined,
    data: parsed.data,
  };

  return <BlockView spec={spec} block={block} editing={false} ctx={ctx} />;
}
