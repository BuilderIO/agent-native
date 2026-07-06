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
  builderSourceComponentMappingFor,
  type BuilderSourceComponentMapping,
  unknownBuilderSourceComponentMappingFor,
} from "./builder-source-component-registry";
import {
  parseRegistryBlockData,
  serializeRegistryBlockToMdx,
} from "./nfm-registry";
import type {
  SourceComponentData,
  SourceComponentPreview,
  SourceComponentPreviewTable,
} from "./source-component-block";

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

export interface BuilderReadableBodyMergeResult {
  blocks: unknown[] | null;
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

function shouldReadThroughBuilderChildren(componentName: string | null) {
  return (
    builderSourceComponentMappingFor(componentName).mappingStatus === "unknown"
  );
}

function isReadableUnsupportedBuilderPlaceholder(value: string) {
  const trimmed = value.trim();
  return (
    /^>\s*Builder .+ component preserved from source\.$/.test(trimmed) ||
    /^<SourceComponent\b/.test(trimmed)
  );
}

function countReadableSourceComponentMarkers(markdown: string) {
  return markdownUnits(markdown).filter(isReadableUnsupportedBuilderPlaceholder)
    .length;
}

function sourceComponentMarkerIdForBlock(block: unknown) {
  return `source-component-builder-${safePathPart(
    builderBlockStableId(block, stableHash(block).slice(0, 12)),
  )}`;
}

function builderImageMarkdown(options: Record<string, unknown>) {
  const imageUrl =
    typeof options.image === "string" ? options.image.trim() : "";
  if (!imageUrl) return "";
  const altText =
    typeof options.altText === "string"
      ? options.altText.trim()
      : typeof options.alt === "string"
        ? options.alt.trim()
        : "";
  return `![${escapeMarkdownImageAlt(altText)}](${escapeMarkdownImageUrl(
    imageUrl,
  )})`;
}

function escapeMarkdownImageAlt(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function unescapeMarkdownImageAlt(value: string) {
  return value.replace(/\\]/g, "]").replace(/\\\\/g, "\\");
}

function escapeMarkdownImageUrl(value: string) {
  return value.replace(/\\/g, "%5C").replace(/\)/g, "%29");
}

function unescapeMarkdownImageUrl(value: string) {
  return value.replace(/%29/gi, ")").replace(/%5C/gi, "\\");
}

function parseMarkdownImage(markdown: string) {
  const trimmed = markdown.trim();
  const match = trimmed.match(
    /^!\[((?:\\.|[^\]\\])*)\]\((\S+?)(?:\s+"[^"]*")?\)$/,
  );
  if (!match) return null;
  return {
    alt: unescapeMarkdownImageAlt(match[1]),
    src: unescapeMarkdownImageUrl(match[2]),
  };
}

async function readableLayoutFingerprint(markdown: string) {
  const units = markdownUnits(markdown);
  const fingerprint: string[] = [];
  for (const unit of units) {
    if (/^>\s*Builder .+ component preserved from source\.$/.test(unit)) {
      fingerprint.push("source:legacy");
      continue;
    }
    if (/^<SourceComponent\b/.test(unit.trim())) {
      const parsed = await parseRegistryBlockData(unit);
      const id = parsed?.base.id || "missing-id";
      fingerprint.push(`source:${id}`);
      continue;
    }
    fingerprint.push("prose");
  }
  return fingerprint;
}

async function expectedReadableLayoutFingerprint(blocks: unknown[]) {
  const fingerprint: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const name = componentName(block);
    const options = componentOptions(block);
    if (name === "Text") {
      for (const unit of markdownUnits(
        htmlToMarkdown(String(options.text ?? "")),
      )) {
        if (unit) fingerprint.push("prose");
      }
      continue;
    }
    if (name === "Code Block" || name === "Blog Code Block") {
      if (readableCodeBlockMarkdown(options).trim()) fingerprint.push("prose");
      continue;
    }
    if (name === "Image") {
      if (builderImageMarkdown(options)) fingerprint.push("prose");
      continue;
    }
    if (name === "Tabbed Content") {
      const tabs = Array.isArray(options.tabs) ? options.tabs : [];
      for (const tab of tabs) {
        const content =
          isRecord(tab) && Array.isArray(tab.content) ? tab.content : [];
        if (content.some(builderBlockHasReadableOutput)) {
          fingerprint.push("prose");
          fingerprint.push(
            ...(await expectedReadableLayoutFingerprint(content)),
          );
        }
      }
      continue;
    }
    const children = childBlocks(block);
    if (shouldReadThroughBuilderChildren(name) && children.length) {
      fingerprint.push(...(await expectedReadableLayoutFingerprint(children)));
      continue;
    }
    fingerprint.push(`source:${sourceComponentMarkerIdForBlock(block)}`);
  }
  return fingerprint;
}

