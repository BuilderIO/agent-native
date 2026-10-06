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

import { isKnownCanonical, rememberCanonical } from "./canonical-verdicts";

export interface CanonicalSourceContentResult {
  content: string;
  changed: boolean;
  nodeIdMap: ReadonlyMap<string, string>;
}

const CANONICAL_SOURCE_CACHE_MAX_BYTES = 16 * 1024 * 1024;
// Unchanged entries reference the caller's own string, so they are budgeted
// apart: charging them to MAX_BYTES evicted an open design's own screens.
const CANONICAL_SOURCE_CACHE_MAX_REFERENCED_BYTES = 64 * 1024 * 1024;
const CANONICAL_SOURCE_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
const CANONICAL_SOURCE_CACHE_MAX_NODES = 32_768;
const CANONICAL_SOURCE_CACHE_MAX_ENTRIES = 4096;
const canonicalSourceCache = new Map<
  string,
  {
    content: string;
    result: CanonicalSourceContentResult;
    projection?: CodeLayerProjection;
    retainedBytes: number;
    referencedBytes: number;
    retainedNodes: number;
  }
>();
let canonicalSourceCacheBytes = 0;
let canonicalSourceCacheReferencedBytes = 0;
let canonicalSourceCacheNodes = 0;

function removeCanonicalSourceCacheEntry(fileId: string): void {
  const cached = canonicalSourceCache.get(fileId);
  if (!cached) return;
  canonicalSourceCache.delete(fileId);
  canonicalSourceCacheBytes -= cached.retainedBytes;
  canonicalSourceCacheReferencedBytes -= cached.referencedBytes;
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
  // Only a screen's first preparation this session reads the stored verdict:
  // later ones are edits, where hashing the whole screen would cost each keystroke.
  const firstPreparation = !cached;
  const knownCanonical =
    firstPreparation && isKnownCanonical(options.fileId, content);
  if (knownCanonical || hasCanonicalCodeLayerNodeIds(content, { source })) {
    if (firstPreparation && !knownCanonical) {
      rememberCanonical(options.fileId, content);
    }
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
  // Length, not UTF-8 size: encoding every screen just to measure it copies it.
  const contentBytes = content.length;
  const changedBytes = result.changed
    ? contentBytes + result.content.length
    : 0;
  const referencedBytes = result.changed ? 0 : contentBytes;
  const retainedNodes = result.changed ? result.nodeIdMap.size : 0;
  if (
    changedBytes <= CANONICAL_SOURCE_CACHE_MAX_ENTRY_BYTES &&
    retainedNodes <= CANONICAL_SOURCE_CACHE_MAX_NODES
  ) {
    removeCanonicalSourceCacheEntry(fileId);
    canonicalSourceCache.set(fileId, {
      content,
      result,
      ...(projection ? { projection } : {}),
      retainedBytes: changedBytes,
      referencedBytes,
      retainedNodes,
    });
    canonicalSourceCacheBytes += changedBytes;
    canonicalSourceCacheReferencedBytes += referencedBytes;
    canonicalSourceCacheNodes += retainedNodes;
  }
  while (
    canonicalSourceCacheBytes > CANONICAL_SOURCE_CACHE_MAX_BYTES ||
    canonicalSourceCacheReferencedBytes >
      CANONICAL_SOURCE_CACHE_MAX_REFERENCED_BYTES ||
    canonicalSourceCacheNodes > CANONICAL_SOURCE_CACHE_MAX_NODES ||
    canonicalSourceCache.size > CANONICAL_SOURCE_CACHE_MAX_ENTRIES
  ) {
    const oldest = canonicalSourceCache.keys().next();
    if (oldest.done) break;
    removeCanonicalSourceCacheEntry(oldest.value);
  }
}

export function forgetPreparedSourcesExcept(
  liveFileIds: ReadonlySet<string>,
): void {
  for (const fileId of [...canonicalSourceCache.keys()]) {
    if (!liveFileIds.has(fileId)) removeCanonicalSourceCacheEntry(fileId);
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
