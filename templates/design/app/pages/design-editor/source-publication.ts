import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  hasCanonicalCodeLayerNodeIds,
  mapCodeLayerSourceOffsetThroughEdits,
  type CodeLayerProjection,
  type CodeLayerSource,
  type CodeLayerSourceEdit,
  type CodeLayerNode,
} from "@shared/code-layer";
import { isStandaloneHttpUrl } from "@shared/html-content";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";

export interface CanonicalSourceContentResult {
  content: string;
  changed: boolean;
  nodeIdMap: ReadonlyMap<string, string>;
}

const CANONICAL_SOURCE_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CANONICAL_SOURCE_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
const CANONICAL_SOURCE_CACHE_MAX_NODES = 32_768;
const CANONICAL_SOURCE_CACHE_MAX_ENTRIES = 4096;
const canonicalSourceTextEncoder = new TextEncoder();
const canonicalSourceCache = new Map<
  string,
  {
    content: string;
    result: CanonicalSourceContentResult;
    projection?: CodeLayerProjection;
    retainedBytes: number;
    retainedNodes: number;
  }
>();
let canonicalSourceCacheBytes = 0;
let canonicalSourceCacheNodes = 0;

function removeCanonicalSourceCacheEntry(fileId: string): void {
  const cached = canonicalSourceCache.get(fileId);
  if (!cached) return;
  canonicalSourceCache.delete(fileId);
  canonicalSourceCacheBytes -= cached.retainedBytes;
  canonicalSourceCacheNodes -= cached.retainedNodes;
}

export function mapSourceNodeIds(
  before: readonly CodeLayerNode[],
  after: readonly CodeLayerNode[],
  edits: readonly CodeLayerSourceEdit[] = [],
): Map<string, string> {
  const targets = new Map(after.map((node) => [node.source?.openStart, node]));
  const result = new Map<string, string>();
  for (const node of before) {
    if (!node.source) continue;
    const offset = mapCodeLayerSourceOffsetThroughEdits(
      node.source.openStart,
      edits,
    );
    if (offset === null)
      throw new Error("Screen normalization removed a source element");
    const target = targets.get(offset);
    if (!target || target.tag !== node.tag) {
      throw new Error("Screen normalization lost a source element");
    }
    result.set(node.id, target.id);
  }
  if (new Set(result.values()).size !== result.size) {
    throw new Error("Screen normalization merged source identities");
  }
  return result;
}

export function designFileCodeLayerSource(
  designId: string | undefined,
  fileId: string,
  filename: string | undefined,
  kind: "design-file" | "inline-html" = "design-file",
): CodeLayerSource {
  return {
    kind,
    ...(designId ? { designId } : {}),
    fileId,
    ...(filename ? { filename } : {}),
  };
}

function sameCodeLayerSource(a: CodeLayerSource, b: CodeLayerSource) {
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  return (
    aKeys.length === Object.keys(bRecord).length &&
    aKeys.every((key) => aRecord[key] === bRecord[key])
  );
}

export function preparedSourceProjection(
  fileId: string,
  content: string,
  source: CodeLayerSource,
): CodeLayerProjection | undefined {
  const cached = canonicalSourceCache.get(fileId);
  if (!cached?.projection || cached.result.content !== content) {
    return undefined;
  }
  return sameCodeLayerSource(cached.projection.source, source)
    ? cached.projection
    : undefined;
}