async function validateReadableSourceComponentMarkers(
  markdown: string,
  sidecars: Record<string, string>,
) {
  const warnings: string[] = [];
  const markers = markdownUnits(markdown).filter((unit) =>
    /^<SourceComponent\b/.test(unit.trim()),
  );
  for (const marker of markers) {
    try {
      const parsed = await parseRegistryBlockData(marker);
      if (parsed?.type !== "source-component") {
        warnings.push("Readable Builder body has an invalid source marker.");
        continue;
      }
      rawBlockForData(parsed.data as SourceComponentData, sidecars);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : "Readable Builder body has a source marker that could not be validated.",
      );
    }
  }
  return warnings;
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
  if (typeof options.url === "string" && options.url.trim()) {
    return options.url.trim().slice(0, 160);
  }
  if (typeof options.title === "string" && options.title.trim()) {
    return options.title.trim().slice(0, 160);
  }
  return name ?? "Builder block";
}

function countArrayColumns(rows: unknown[]) {
  return rows.reduce<number>((max, row) => {
    if (Array.isArray(row)) return Math.max(max, row.length);
    if (!isRecord(row)) return max;
    for (const key of ["cells", "columns", "values"]) {
      const value = row[key];
      if (Array.isArray(value)) return Math.max(max, value.length);
    }
    return Math.max(max, Object.keys(row).length);
  }, 0);
}

function tableShapeFromOptions(options: Record<string, unknown>) {
  if (Array.isArray(options.bodyRows)) {
    const columns = options.bodyRows.reduce<number>(
      (max, row) => {
        if (!isRecord(row) || !Array.isArray(row.columns)) return max;
        return Math.max(max, row.columns.length);
      },
      Array.isArray(options.headColumns) ? options.headColumns.length : 0,
    );
    return {
      rows: options.bodyRows.length,
      columns,
    };
  }
  const candidates = [
    options.rows,
    options.data,
    isRecord(options.table) ? options.table.rows : undefined,
    isRecord(options.tableData) ? options.tableData.rows : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return {
        rows: candidate.length,
        columns: countArrayColumns(candidate),
      };
    }
  }
  const columns = Array.isArray(options.columns) ? options.columns.length : 0;
  if (columns) return { rows: 0, columns };
  return null;
}

function normalizePreviewScalar(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return stableJson(value);
}

function textFromBuilderBlocks(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      const name = componentName(block);
      const options = componentOptions(block);
      if (name === "Text") {
        return stripHtml(String(options.text ?? "")).trim();
      }
      return textFromBuilderBlocks(childBlocks(block));
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

function materialTablePreviewFromOptions(
  options: Record<string, unknown>,
): SourceComponentPreviewTable | undefined {
  const bodyRows = Array.isArray(options.bodyRows) ? options.bodyRows : [];
  if (!bodyRows.length) return undefined;
  const headColumns = Array.isArray(options.headColumns)
    ? options.headColumns
    : [];
  const columnCount = bodyRows.reduce<number>((max, row) => {
    if (!isRecord(row) || !Array.isArray(row.columns)) return max;
    return Math.max(max, row.columns.length);
  }, headColumns.length);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const head = headColumns[index];
    const label =
      isRecord(head) && typeof head.label === "string" && head.label.trim()
        ? head.label.trim()
        : `Column ${index + 1}`;
    return { id: `column-${index + 1}`, label };
  });
  const rows = bodyRows.slice(0, 6).map((row) => {
    const rowColumns =
      isRecord(row) && Array.isArray(row.columns) ? row.columns : [];
    return Object.fromEntries(
      columns.map((column, index) => {
        const cell = rowColumns[index];
        const content =
          isRecord(cell) && Array.isArray(cell.content) ? cell.content : [];
        return [column.id, textFromBuilderBlocks(content)];
      }),
    );
  });
  return {
    columns,
    rows,
    truncated: bodyRows.length > 6,
  };
}

