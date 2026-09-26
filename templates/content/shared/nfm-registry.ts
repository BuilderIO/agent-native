/**
 * Content's block registry + the registry-block MDX helpers that `nfm.ts` uses
 * to round-trip registered structured blocks (the dev-doc / OpenAPI library)
 * inline inside the single `documents.content` NFM string.
 *
 * Locality decision (see the editor-unification blueprint): a registry block is
 * encoded INLINE in the markdown as an MDX-style component — NO sidecar table,
 * NO migration. Content's authority stays the single NFM string. This module is
 * the seam that lets `nfm.ts` (a) recognize a registered PascalCase block tag on
 * READ and (b) re-serialize an edited block's typed `data` on WRITE, while an
 * untouched block round-trips byte-exact from its preserved `__raw` source.
 *
 * It is React-free: it registers the pure (`schema` + `mdx`) standard-library
 * configs from core with render-only stubs, while the browser editor registers
 * the same blocks WITH their real `Read`/`Edit`. Both use the identical core
 * `mdx` config, so the inline source can never drift from what the editor
 * renders. Mirrors `templates/plan/shared/plan-block-registry.ts`.
 */
import {
  BlockRegistry,
  serializeSpecBlock,
  parseSpecBlock,
  createAttrReader,
  attributeValue,
  registerLibraryBlockConfigs,
  type BlockSpec,
  type MdxJsxNode,
  type MdxAttrNode,
  type ParsedBlockBase,
  type SerializableBlock,
} from "@agent-native/core/blocks/server";

import { builderDocsBlockConfigs } from "./builder-docs-blocks";
import { inlineDatabaseBlockConfig } from "./inline-database-block";
import { sourceComponentBlockConfig } from "./source-component-block";

export function registerContentBlocks(registry: BlockRegistry): void {
  registerLibraryBlockConfigs(registry, {
    overrides: { table: { type: "table-block" } },
  });
  for (const block of builderDocsBlockConfigs) {
    registry.register(block);
  }
  registry.register(sourceComponentBlockConfig);
  registry.register(inlineDatabaseBlockConfig);
}

let cachedRegistry: BlockRegistry | null = null;
export function contentBlockRegistry(): BlockRegistry {
  if (!cachedRegistry) {
    cachedRegistry = new BlockRegistry();
    registerContentBlocks(cachedRegistry);
  }
  return cachedRegistry;
}

export function isRegistryBlockTag(tag: string): boolean {
  return contentBlockRegistry().hasTag(tag);
}

export function registryBlockSpecByTag(tag: string): BlockSpec | undefined {
  return contentBlockRegistry().getByTag(tag);
}

export function registryBlockSpecByType(type: string): BlockSpec | undefined {
  return contentBlockRegistry().get(type);
}

export function serializeRegistryBlockToMdx(
  type: string,
  block: SerializableBlock,
): string {
  const spec = registryBlockSpecByType(type);
  if (!spec) {
    throw new Error(`Unknown content registry block type: ${type}`);
  }
  return serializeSpecBlock(spec, block);
}

export interface ParsedRegistryBlock {
  type: string;
  base: ParsedBlockBase;
  data: unknown;
}


type MdxModule = {
  unified: typeof import("unified").unified;
  remarkParse: typeof import("remark-parse").default;
  remarkMdx: typeof import("remark-mdx").default;
};

let mdxModulePromise: Promise<MdxModule> | null = null;
async function loadMdx(): Promise<MdxModule> {
  if (!mdxModulePromise) {
    mdxModulePromise = (async () => {
      const [{ unified }, remarkParse, remarkMdx] = await Promise.all([
        import("unified"),
        import("remark-parse"),
        import("remark-mdx"),
      ]);
      return {
        unified,
        remarkParse: remarkParse.default,
        remarkMdx: remarkMdx.default,
      };
    })();
  }
  return mdxModulePromise;
}

type MdxNode = {
  type: string;
  name?: string;
  value?: string;
  children?: MdxNode[];
  attributes?: MdxAttrNode[];
  [key: string]: unknown;
};

function elementName(node: MdxNode | undefined): string | undefined {
  return node?.type === "mdxJsxFlowElement" ||
    node?.type === "mdxJsxTextElement"
    ? node.name
    : undefined;
}

