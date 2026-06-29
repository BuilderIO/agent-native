import type {
  BuilderCodeBlockData,
  BuilderCodeSnippetsV2Data,
  BuilderRawBlockData,
  BuilderRawRefData,
  BuilderSymbolData,
  BuilderTabbedContentData,
  BuilderTextData,
} from "./builder-docs-blocks";
import {
  parseRegistryBlockData,
  serializeRegistryBlockToMdx,
} from "./nfm-registry";

export const BUILDER_DOCS_CONTENT_ROOT = "content/builder";
export const BUILDER_DOCS_RAW_ROOT = `${BUILDER_DOCS_CONTENT_ROOT}/.raw`;
export const BUILDER_DOCS_MDX_EXTENSION = ".builder.mdx";

export const BUILDER_DOCS_MODELS = [
  "docs-content",
  "blog-article",
  "agent-native-blog-article-test",
  "symbol",
] as const;

export type BuilderDocsModel = (typeof BUILDER_DOCS_MODELS)[number] | string;

export interface BuilderContentEntry {
  id: string;
  model: string;
  name?: string;
  published?: string;
  lastUpdated?: string | number;
  createdDate?: string | number;
  updatedDate?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BuilderMdxMetadata {
  model: string;
  entryId: string;
  lastUpdated?: string;
  published?: string;
  sourceHash: string;
  blocksHash: string;
  rawRoot: string;
  path: string;
}

export interface BuilderMdxFile {
  path: string;
  documentId: string;
  title: string;
  metadata: BuilderMdxMetadata;
  frontmatter: Record<string, unknown>;
  body: string;
  source: string;
}

export interface BuilderMdxBundle {
  mdx: BuilderMdxFile;
  files: Record<string, string>;
  blocks: unknown[];
}

export interface BuilderBlocksFromMdxResult {
  metadata: BuilderMdxMetadata;
  blocks: unknown[];
  blocksHash: string;
  sourceHash: string;
  warnings: string[];
}

type MdxNode = {
  type: string;
  name?: string;
  value?: string;
  children?: MdxNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

const FRONTMATTER_RE =
  /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n\r?\n|\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function stableHashString(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value53 = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value53.toString(36).padStart(11, "0");
}

export function stableHash(value: unknown): string {
  return stableHashString(stableStringify(value));
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const next = sortJson(value[key]);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function slugify(value: string, fallback = "untitled") {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function safePathPart(value: string, fallback = "entry") {
  return (
    value
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || fallback
  );
}

export function builderDocumentId(model: string, entryId: string) {
  const base = `builder_${safePathPart(model)}_${safePathPart(entryId)}`;
  if (base.length <= 128) return base;
  return `${base.slice(0, 112)}_${stableHash({ model, entryId }).slice(0, 12)}`;
}

export function builderRawRootForEntry(model: string, entryId: string) {
  return `${BUILDER_DOCS_RAW_ROOT}/${safePathPart(model)}/${safePathPart(
    entryId,
  )}`;
}

function modelDirectory(model: string) {
  if (model === "docs-content") return "docs";
  if (model === "blog-article") return "blog";
  if (model === "symbol") return "symbols";
  return safePathPart(model);
}

export function builderMdxPathForEntry(entry: BuilderContentEntry) {
  const data = entry.data ?? {};
  const title = builderEntryTitle(entry);
  const handle = stringFromRecord(data, [
    "handle",
    "slug",
    "urlPath",
    "url",
    "path",
  ]);
  const slug = slugify(handle?.replace(/^\/+|\/+$/g, "") || title, entry.id);
  return `${BUILDER_DOCS_CONTENT_ROOT}/${modelDirectory(
    entry.model,
  )}/${slug}${BUILDER_DOCS_MDX_EXTENSION}`;
}

function builderSymbolMdxPathForEntry(entry: BuilderContentEntry) {
  const data = entry.data ?? {};
  const title = builderEntryTitle(entry);
  const handle = stringFromRecord(data, [
    "handle",
    "slug",
    "urlPath",
    "url",
    "path",
  ]);
  const slug = slugify(handle?.replace(/^\/+|\/+$/g, "") || title, entry.id);
  return `${BUILDER_DOCS_CONTENT_ROOT}/symbols/${safePathPart(
    entry.model,
    "symbol",
  )}/${slug}${BUILDER_DOCS_MDX_EXTENSION}`;
}

function stringFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function boolFromRecord(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

export function builderEntryTitle(entry: BuilderContentEntry) {
  const data = entry.data ?? {};
  return (
    stringFromRecord(data, ["pageTitle", "title", "name", "headline"]) ??
    (typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : entry.id)
  );
}

export function builderEntryBlocks(entry: BuilderContentEntry): unknown[] {
  const data = entry.data ?? {};
  if (Array.isArray(data.blocks)) return data.blocks;
  if (typeof data.blocksString === "string" && data.blocksString.trim()) {
    try {
      const parsed = JSON.parse(data.blocksString) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function builderBlocksHash(blocks: unknown[]) {
  return stableHash(blocks);
}

export function builderSourceHash(entry: BuilderContentEntry) {
  const data = entry.data ?? {};
  return stableHash({
    id: entry.id,
    model: entry.model,
    published: entry.published,
    lastUpdated: normalizeRemoteUpdatedAt(entry),
    data: {
      ...data,
      blocks: builderEntryBlocks(entry),
      blocksString: undefined,
    },
  });
}

export function normalizeRemoteUpdatedAt(entry: BuilderContentEntry) {
  const value = entry.lastUpdated ?? entry.updatedDate ?? entry.createdDate;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function frontmatterValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function frontmatterLine(key: string, value: unknown) {
  if (value === undefined) return "";
  return `${key}: ${frontmatterValue(value)}`;
}

function frontmatterForEntry(args: {
  entry: BuilderContentEntry;
  path: string;
  sourceHash: string;
  blocksHash: string;
  rawRoot: string;
}) {
  const data = args.entry.data ?? {};
  const builder: BuilderMdxMetadata = {
    model: args.entry.model,
    entryId: args.entry.id,
    lastUpdated: normalizeRemoteUpdatedAt(args.entry),
    published: args.entry.published,
    sourceHash: args.sourceHash,
    blocksHash: args.blocksHash,
    rawRoot: args.rawRoot,
    path: args.path,
  };
  const base: Record<string, unknown> = {
    id: builderDocumentId(args.entry.model, args.entry.id),
    title: builderEntryTitle(args.entry),
    builder,
  };

  const fields =
    args.entry.model === "docs-content"
      ? ["urlPath", "pageTitle", "hideNav", "addNoIndex"]
      : [
          "handle",
          "blurb",
          "date",
          "author",
          "topics",
          "readTime",
          "image",
          "url",
        ];
  for (const field of fields) {
    if (field in data) base[field] = data[field];
  }
  return base;
}

function serializeFrontmatter(frontmatter: Record<string, unknown>) {
  const lines = Object.entries(frontmatter)
    .map(([key, value]) => frontmatterLine(key, value))
    .filter(Boolean);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function rawSidecarPath(args: {
  rawRoot: string;
  block: unknown;
  index: number;
}) {
  const id = isRecord(args.block) ? stringFromRecord(args.block, ["id"]) : null;
  const hash = stableHash(args.block).slice(0, 14);
  return `${args.rawRoot}/${safePathPart(id ?? `block-${args.index}`)}-${hash}.json`;
}

function componentName(block: unknown): string | null {
  if (!isRecord(block)) return null;
  const component = block.component;
  if (!isRecord(component)) return null;
  const name = component.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function componentOptions(block: unknown): Record<string, unknown> {
  if (!isRecord(block)) return {};
  const component = block.component;
  if (!isRecord(component)) return {};
  const options = component.options;
  return isRecord(options) ? options : {};
}

function childBlocks(block: unknown): unknown[] {
  if (!isRecord(block)) return [];
  return Array.isArray(block.children) ? block.children : [];
}

function symbolContentEntry(
  symbol: Record<string, unknown>,
): BuilderContentEntry | null {
  const content = isRecord(symbol.content) ? symbol.content : null;
  if (!content) return null;
  const rawModel = stringFromRecord(symbol, ["model"]);
  const rawEntry = stringFromRecord(symbol, ["entry"]);
  const id = stringFromRecord(content, ["id", "entry", "uid"]) ?? rawEntry;
  if (!id) return null;

  const model =
    stringFromRecord(content, ["model", "modelName", "queryModel"]) ??
    rawModel ??
    "symbol";
  const data = isRecord(content.data)
    ? (JSON.parse(JSON.stringify(content.data)) as Record<string, unknown>)
    : {};
  if (!Array.isArray(data.blocks) && Array.isArray(content.blocks)) {
    data.blocks = content.blocks;
  }
  if (!data.blocks) return null;

  return {
    ...content,
    id,
    model,
    name:
      stringFromRecord(content, ["name"]) ??
      stringFromRecord(data, ["title", "pageTitle", "name"]) ??
      id,
    published:
      typeof content.published === "string" ? content.published : undefined,
    lastUpdated:
      typeof content.lastUpdated === "string" ||
      typeof content.lastUpdated === "number"
        ? content.lastUpdated
        : typeof content.updatedDate === "string" ||
            typeof content.updatedDate === "number"
          ? content.updatedDate
          : undefined,
    data,
  };
}

function blockSummary(block: unknown) {
  const name = componentName(block);
  const options = componentOptions(block);
  if (name === "Text" && typeof options.text === "string") {
    return stripHtml(options.text).slice(0, 160);
  }
  return name ?? "Builder block";
}

function rawRefData(args: {
  block: unknown;
  rawRef: string;
  componentName?: string;
}): BuilderRawRefData {
  return {
    rawRef: args.rawRef,
    rawHash: stableHash(args.block),
    componentName: args.componentName,
  };
}

interface BlocksToMdxContext {
  rawRoot: string;
  files: Record<string, string>;
  warnings: string[];
  emitReferencedEntry: (entry: BuilderContentEntry) => Promise<string>;
}

async function builderBlocksToMdxBody(
  blocks: unknown[],
  ctx: BlocksToMdxContext,
) {
  const mdxBlocks: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const rawRef = rawSidecarPath({ rawRoot: ctx.rawRoot, block, index });
    ctx.files[rawRef] = stableJson(block);
    mdxBlocks.push(await builderBlockToMdx(block, rawRef, ctx));
  }
  return mdxBlocks.filter(Boolean).join("\n\n").trim();
}

async function builderBlockToMdx(
  block: unknown,
  rawRef: string,
  ctx: BlocksToMdxContext,
) {
  const name = componentName(block);
  const options = componentOptions(block);
  const raw = rawRefData({ block, rawRef, componentName: name ?? undefined });
  const id =
    (isRecord(block) ? stringFromRecord(block, ["id"]) : null) ??
    `builder-${stableHash(block).slice(0, 12)}`;

  if (name === "Text") {
    const data: BuilderTextData = {
      ...raw,
      body: htmlToMarkdown(String(options.text ?? "")).trim(),
    };
    return serializeRegistryBlockToMdx("builder-text", {
      id,
      data,
    });
  }

  if (name === "Code Block" || name === "Blog Code Block") {
    const data: BuilderCodeBlockData = {
      ...raw,
      code: String(options.code ?? ""),
      language:
        typeof options.language === "string" ? options.language : undefined,
      filename:
        typeof options.filename === "string" ? options.filename : undefined,
      dark: typeof options.dark === "boolean" ? options.dark : undefined,
      url: typeof options.url === "string" ? options.url : undefined,
    };
    return serializeRegistryBlockToMdx("builder-code-block", {
      id,
      data,
    });
  }

  if (name === "CodeSnippetsV2") {
    const data: BuilderCodeSnippetsV2Data = {
      ...raw,
      modelName:
        typeof options.modelName === "string" ? options.modelName : undefined,
      modelType:
        typeof options.modelType === "string" ? options.modelType : undefined,
      customTabContent: isRecord(options.customTabContent)
        ? options.customTabContent
        : undefined,
      reuseRemixContentForHydrogen: boolFromRecord(
        options,
        "reuseRemixContentForHydrogen",
      ),
      convenientEditingMode: boolFromRecord(options, "convenientEditingMode"),
      simple: boolFromRecord(options, "simple"),
    };
    return serializeRegistryBlockToMdx("builder-code-snippets-v2", {
      id,
      data,
    });
  }

  if (name === "Tabbed Content") {
    const tabs = Array.isArray(options.tabs) ? options.tabs : [];
    const convertedTabs = await Promise.all(
      tabs.map(async (tab, tabIndex) => {
        const tabRecord = isRecord(tab) ? tab : {};
        const content = Array.isArray(tabRecord.content)
          ? tabRecord.content
          : [];
        return {
          label:
            typeof tabRecord.label === "string" && tabRecord.label.trim()
              ? tabRecord.label.trim()
              : `Tab ${tabIndex + 1}`,
          body: await builderBlocksToMdxBody(content, ctx),
        };
      }),
    );
    const data: BuilderTabbedContentData = {
      ...raw,
      title: typeof options.title === "string" ? options.title : undefined,
      tabs: convertedTabs.length
        ? convertedTabs
        : [{ label: "Tab 1", body: "" }],
    };
    return serializeRegistryBlockToMdx("builder-tabbed-content", {
      id,
      data,
    });
  }

  if (name === "Symbol") {
    const symbol = isRecord(options.symbol) ? options.symbol : {};
    const contentEntry = symbolContentEntry(symbol);
    const source = contentEntry
      ? await ctx.emitReferencedEntry(contentEntry)
      : undefined;
    const data: BuilderSymbolData = {
      ...raw,
      entry: typeof symbol.entry === "string" ? symbol.entry : undefined,
      model: typeof symbol.model === "string" ? symbol.model : undefined,
      source,
      dynamic:
        boolFromRecord(symbol, "dynamic") ??
        boolFromRecord(symbol, "isDynamic") ??
        boolFromRecord(options, "dynamicSymbol"),
      data: isRecord(symbol.data) ? symbol.data : undefined,
    };
    return serializeRegistryBlockToMdx("builder-symbol", {
      id,
      data,
    });
  }

  const data: BuilderRawBlockData = {
    ...raw,
    summary: blockSummary(block),
  };
  const serialized = serializeRegistryBlockToMdx("builder-raw-block", {
    id,
    data,
  });
  const children = childBlocks(block);
  if (children.length) {
    ctx.warnings.push(
      `${name ?? "Unmodeled block"} has child blocks that are preserved only in the raw sidecar.`,
    );
  }
  return serialized;
}

export async function builderEntryToMdxBundle(
  entry: BuilderContentEntry,
): Promise<BuilderMdxBundle> {
  const files: Record<string, string> = {};
  const warnings: string[] = [];
  const emitted = new Set<string>();
  const mdx = await emitBuilderEntryToMdxFile({
    entry,
    files,
    warnings,
    emitted,
    symbolPath: false,
  });
  return { mdx, files, blocks: builderEntryBlocks(entry) };
}

async function emitBuilderEntryToMdxFile({
  entry,
  files,
  warnings,
  emitted,
  symbolPath,
}: {
  entry: BuilderContentEntry;
  files: Record<string, string>;
  warnings: string[];
  emitted: Set<string>;
  symbolPath: boolean;
}): Promise<BuilderMdxFile> {
  const path = symbolPath
    ? builderSymbolMdxPathForEntry(entry)
    : builderMdxPathForEntry(entry);
  const key = `${entry.model}:${entry.id}:${path}`;
  if (emitted.has(key)) {
    return {
      path,
      documentId: builderDocumentId(entry.model, entry.id),
      title: builderEntryTitle(entry),
      metadata: {
        model: entry.model,
        entryId: entry.id,
        lastUpdated: normalizeRemoteUpdatedAt(entry),
        published: entry.published,
        sourceHash: builderSourceHash(entry),
        blocksHash: builderBlocksHash(builderEntryBlocks(entry)),
        rawRoot: builderRawRootForEntry(entry.model, entry.id),
        path,
      },
      frontmatter: {},
      body: "",
      source: files[path] ?? "",
    };
  }
  emitted.add(key);

  const blocks = builderEntryBlocks(entry);
  const rawRoot = builderRawRootForEntry(entry.model, entry.id);
  const ctx: BlocksToMdxContext = {
    rawRoot,
    files,
    warnings,
    emitReferencedEntry: async (referencedEntry) => {
      const nested = await emitBuilderEntryToMdxFile({
        entry: referencedEntry,
        files,
        warnings,
        emitted,
        symbolPath: true,
      });
      return nested.path;
    },
  };
  const body = await builderBlocksToMdxBody(blocks, ctx);
  const blocksHash = builderBlocksHash(blocks);
  const sourceHash = builderSourceHash(entry);
  const frontmatter = frontmatterForEntry({
    entry,
    path,
    sourceHash,
    blocksHash,
    rawRoot,
  });
  const source = `${serializeFrontmatter(frontmatter)}${body}\n`;
  const metadata = (frontmatter.builder ?? {}) as BuilderMdxMetadata;
  const mdx: BuilderMdxFile = {
    path,
    documentId: String(frontmatter.id),
    title: String(frontmatter.title),
    metadata,
    frontmatter,
    body,
    source,
  };
  files[path] = source;
  return mdx;
}

function parseFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = parseFrontmatterValue(match[2] ?? "");
  }
  return data;
}

export function parseBuilderMdxFile(
  path: string,
  source: string,
): BuilderMdxFile {
  const match = source.match(FRONTMATTER_RE);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const builder = frontmatter.builder;
  if (!isRecord(builder)) {
    throw new Error("Missing builder frontmatter metadata.");
  }
  const metadata = normalizeBuilderMetadata(builder, path);
  const body = match ? source.slice(match[0].length).trim() : source.trim();
  return {
    path,
    documentId:
      typeof frontmatter.id === "string" && frontmatter.id.trim()
        ? frontmatter.id.trim()
        : builderDocumentId(metadata.model, metadata.entryId),
    title:
      typeof frontmatter.title === "string" && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : metadata.entryId,
    metadata,
    frontmatter,
    body,
    source,
  };
}

export function normalizeBuilderMetadata(
  builder: Record<string, unknown>,
  fallbackPath = "",
): BuilderMdxMetadata {
  const model = typeof builder.model === "string" ? builder.model.trim() : "";
  const entryId =
    typeof builder.entryId === "string" ? builder.entryId.trim() : "";
  const sourceHash =
    typeof builder.sourceHash === "string" ? builder.sourceHash.trim() : "";
  const blocksHash =
    typeof builder.blocksHash === "string" ? builder.blocksHash.trim() : "";
  const rawRoot =
    typeof builder.rawRoot === "string" && builder.rawRoot.trim()
      ? builder.rawRoot.trim()
      : builderRawRootForEntry(model, entryId);
  const path =
    typeof builder.path === "string" && builder.path.trim()
      ? builder.path.trim()
      : fallbackPath;
  if (!model || !entryId || !sourceHash || !blocksHash) {
    throw new Error(
      "Builder frontmatter must include model, entryId, sourceHash, and blocksHash.",
    );
  }
  return {
    model,
    entryId,
    sourceHash,
    blocksHash,
    rawRoot,
    path,
    lastUpdated:
      typeof builder.lastUpdated === "string" ? builder.lastUpdated : undefined,
    published:
      typeof builder.published === "string" ? builder.published : undefined,
  };
}

async function parseMdxRoot(body: string): Promise<MdxNode> {
  const [{ unified }, remarkParse, remarkMdx] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-mdx"),
  ]);
  return unified()
    .use(remarkParse.default)
    .use(remarkMdx.default)
    .parse(body) as MdxNode;
}

function nodeSlice(body: string, node: MdxNode) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end < start
  ) {
    return "";
  }
  return body.slice(start, end).trim();
}

function freshTextBlock(markdown: string): unknown {
  const text = markdownToBuilderTextHtml(markdown);
  return {
    "@type": "@builder.io/sdk:Element",
    "@version": 2,
    id: `builder-mdx-${stableHash(markdown).slice(0, 16)}`,
    component: {
      name: "Text",
      options: { text },
    },
    responsiveStyles: {
      large: {
        display: "flex",
        flexDirection: "column",
        position: "relative",
      },
    },
  };
}

function rawBlockForData(
  data: BuilderRawRefData,
  sidecars: Record<string, string>,
): Record<string, unknown> {
  if (!data.rawRef || !data.rawHash) {
    throw new Error("Builder MDX block is missing rawRef/rawHash.");
  }
  const raw = sidecars[data.rawRef];
  if (raw === undefined) {
    throw new Error(`Missing Builder raw sidecar: ${data.rawRef}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid Builder raw sidecar ${data.rawRef}: ${error.message}`
        : `Invalid Builder raw sidecar ${data.rawRef}.`,
    );
  }
  const actualHash = stableHash(parsed);
  if (actualHash !== data.rawHash) {
    throw new Error(
      `Builder raw sidecar hash mismatch for ${data.rawRef}: expected ${data.rawHash}, got ${actualHash}.`,
    );
  }
  return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
}

function ensureComponentOptions(
  block: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const component = isRecord(block.component) ? block.component : {};
  component.name = name;
  const options = isRecord(component.options) ? component.options : {};
  component.options = options;
  block.component = component;
  return options;
}

function normalizeMarkdownForCompare(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").trim();
}

function applyTextData(
  data: BuilderTextData,
  sidecars: Record<string, string>,
) {
  const block = rawBlockForData(data, sidecars);
  const rawOptions = componentOptions(block);
  const originalBody = htmlToMarkdown(String(rawOptions.text ?? ""));
  if (
    normalizeMarkdownForCompare(data.body) ===
    normalizeMarkdownForCompare(originalBody)
  ) {
    return block;
  }
  const options = ensureComponentOptions(block, data.componentName ?? "Text");
  options.text = markdownToBuilderTextHtml(data.body);
  return block;
}

function applyCodeBlockData(
  data: BuilderCodeBlockData,
  sidecars: Record<string, string>,
) {
  const block = rawBlockForData(data, sidecars);
  const options = ensureComponentOptions(
    block,
    data.componentName ?? "Code Block",
  );
  options.code = data.code;
  if (data.language !== undefined) options.language = data.language;
  if (data.filename !== undefined) options.filename = data.filename;
  if (data.dark !== undefined) options.dark = data.dark;
  if (data.url !== undefined) options.url = data.url;
  return block;
}

function applyCodeSnippetsV2Data(
  data: BuilderCodeSnippetsV2Data,
  sidecars: Record<string, string>,
) {
  const block = rawBlockForData(data, sidecars);
  const options = ensureComponentOptions(block, "CodeSnippetsV2");
  for (const key of [
    "modelName",
    "modelType",
    "customTabContent",
    "reuseRemixContentForHydrogen",
    "convenientEditingMode",
    "simple",
  ] as const) {
    if (data[key] !== undefined) options[key] = data[key];
  }
  return block;
}

async function applyTabbedContentData(
  data: BuilderTabbedContentData,
  sidecars: Record<string, string>,
) {
  const block = rawBlockForData(data, sidecars);
  const options = ensureComponentOptions(block, "Tabbed Content");
  if (data.title !== undefined) options.title = data.title;
  const rawTabs = Array.isArray(options.tabs) ? options.tabs : [];
  options.tabs = await Promise.all(
    data.tabs.map(async (tab, index) => {
      const rawTab = isRecord(rawTabs[index])
        ? (JSON.parse(JSON.stringify(rawTabs[index])) as Record<
            string,
            unknown
          >)
        : {};
      return {
        ...rawTab,
        label: tab.label,
        content: await builderBodyToBlocks(tab.body, sidecars),
      };
    }),
  );
  return block;
}

function applySymbolData(
  data: BuilderSymbolData,
  sidecars: Record<string, string>,
) {
  const block = rawBlockForData(data, sidecars);
  const options = ensureComponentOptions(block, "Symbol");
  const symbol = isRecord(options.symbol) ? options.symbol : {};
  const rawEntry =
    typeof symbol.entry === "string" && symbol.entry.trim()
      ? symbol.entry
      : undefined;
  const rawModel =
    typeof symbol.model === "string" && symbol.model.trim()
      ? symbol.model
      : undefined;
  if (data.entry !== undefined && data.entry !== rawEntry) {
    throw new Error(
      "Builder Symbol entry is read-only in Builder MDX. Pull or retarget the Symbol through an explicit Builder workflow.",
    );
  }
  if (data.model !== undefined && data.model !== rawModel) {
    throw new Error(
      "Builder Symbol model is read-only in Builder MDX. Pull or retarget the Symbol through an explicit Builder workflow.",
    );
  }
  if (data.data !== undefined) symbol.data = data.data;
  options.symbol = symbol;
  return block;
}

async function blockFromMdxComponent(
  raw: string,
  sidecars: Record<string, string>,
): Promise<unknown | null> {
  const parsed = await parseRegistryBlockData(raw);
  if (!parsed) return null;
  switch (parsed.type) {
    case "builder-text":
      return applyTextData(parsed.data as BuilderTextData, sidecars);
    case "builder-code-block":
      return applyCodeBlockData(parsed.data as BuilderCodeBlockData, sidecars);
    case "builder-code-snippets-v2":
      return applyCodeSnippetsV2Data(
        parsed.data as BuilderCodeSnippetsV2Data,
        sidecars,
      );
    case "builder-tabbed-content":
      return await applyTabbedContentData(
        parsed.data as BuilderTabbedContentData,
        sidecars,
      );
    case "builder-symbol":
      return applySymbolData(parsed.data as BuilderSymbolData, sidecars);
    case "builder-raw-block":
      return rawBlockForData(parsed.data as BuilderRawBlockData, sidecars);
    default:
      return null;
  }
}

async function builderBodyToBlocks(
  body: string,
  sidecars: Record<string, string>,
) {
  const root = await parseMdxRoot(body);
  const blocks: unknown[] = [];
  for (const child of root.children ?? []) {
    const raw = nodeSlice(body, child);
    if (!raw) continue;
    if (
      child.type === "mdxJsxFlowElement" ||
      child.type === "mdxJsxTextElement"
    ) {
      const block = await blockFromMdxComponent(raw, sidecars);
      if (block) {
        blocks.push(block);
        continue;
      }
      throw new Error(
        `Unsupported Builder MDX component: <${child.name || "unknown"}>.`,
      );
    }
    if (child.type === "mdxjsEsm") {
      throw new Error(
        "Unsupported Builder MDX syntax: import/export statements cannot be pushed to Builder.",
      );
    }
    blocks.push(freshTextBlock(raw));
  }
  return blocks;
}

export async function builderMdxToBuilderBlocks(args: {
  path: string;
  source: string;
  sidecars: Record<string, string>;
}): Promise<BuilderBlocksFromMdxResult> {
  const mdx = parseBuilderMdxFile(args.path, args.source);
  const blocks = await builderBodyToBlocks(mdx.body, args.sidecars);
  const blocksHash = builderBlocksHash(blocks);
  const sourceHash = stableHash({
    model: mdx.metadata.model,
    entryId: mdx.metadata.entryId,
    lastUpdated: mdx.metadata.lastUpdated,
    blocksHash,
  });
  return {
    metadata: mdx.metadata,
    blocks,
    blocksHash,
    sourceHash,
    warnings: [],
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function inlineHtmlToMarkdown(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "_$1_")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "_$1_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      "[$2]($1)",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function htmlToMarkdown(html: string) {
  let source = html.trim();
  if (!source) return "";
  source = source
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => {
      return `\n${"#".repeat(Number(level))} ${inlineHtmlToMarkdown(body)}\n`;
    })
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_match, body) => {
      return `\n${inlineHtmlToMarkdown(body)}\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, body) => {
      return `\n- ${inlineHtmlToMarkdown(body)}\n`;
    })
    .replace(/<\/?(ul|ol|blockquote)[^>]*>/gi, "\n");
  return inlineHtmlToMarkdown(source)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToHtml(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToBuilderTextHtml(markdown: string) {
  const lines = markdown.trim().split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }
    const list = trimmed.match(/^[-*]\s+(.+)$/);
    if (list) {
      listItems.push(`<li>${inlineMarkdownToHtml(list[1])}</li>`);
      continue;
    }
    flushList();
    html.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  }
  flushList();
  return html.join("\n");
}