function tablePreviewFromRows(rows: unknown[]): SourceComponentPreviewTable {
  const records = rows.slice(0, 6).map((row) => {
    if (Array.isArray(row)) {
      return Object.fromEntries(
        row.map((cell, index) => [
          `column-${index + 1}`,
          normalizePreviewScalar(cell),
        ]),
      );
    }
    if (!isRecord(row)) return { value: normalizePreviewScalar(row) };
    if (Array.isArray(row.cells)) {
      return Object.fromEntries(
        row.cells.map((cell, index) => [
          `column-${index + 1}`,
          normalizePreviewScalar(cell),
        ]),
      );
    }
    return Object.fromEntries(
      Object.entries(row)
        .slice(0, 12)
        .map(([key, value]) => [key, normalizePreviewScalar(value)]),
    );
  });
  const columnIds = Array.from(
    new Set(records.flatMap((record) => Object.keys(record))),
  ).slice(0, 12);
  return {
    columns: columnIds.map((id, index) => ({
      id,
      label: id.startsWith("column-") ? `Column ${index + 1}` : id,
    })),
    rows: records.map((record) =>
      Object.fromEntries(columnIds.map((id) => [id, record[id] ?? ""])),
    ),
    truncated: rows.length > 6 || columnIds.length > 12,
  };
}