function readBase(node: MdxJsxNode): ParsedBlockBase {
  const reader = createAttrReader(node);
  return {
    id: reader.string("id") ?? "",
    title: reader.string("title"),
    summary: reader.string("summary"),
    editable: reader.bool("editable"),
  };
}

async function stringifyChildren(
  mdx: MdxModule,
  children: MdxNode[] | undefined,
): Promise<string> {
  if (!children?.length) return "";
  const remarkStringify = (await import("remark-stringify")).default;
  const processor = mdx
    .unified()
    .use(mdx.remarkParse)
    .use(mdx.remarkMdx)
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
      incrementListMarker: true,
    });
  return String(
    processor.stringify({ type: "root", children } as never),
  ).trim();
}

async function parseReadableColumnChildren(
  mdx: MdxModule,
  children: MdxNode[] | undefined,
  idContext: string,
  firstMarkdownBlockId?: string,
): Promise<Array<{ id: string; type: string; data: unknown }>> {
  const blocks: Array<{ id: string; type: string; data: unknown }> = [];
  const looseNodes: MdxNode[] = [];
  let markdownIndex = 0;

  const flushLoose = async () => {
    const markdown = (await stringifyChildren(mdx, looseNodes)).trim();
    looseNodes.length = 0;
    if (!markdown) return;
    blocks.push({
      id:
        markdownIndex === 0 && firstMarkdownBlockId
          ? firstMarkdownBlockId
          : `${idContext}-markdown-${markdownIndex + 1}`,
      type: "rich-text",
      data: { markdown },
    });
    markdownIndex += 1;
  };

  for (const [index, child] of (children ?? []).entries()) {
    const name = elementName(child);
    if (name && isRegistryBlockTag(name)) {
      const parsed = await parseRegistryBlockNode(
        mdx,
        child,
        `${idContext}-${index}`,
      );
      if (parsed) {
        await flushLoose();
        blocks.push({
          id: parsed.base.id,
          type: parsed.type,
          data: parsed.data,
        });
        continue;
      }
    }
    looseNodes.push(child);
  }

  await flushLoose();
  return blocks;
}

async function parseReadableColumnsData(
  mdx: MdxModule,
  node: MdxNode,
  base: ParsedBlockBase,
  idContext: string,
): Promise<{ columns: unknown[] } | null> {
  const columnNodes = (node.children ?? []).filter(
    (child) => elementName(child) === "Column",
  );
  if (columnNodes.length === 0) return null;

  const columns = await Promise.all(
    columnNodes.map(async (column, index) => {
      const reader = createAttrReader(column as unknown as MdxJsxNode);
      const id =
        reader.string("id") || `${base.id || idContext}-column-${index + 1}`;
      const label = reader.string("label")?.trim() || undefined;
      return {
        id,
        ...(label ? { label } : {}),
        blocks: await parseReadableColumnChildren(
          mdx,
          column.children,
          `${idContext}-${base.id || "columns"}-${id}`,
          reader.string("contentId"),
        ),
      };
    }),
  );

  return { columns };
}

async function parseRegistryBlockNode(
  mdx: MdxModule,
  node: MdxNode,
  idContext: string,
): Promise<ParsedRegistryBlock | null> {
  const name = elementName(node);
  if (!name) return null;
  const registry = contentBlockRegistry();
  const spec = registry.getByTag(name);
  if (!spec) return null;
  const base = readBase(node as unknown as MdxJsxNode);
  const children = await stringifyChildren(mdx, node.children);

  if (name === "Columns") {
    const readableColumns = await parseReadableColumnsData(
      mdx,
      node,
      base,
      idContext,
    );
    if (readableColumns) {
      return { type: spec.type, base, data: readableColumns };
    }
  }

  const parsed = parseSpecBlock(
    registry,
    node as unknown as MdxJsxNode,
    base,
    children,
    idContext,
  );
  if (!parsed) return null;
  return { type: parsed.type, base, data: parsed.data };
}

export async function parseRegistryBlockData(
  raw: string,
): Promise<ParsedRegistryBlock | null> {
  const mdx = await loadMdx();
  const tree = mdx
    .unified()
    .use(mdx.remarkParse)
    .use(mdx.remarkMdx)
    .parse(raw) as unknown as MdxNode;
  const node = (tree.children ?? []).find((child) => {
    const name = elementName(child);
    return name ? isRegistryBlockTag(name) : false;
  });
  if (!node) return null;
  return parseRegistryBlockNode(mdx, node, "content-block");
}

export { attributeValue };