export function prepareCanonicalSourceContent(
  content: string,
  options: {
    fileId: string;
    fileType?: string | null;
    source?: CodeLayerSource;
  },
): CanonicalSourceContentResult {
  const fileType = (options.fileType ?? "html").trim().toLowerCase();
  if (fileType !== "html" || !content.trim() || isStandaloneHttpUrl(content)) {
    return { content, changed: false, nodeIdMap: new Map() };
  }

  const cached = canonicalSourceCache.get(options.fileId);
  if (cached?.content === content) {
    canonicalSourceCache.delete(options.fileId);
    canonicalSourceCache.set(options.fileId, cached);
    return cached.result;
  }
  if (cached) removeCanonicalSourceCacheEntry(options.fileId);

  const source = options.source ?? {
    kind: "design-file" as const,
    fileId: options.fileId,
  };
  if (source.fileId !== options.fileId) {
    throw new Error("Canonical source projection must name the same file.");
  }
  if (hasCanonicalCodeLayerNodeIds(content)) {
    let nodeIdMap: Map<string, string> | undefined;
    const result: CanonicalSourceContentResult = {
      content,
      changed: false,
      get nodeIdMap() {
        nodeIdMap ??= new Map(
          buildCodeLayerProjection(content, { source }).nodes.map((node) => [
            node.id,
            node.id,
          ]),
        );
        return nodeIdMap;
      },
    };
    cacheCanonicalSource(options.fileId, content, result);
    return result;
  }
  const before = buildCodeLayerProjection(content, { source });
  const edits: CodeLayerSourceEdit[] = [];
  const prepared = ensureCodeLayerNodeIdsInHtml(content, {
    source,
    onSourceEdit: (edit) => edits.push(edit),
  });
  const after = prepared.changed
    ? buildCodeLayerProjection(prepared.content, { source })
    : before;
  if (
    after.nodes.some((node) => {
      const source = node.source;
      return !source || source.openEnd <= source.openStart;
    }) ||
    (prepared.changed &&
      ensureCodeLayerNodeIdsInHtml(prepared.content, { source }).changed)
  ) {
    throw new Error("Unable to publish stable code-layer node identities.");
  }

  const result = {
    content: prepared.content,
    changed: prepared.changed,
    nodeIdMap: prepared.changed
      ? mapSourceNodeIds(before.nodes, after.nodes, edits)
      : new Map(before.nodes.map((node) => [node.id, node.id])),
  };
  cacheCanonicalSource(options.fileId, content, result, after);
  return result;
}

function cacheCanonicalSource(
  fileId: string,
  content: string,
  result: CanonicalSourceContentResult,
  projection?: CodeLayerProjection,
): void {
  const contentBytes = canonicalSourceTextEncoder.encode(content).byteLength;
  const changedBytes = result.changed
    ? contentBytes +
      canonicalSourceTextEncoder.encode(result.content).byteLength
    : 0;
  const retainedNodes = result.changed ? result.nodeIdMap.size : 0;
  if (
    Math.max(contentBytes, changedBytes) <=
      CANONICAL_SOURCE_CACHE_MAX_ENTRY_BYTES &&
    retainedNodes <= CANONICAL_SOURCE_CACHE_MAX_NODES
  ) {
    removeCanonicalSourceCacheEntry(fileId);
    canonicalSourceCache.set(fileId, {
      content,
      result,
      ...(projection ? { projection } : {}),
      retainedBytes: changedBytes,
      retainedNodes,
    });
    canonicalSourceCacheBytes += changedBytes;
    canonicalSourceCacheNodes += retainedNodes;
  }
  // ponytail: a closed design's unchanged entries keep their strings until
  while (
    canonicalSourceCacheBytes > CANONICAL_SOURCE_CACHE_MAX_BYTES ||
    canonicalSourceCacheNodes > CANONICAL_SOURCE_CACHE_MAX_NODES ||
    canonicalSourceCache.size > CANONICAL_SOURCE_CACHE_MAX_ENTRIES
  ) {
    const oldest = canonicalSourceCache.keys().next();
    if (oldest.done) break;
    removeCanonicalSourceCacheEntry(oldest.value);
  }
}

export function resolveSourceBaseForPublication(args: {
  fileId: string;
  fileType?: string | null;
  pending?: {
    content: string;
    identityMigrationSourceContent?: string;
  };
  collabContent?: string | null;
  persistedContent?: string | null;
  beforeContent: string;
}): string {
  const pendingContent = args.pending?.content;
  const migrationSource = args.pending?.identityMigrationSourceContent;
  if (
    pendingContent !== undefined &&
    migrationSource !== undefined &&
    args.collabContent !== pendingContent &&
    args.persistedContent !== pendingContent
  ) {
    return migrationSource;
  }
  const raw =
    pendingContent ??
    args.collabContent ??
    args.persistedContent ??
    args.beforeContent;
  const canonical = prepareCanonicalSourceContent(raw, {
    fileId: args.fileId,
    fileType: args.fileType,
  }).content;
  return canonical === args.beforeContent ? raw : args.beforeContent;
}

export function prepareAcceptedSourceContent(
  content: string,
  options: {
    fileId: string;
    fileType?: string | null;
    previousContent: string;
  },
): CanonicalSourceContentResult {
  const prepared = prepareCanonicalSourceContent(content, options);
  assertDesignHtmlEditIntegrity({
    previousContent: options.previousContent,
    nextContent: prepared.content,
    fileType: options.fileType ?? "html",
  });
  return prepared;
}