function tablePreviewFromOptions(
  options: Record<string, unknown>,
): SourceComponentPreviewTable | undefined {
  const materialTable = materialTablePreviewFromOptions(options);
  if (materialTable) return materialTable;
  const candidates = [
    options.rows,
    options.data,
    isRecord(options.table) ? options.table.rows : undefined,
    isRecord(options.tableData) ? options.tableData.rows : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return tablePreviewFromRows(candidate);
  }
  const columns = Array.isArray(options.columns)
    ? options.columns.slice(0, 12).map((column, index) => {
        if (typeof column === "string" && column.trim()) {
          return { id: column, label: column };
        }
        if (isRecord(column)) {
          const id =
            stringFromRecord(column, ["id", "key", "name", "field"]) ??
            `column-${index + 1}`;
          const label =
            stringFromRecord(column, ["label", "title", "name"]) ?? id;
          return { id, label };
        }
        return { id: `column-${index + 1}`, label: `Column ${index + 1}` };
      })
    : [];
  return columns.length ? { columns, rows: [], truncated: false } : undefined;
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function builderSourceComponentPreview(
  block: unknown,
  mapping: BuilderSourceComponentMapping,
): Pick<
  SourceComponentData,
  "previewKind" | "previewUrl" | "previewItems" | "preview" | "summary"
> {
  const name = componentName(block);
  const options = componentOptions(block);
  const url = typeof options.url === "string" ? options.url.trim() : "";
  if (name === "Embed") {
    const summary = url ? `Embedded URL: ${url}` : "Embedded Builder content.";
    return {
      previewKind: "embed",
      previewUrl: url || undefined,
      previewItems: url ? [url] : undefined,
      preview: {
        status: url ? "available" : "unavailable",
        kind: "embed",
        label: "Builder Embed",
        summary,
        url: url || undefined,
      },
      summary,
    };
  }
  if (name === "Image") {
    const imageUrl =
      typeof options.image === "string" ? options.image.trim() : "";
    const altText =
      typeof options.altText === "string" ? options.altText.trim() : "";
    const summary = altText || "Builder image.";
    return {
      previewKind: "component",
      previewUrl: imageUrl || undefined,
      previewItems: altText ? [altText] : undefined,
      preview: {
        status: imageUrl ? "available" : "unavailable",
        kind: "component",
        label: "Builder Image",
        summary,
        url: imageUrl || undefined,
        fields: altText ? [{ label: "Alt", value: altText }] : undefined,
      },
      summary,
    };
  }
  if (mapping.id === "builder-table-preserved") {
    const shape = tableShapeFromOptions(options);
    const items = shape
      ? [pluralize(shape.rows, "row"), pluralize(shape.columns, "column")]
      : undefined;
    const summary = shape
      ? `Builder table with ${items?.join(", ")}.`
      : "Builder table component preserved from source.";
    return {
      previewKind: "table",
      previewItems: items,
      preview: {
        status: shape ? "available" : "unavailable",
        kind: "table",
        label: "Builder Table",
        summary,
        fields: items?.map((item) => {
          const [value, ...label] = item.split(" ");
          return { label: label.join(" "), value };
        }),
        table: tablePreviewFromOptions(options),
      },
      summary,
    };
  }
  if (name === "Symbol") {
    const symbol = isRecord(options.symbol) ? options.symbol : {};
    const entry = typeof symbol.entry === "string" ? symbol.entry : "";
    const model = typeof symbol.model === "string" ? symbol.model : "";
    const fields = [
      model ? { label: "Model", value: model } : null,
      entry ? { label: "Entry", value: entry } : null,
    ].filter((field): field is { label: string; value: string } =>
      Boolean(field),
    );
    const summary =
      model || entry
        ? `Builder symbol ${[model, entry].filter(Boolean).join(" / ")}.`
        : "Builder symbol reference.";
    return {
      previewKind: "symbol",
      previewItems: [model, entry].filter(Boolean),
      preview: {
        status: fields.length ? "available" : "unavailable",
        kind: "symbol",
        label: "Builder Symbol",
        summary,
        fields: fields.length ? fields : undefined,
      },
      summary,
    };
  }
  const summary = blockSummary(block);
  const previewStatus =
    mapping.mappingStatus === "unknown" ? "warning" : "available";
  return {
    previewKind: "component",
    preview: {
      status: name ? previewStatus : "unavailable",
      kind: "component",
      label: mapping.label,
      summary,
    },
    summary,
  };
}

function builderBlockStableId(block: unknown, fallback: string) {
  if (isRecord(block)) {
    const id = stringFromRecord(block, ["id"]);
    if (id) return id;
  }
  return fallback;
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

async function builderBlocksToReadableMdxBody(
  blocks: unknown[],
  ctx: BlocksToMdxContext,
) {
  const mdxBlocks: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const rawRef = rawSidecarPath({ rawRoot: ctx.rawRoot, block, index });
    ctx.files[rawRef] = stableJson(block);
    mdxBlocks.push(await builderBlockToReadableMdx(block, rawRef, ctx));
  }
  return mdxBlocks.filter(Boolean).join("\n\n").trim();
}

export async function builderBlocksToReadableMarkdown(blocks: unknown[]) {
  return builderBlocksToReadableMdxBody(blocks, {
    rawRoot: `${BUILDER_DOCS_RAW_ROOT}/readable`,
    files: {},
    warnings: [],
    emitReferencedEntry: async (entry) => builderMdxPathForEntry(entry),
  });
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

  const mapping = builderSourceComponentMappingFor(name);
  if (mapping.mappingStatus === "preserved") {
    const data: BuilderRawBlockData = {
      ...raw,
      summary: blockSummary(block),
    };
    if (childBlocks(block).length) {
      ctx.warnings.push(
        `${mapping.label} has child blocks that are preserved only in the raw sidecar.`,
      );
    }
    return serializeRegistryBlockToMdx("builder-raw-block", {
      id,
      data,
    });
  }

  const children = childBlocks(block);
  if (children.length) {
    const childBody = await builderBlocksToMdxBody(children, ctx);
    if (childBody) return childBody;
  }

  const data: BuilderRawBlockData = {
    ...raw,
    summary: blockSummary(block),
  };
  const serialized = serializeRegistryBlockToMdx("builder-raw-block", {
    id,
    data,
  });
  if (children.length) {
    ctx.warnings.push(
      `${name ?? "Unmodeled block"} has child blocks that are preserved only in the raw sidecar.`,
    );
  }
  return serialized;
}

async function builderBlockToReadableMdx(
  block: unknown,
  rawRef: string,
  ctx: BlocksToMdxContext,
) {
  const name = componentName(block);
  const options = componentOptions(block);
  const mapping = builderSourceComponentMappingFor(name);

  if (name === "Text") {
    return htmlToMarkdown(String(options.text ?? "")).trim();
  }

  if (name === "Code Block" || name === "Blog Code Block") {
    const language =
      typeof options.language === "string" ? options.language.trim() : "";
    const code = String(options.code ?? "").trimEnd();
    return code ? `\`\`\`${language}\n${code}\n\`\`\`` : "";
  }

  if (name === "Image") {
    return builderImageMarkdown(options);
  }

  if (name === "Tabbed Content") {
    const tabs = Array.isArray(options.tabs) ? options.tabs : [];
    const convertedTabs = await Promise.all(
      tabs.map(async (tab, tabIndex) => {
        const tabRecord = isRecord(tab) ? tab : {};
        const content = Array.isArray(tabRecord.content)
          ? tabRecord.content
          : [];
        const label =
          typeof tabRecord.label === "string" && tabRecord.label.trim()
            ? tabRecord.label.trim()
            : `Tab ${tabIndex + 1}`;
        const body = await builderBlocksToReadableMdxBody(content, ctx);
        return body ? `### ${label}\n\n${body}` : "";
      }),
    );
    return convertedTabs.filter(Boolean).join("\n\n").trim();
  }

  const children = childBlocks(block);
  if (shouldReadThroughBuilderChildren(name) && children.length) {
    const childBody = await builderBlocksToReadableMdxBody(children, ctx);
    if (childBody) return childBody;
  }

  const markerMapping =
    mapping.readableMode === "editable-markdown"
      ? unknownBuilderSourceComponentMappingFor(name)
      : mapping;

  if (name) {
    ctx.warnings.push(
      `${markerMapping.label} is preserved in the Builder raw sidecar and shown as a read-only source component.`,
    );
  }
  const data: SourceComponentData = {
    provider: "builder",
    componentName: name || "Builder component",
    rawRef,
    rawHash: stableHash(block),
    sourceLabel: "Builder body",
    mappingId: markerMapping.id,
    mappingStatus: markerMapping.mappingStatus,
    mappingReason: markerMapping.reason,
    sourceEditState: markerMapping.sourceEditState,
    previewStatus:
      markerMapping.mappingStatus === "unknown"
        ? name
          ? "warning"
          : "unavailable"
        : name
          ? "available"
          : "unavailable",
    title: markerMapping.label,
    ...builderSourceComponentPreview(block, markerMapping),
  };
  const id = sourceComponentMarkerIdForBlock(block);
  return serializeRegistryBlockToMdx("source-component", { id, data });
}

function markdownUnits(markdown: string) {
  const units: string[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) units.push(value);
    current = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^(```|~~~)/);
    if (fenceMatch) {
      current.push(line);
      fence = fence ? null : fenceMatch[1];
      if (!fence) flush();
      continue;
    }
    if (fence) {
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return units;
}

function fencedCodeFromMarkdown(markdown: string) {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (match) return match[1];
  return trimmed;
}

interface ReadableEditableSegment {
  kind: "text" | "code" | "image" | "tab-label";
  block: Record<string, unknown>;
  baseline: string;
}

function readableCodeBlockMarkdown(options: Record<string, unknown>) {
  const language =
    typeof options.language === "string" ? options.language.trim() : "";
  const code = String(options.code ?? "").trimEnd();
  return code ? `\`\`\`${language}\n${code}\n\`\`\`` : "";
}

function collectReadableEditableSegments(
  blocks: unknown[],
  segments: ReadableEditableSegment[] = [],
) {
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const name = componentName(block);
    const options = componentOptions(block);
    if (name === "Text") {
      const baseline = htmlToMarkdown(String(options.text ?? "")).trim();
      if (baseline) segments.push({ kind: "text", block, baseline });
      continue;
    }
    if (name === "Code Block" || name === "Blog Code Block") {
      const baseline = readableCodeBlockMarkdown(options);
      if (baseline) segments.push({ kind: "code", block, baseline });
      continue;
    }
    if (name === "Image") {
      const baseline = builderImageMarkdown(options);
      if (baseline) segments.push({ kind: "image", block, baseline });
      continue;
    }
    if (name === "Tabbed Content") {
      const tabs = Array.isArray(options.tabs) ? options.tabs : [];
      for (let index = 0; index < tabs.length; index += 1) {
        const tab = tabs[index];
        const tabRecord = isRecord(tab) ? tab : {};
        const content = Array.isArray(tabRecord.content)
          ? tabRecord.content
          : [];
        if (!content.some(builderBlockHasReadableOutput)) continue;
        const label =
          typeof tabRecord.label === "string" && tabRecord.label.trim()
            ? tabRecord.label.trim()
            : `Tab ${index + 1}`;
        segments.push({
          kind: "tab-label",
          block: tabRecord,
          baseline: `### ${label}`,
        });
        collectReadableEditableSegments(content, segments);
      }
      continue;
    }
    if (shouldReadThroughBuilderChildren(name)) {
      collectReadableEditableSegments(childBlocks(block), segments);
    }
  }
  return segments;
}

function builderBlockHasReadableOutput(block: unknown): boolean {
  if (!isRecord(block)) return false;
  const name = componentName(block);
  const options = componentOptions(block);
  if (name === "Text") {
    return htmlToMarkdown(String(options.text ?? "")).trim().length > 0;
  }
  if (name === "Code Block" || name === "Blog Code Block") {
    return readableCodeBlockMarkdown(options).trim().length > 0;
  }
  if (name === "Image") {
    return builderImageMarkdown(options).trim().length > 0;
  }
  if (name === "Tabbed Content") {
    const tabs = Array.isArray(options.tabs) ? options.tabs : [];
    return tabs.some((tab) => {
      const content =
        isRecord(tab) && Array.isArray(tab.content) ? tab.content : [];
      return content.some(builderBlockHasReadableOutput);
    });
  }
  const children = childBlocks(block);
  return shouldReadThroughBuilderChildren(name) && children.length
    ? children.some(builderBlockHasReadableOutput)
    : true;
}

function countExpectedReadableSourceComponentMarkers(
  blocks: unknown[],
): number {
  let count = 0;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const name = componentName(block);
    if (
      name === "Text" ||
      name === "Code Block" ||
      name === "Blog Code Block" ||
      name === "Image"
    ) {
      continue;
    }
    const options = componentOptions(block);
    if (name === "Tabbed Content") {
      const tabs = Array.isArray(options.tabs) ? options.tabs : [];
      for (const tab of tabs) {
        const content =
          isRecord(tab) && Array.isArray(tab.content) ? tab.content : [];
        count += countExpectedReadableSourceComponentMarkers(content);
      }
      continue;
    }
    const children = childBlocks(block);
    if (
      shouldReadThroughBuilderChildren(name) &&
      children.length &&
      children.some(builderBlockHasReadableOutput)
    ) {
      count += countExpectedReadableSourceComponentMarkers(children);
      continue;
    }
    count += 1;
  }
  return count;
}

