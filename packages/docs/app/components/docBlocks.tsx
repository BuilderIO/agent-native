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
 * Authoring: blocks are embedded in the markdown docs as standard MDX
 * components, e.g.
 *
 *     <Diagram title="Request lifecycle">
 *
 *     ```html
 *     <div class="diagram-row">…</div>
 *     ```
 *
 *     </Diagram>
 *
 * Legacy `an-*` JSON fences are still parseable for migration compatibility,
 * and mermaid stays as ordinary `mermaid` fences. The renderer
 * ({@link DocContent}) splits the markdown into prose runs and block runs,
 * rendering prose through the existing markdown pipeline and blocks through the
 * shared `BlockView`.
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

import {
  resolveDocBlockType,
  type DocSegment,
} from "../../lib/doc-block-segments";
import { renderMarkdownToHtml } from "./MarkdownRenderer";

export {
  DOC_BLOCK_LANGUAGES,
  resolveDocBlockType,
  splitDocSegments,
  validateDocBlock,
  validateDocSegment,
  type DocSegment,
} from "../../lib/doc-block-segments";

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
      visualFrame: "hide",
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
  segment,
  index,
}: {
  segment:
    | Extract<DocSegment, { kind: "block" }>
    | Extract<DocSegment, { kind: "invalid-block" }>;
  /** Stable position of this block within its doc. Used to derive a fallback id
   * so SSR and client hydration agree (no module-level mutable counter). */
  index?: number;
}) {
  const { registry, ctx } = useBlockRegistry();
  const t = useT();

  if (segment.kind === "invalid-block") {
    return <DocBlockError alias={segment.tag} message={segment.message} />;
  }

  const type =
    segment.source === "mdx"
      ? segment.type
      : resolveDocBlockType(segment.alias);
  const spec = type ? registry.get(type) : undefined;

  if (!spec) {
    return (
      <DocBlockError
        alias={segment.source === "mdx" ? segment.type : segment.alias}
        message={t("docBlocks.unknownBlockType")}
      />
    );
  }

  let data: unknown;
  if (segment.source === "mdx") {
    data = segment.data;
  } else if (type === "mermaid") {
    data = { code: segment.body.trim() };
  } else {
    const trimmed = segment.body.trim();
    if (!trimmed) {
      data = spec.empty?.() ?? {};
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch (error) {
        return (
          <DocBlockError
            alias={segment.alias}
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
        alias={segment.source === "mdx" ? segment.type : segment.alias}
        message={parsed.error.issues[0]?.message ?? "invalid block data"}
      />
    );
  }

  const generatedId =
    index == null
      ? `doc-block-${hashDocBlockSource(
          JSON.stringify(
            segment.source === "mdx"
              ? [
                  segment.type,
                  segment.title ?? "",
                  segment.summary ?? "",
                  segment.data,
                ]
              : [
                  segment.alias,
                  segment.attrs.title ?? "",
                  segment.attrs.summary ?? "",
                  segment.body,
                ],
          ),
        )}`
      : `doc-block-${index}`;
  const block = {
    id:
      (segment.source === "mdx" ? segment.id : segment.attrs.id) || generatedId,
    title:
      (segment.source === "mdx" ? segment.title : segment.attrs.title) ||
      undefined,
    summary:
      (segment.source === "mdx" ? segment.summary : segment.attrs.summary) ||
      undefined,
    editable: segment.source === "mdx" ? segment.editable : undefined,
    data: parsed.data,
  };

  return <BlockView spec={spec} block={block} editing={false} ctx={ctx} />;
}
