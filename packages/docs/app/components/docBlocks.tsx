
import {
  BlockRegistry,
  BlockRegistryProvider,
  BlockView,
  registerLibraryBlocks,
  useBlockRegistry,
  type BlockRenderContext,
  type NestedBlock,
} from "@agent-native/core/blocks";
import { useT } from "@agent-native/core/client/i18n";
import { useMemo, type ReactNode } from "react";

import {
  resolveDocBlockType,
  type DocSegment,
} from "../../lib/doc-block-segments";
import { accordionBlock } from "./blocks/accordion";
import { badgeBlock } from "./blocks/badge";
import { bannerBlock } from "./blocks/banner";
import { cardsBlock } from "./blocks/cards";
import { comparisonBlock } from "./blocks/comparison";
import { gettingStartedPathsBlock } from "./blocks/getting-started-paths";
import { imageBlock } from "./blocks/image";
import { noticeBlock } from "./blocks/notice";
import { sequenceBlock } from "./blocks/sequence";
import { signatureBlock } from "./blocks/signature";
import { stepsBlock } from "./blocks/steps";
import { videoBlock } from "./blocks/video";
import {
  DEFAULT_DOCS_LOCALE,
  localizeDocsHref,
  type DocsLocale,
} from "./docs-locale";
import MarkdownRenderer from "./MarkdownRenderer";

export {
  DOC_BLOCK_LANGUAGES,
  resolveDocBlockType,
  splitDocSegments,
  validateDocBlock,
  validateDocSegment,
  type DocSegment,
} from "../../lib/doc-block-segments";


let cachedRegistry: BlockRegistry | null = null;

function getDocBlockRegistry(): BlockRegistry {
  if (cachedRegistry) return cachedRegistry;
  const registry = new BlockRegistry();
  registerLibraryBlocks(registry);
  registry.register(stepsBlock);
  registry.register(cardsBlock);
  registry.register(comparisonBlock);
  registry.register(sequenceBlock);
  registry.register(gettingStartedPathsBlock);
  registry.register(signatureBlock);
  registry.register(imageBlock);
  registry.register(videoBlock);
  registry.register(noticeBlock);
  registry.register(bannerBlock);
  registry.register(accordionBlock);
  registry.register(badgeBlock);
  cachedRegistry = registry;
  return registry;
}


function useDocBlockContext(locale: DocsLocale): BlockRenderContext {
  const registry = getDocBlockRegistry();
  return useMemo<BlockRenderContext>(
    () => ({
      dialect: "gfm",
      textDirection: "ltr",
      visualFrame: "hide",
      showCodeAnnotationOverlays: false,
      localizeHref: (href) => localizeDocsHref(href, locale),
      renderMarkdown: (markdown) => (
        <MarkdownRenderer markdown={markdown} locale={locale} />
      ),
      renderBlock: ({ block, compactVisuals }) => (
        <DocNestedBlock
          block={block}
          registry={registry}
          compactVisuals={compactVisuals}
          locale={locale}
        />
      ),
    }),
    [registry, locale],
  );
}

function DocNestedBlock({
  block,
  registry,
  compactVisuals,
  locale,
}: {
  block: NestedBlock;
  registry: BlockRegistry;
  compactVisuals?: boolean;
  locale: DocsLocale;
}): ReactNode {
  const ctx = useDocBlockContext(locale);
  const spec = registry.get(block.type);
  if (!spec) return null;
  void compactVisuals;
  const view = (
    <BlockView spec={spec} block={block} editing={false} ctx={ctx} />
  );
  return block.type === "wireframe" ? (
    <div className="docs-wireframe-frame">{view}</div>
  ) : (
    view
  );
}


export function DocBlocksProvider({
  children,
  locale = DEFAULT_DOCS_LOCALE,
}: {
  children: ReactNode;
  locale?: DocsLocale;
}) {
  const registry = getDocBlockRegistry();
  const ctx = useDocBlockContext(locale);
  return (
    <BlockRegistryProvider registry={registry} ctx={ctx}>
      {children}
    </BlockRegistryProvider>
  );
}

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

export function DocBlock({
  segment,
  index,
}: {
  segment:
    | Extract<DocSegment, { kind: "block" }>
    | Extract<DocSegment, { kind: "invalid-block" }>;
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
    data = { source: segment.body.trim() };
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

  const view = (
    <BlockView spec={spec} block={block} editing={false} ctx={ctx} />
  );
  return type === "wireframe" ? (
    <div className="docs-wireframe-frame">{view}</div>
  ) : (
    view
  );
}