export async function builderReadableBodyToBuilderBlocks(args: {
  localContent: string;
  losslessContent: string;
  sidecars: Record<string, string>;
}): Promise<BuilderReadableBodyMergeResult> {
  const baselineBlocks = await builderMdxBodyToBuilderBlocks(
    args.losslessContent,
    args.sidecars,
  );
  const segments = collectReadableEditableSegments(baselineBlocks);
  const expectedSourceMarkerCount =
    countExpectedReadableSourceComponentMarkers(baselineBlocks);
  const currentSourceMarkerCount = countReadableSourceComponentMarkers(
    args.localContent,
  );
  if (expectedSourceMarkerCount !== currentSourceMarkerCount) {
    return {
      blocks: null,
      warnings: [
        `Readable Builder body changed preserved source component markers from ${expectedSourceMarkerCount} to ${currentSourceMarkerCount}; refresh or review in Builder before pushing.`,
      ],
    };
  }
  const sourceMarkerWarnings = await validateReadableSourceComponentMarkers(
    args.localContent,
    args.sidecars,
  );
  if (sourceMarkerWarnings.length) {
    return {
      blocks: null,
      warnings: sourceMarkerWarnings,
    };
  }
  const [expectedLayout, currentLayout] = await Promise.all([
    expectedReadableLayoutFingerprint(baselineBlocks),
    readableLayoutFingerprint(args.localContent),
  ]);
  if (expectedLayout.join("\n") !== currentLayout.join("\n")) {
    return {
      blocks: null,
      warnings: [
        "Readable Builder body changed structure or moved or restructured preserved source component markers; refresh or review in Builder before pushing.",
      ],
    };
  }
  if (!segments.length) {
    return { blocks: baselineBlocks, warnings: [] };
  }

  const baselineUnitCounts = segments.map(
    (segment) => markdownUnits(segment.baseline).length,
  );
  const currentUnits = markdownUnits(args.localContent).filter(
    (unit) => !isReadableUnsupportedBuilderPlaceholder(unit),
  );
  const expectedUnitCount = baselineUnitCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  if (currentUnits.length !== expectedUnitCount) {
    return {
      blocks: null,
      warnings: [
        `Readable Builder body changed structure from ${expectedUnitCount} markdown blocks to ${currentUnits.length}; review in Builder before pushing.`,
      ],
    };
  }

  let offset = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const count = baselineUnitCounts[index];
    const nextMarkdown = currentUnits
      .slice(offset, offset + count)
      .join("\n\n");
    offset += count;
    if (segment.kind === "tab-label") {
      const match = nextMarkdown.trim().match(/^#{3}\s+(.+)$/);
      if (!match?.[1]?.trim()) {
        return {
          blocks: null,
          warnings: [
            "Readable Builder tab heading changed into unsupported markdown; keep it as a level-3 heading before pushing.",
          ],
        };
      }
      segment.block.label = match[1].trim();
    } else if (segment.kind === "text") {
      const options = ensureComponentOptions(segment.block, "Text");
      options.text = markdownToBuilderTextHtml(nextMarkdown);
    } else if (segment.kind === "image") {
      const options = ensureComponentOptions(segment.block, "Image");
      const image = parseMarkdownImage(nextMarkdown);
      if (!image?.src) {
        return {
          blocks: null,
          warnings: [
            "Readable Builder image changed into unsupported markdown; keep it as a standard image block before pushing.",
          ],
        };
      }
      options.image = image.src;
      options.altText = image.alt;
    } else {
      const options = ensureComponentOptions(
        segment.block,
        componentName(segment.block) ?? "Code Block",
      );
      options.code = fencedCodeFromMarkdown(nextMarkdown);
    }
  }

  return { blocks: baselineBlocks, warnings: [] };
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

export async function builderEntryToReadableMdxBundle(
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
    readableBody: true,
  });
  return { mdx, files, blocks: builderEntryBlocks(entry) };
}

