import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  mapCodeLayerSourceOffsetThroughEdits,
  type CodeLayerSourceEdit,
  type CodeLayerNode,
} from "@shared/code-layer";
import { isStandaloneHttpUrl } from "@shared/html-content";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";

export interface CanonicalSourceContentResult {
  content: string;
  changed: boolean;
  /**
   * Maps projection node IDs from the input bytes to the accepted bytes.
   * Nodes are paired only by exact source open-tag offsets transformed through
   * the identity-only attribute edits, then checked for tag agreement.
   */
  nodeIdMap: ReadonlyMap<string, string>;
}

/** Pair source nodes through exact edits; never fall back to tree position. */
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

/**
 * Prepare persisted HTML bytes for code-layer source publication. This is
 * deliberately identity-only: it must not wrap text or inspect runtime DOM,
 * and it leaves URL-backed screens and non-HTML source files untouched.
 */
export function prepareCanonicalSourceContent(
  content: string,
  options: { fileId: string; fileType?: string | null },
): CanonicalSourceContentResult {
  const fileType = (options.fileType ?? "html").trim().toLowerCase();
  if (fileType !== "html" || !content.trim() || isStandaloneHttpUrl(content)) {
    return { content, changed: false, nodeIdMap: new Map() };
  }

  const source = { kind: "design-file" as const, fileId: options.fileId };
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

  return {
    content: prepared.content,
    changed: prepared.changed,
    nodeIdMap: prepared.changed
      ? mapSourceNodeIds(before.nodes, after.nodes, edits)
      : new Map(before.nodes.map((node) => [node.id, node.id])),
  };
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
  // Identity repair is a real full-document save. Keep its raw CAS base while
  // that save is still in flight, but switch to the canonical pending bytes as
  // soon as the collab or persisted mirror has acknowledged them.
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

/** The same pure acceptance boundary used by writers and multi-file preflight. */
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