async function emitBuilderEntryToMdxFile({
  entry,
  files,
  warnings,
  emitted,
  symbolPath,
  readableBody = false,
}: {
  entry: BuilderContentEntry;
  files: Record<string, string>;
  warnings: string[];
  emitted: Set<string>;
  symbolPath: boolean;
  readableBody?: boolean;
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
        readableBody,
      });
      return nested.path;
    },
  };
  const body = readableBody
    ? await builderBlocksToReadableMdxBody(blocks, ctx)
    : await builderBlocksToMdxBody(blocks, ctx);
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

function freshImageBlock(markdown: string): unknown | null {
  const image = parseMarkdownImage(markdown);
  if (!image?.src) return null;
  return {
    "@type": "@builder.io/sdk:Element",
    "@version": 2,
    id: `builder-mdx-image-${stableHash(markdown).slice(0, 16)}`,
    component: {
      name: "Image",
      options: {
        image: image.src,
        altText: image.alt,
      },
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
        content: await builderMdxBodyToBuilderBlocks(tab.body, sidecars),
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
    case "source-component":
      return rawBlockForData(parsed.data as SourceComponentData, sidecars);
    default:
      return null;
  }
}

export async function builderMdxBodyToBuilderBlocks(
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
    const imageBlock = freshImageBlock(raw);
    if (imageBlock) {
      blocks.push(imageBlock);
      continue;
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
  const blocks = await builderMdxBodyToBuilderBlocks(mdx.body, args.sidecars);
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
