import { docToNfm, nfmToDoc, type PMNode } from "./nfm.js";

export const BLOCKS_FIELD_IDENTITY_VERSION = 1;

export type BlocksFieldIdentityStatus = "legacy" | "materialized" | "stale";

export interface BlocksFieldBlock {
  id: string;
  parentId: string | null;
  kind: string;
  position: number;
  addressable: boolean;
}

export interface BlocksFieldTombstone {
  id: string;
  kind: string;
  deletedAtRevision: number;
}

export interface BlocksFieldIdentity {
  version: typeof BLOCKS_FIELD_IDENTITY_VERSION;
  fieldId: string;
  revision: number;
  contentHash: string;
  identityStatus: BlocksFieldIdentityStatus;
  blocks: BlocksFieldBlock[];
  tombstones: BlocksFieldTombstone[];
  recoveryMode: "editor-undo-with-tombstones";
}

export interface StoredBlocksFieldBlock extends BlocksFieldBlock {
  contentHash: string;
  markdown: string;
  deletedAtRevision: number | null;
  recoveredAtRevision: number | null;
  state: "live" | "deleted";
}

export interface StoredBlocksFieldIdentity {
  fieldId: string;
  revision: number;
  contentHash: string;
  blocks: StoredBlocksFieldBlock[];
}

interface BlockSnapshot {
  path: string;
  parentPath: string | null;
  kind: string;
  position: number;
  addressable: boolean;
  contentHash: string;
  markdown: string;
  preferredId: string | null;
}

const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "horizontalRule",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "notionToggle",
  "notionCallout",
  "notionColumns",
  "notionColumn",
  "notionSyncedBlock",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "image",
  "video",
  "audio",
  "notionBlockAtom",
  "registryBlock",
  "contentReference",
  "localMdxComponent",
]);

const NON_ADDRESSABLE_NODE_TYPES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "tableRow",
  "tableHeader",
  "tableCell",
]);

function hashString(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function blocksFieldId(documentId: string, propertyId: string): string {
  return `blocks_field_${hashString(`${documentId}\0${propertyId}`)}`;
}

export function blocksContentHash(markdown: string): string {
  return `nfm_${hashString(markdown)}`;
}

function stableNodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNodeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "blockId")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableNodeValue(child)]),
  );
}

function nodeMarkdown(node: PMNode): string {
  return docToNfm({ type: "doc", content: [node] });
}

function snapshotMarkdown(markdown: string): BlockSnapshot[] {
  const snapshots: BlockSnapshot[] = [];
  const doc = nfmToDoc(markdown);

  function visit(nodes: PMNode[] | undefined, parentPath: string | null) {
    let blockPosition = 0;
    for (let index = 0; index < (nodes?.length ?? 0); index++) {
      const node = nodes![index]!;
      if (!BLOCK_NODE_TYPES.has(node.type)) continue;
      const path =
        parentPath === null
          ? `${blockPosition}`
          : `${parentPath}.${blockPosition}`;
      const canonical = JSON.stringify(stableNodeValue(node));
      snapshots.push({
        path,
        parentPath,
        kind: node.type,
        position: blockPosition,
        addressable: !NON_ADDRESSABLE_NODE_TYPES.has(node.type),
        contentHash: `block_${hashString(canonical)}`,
        markdown: nodeMarkdown(node),
        preferredId:
          node.type === "registryBlock" &&
          typeof node.attrs?.blockId === "string"
            ? node.attrs.blockId
            : null,
      });
      visit(node.content, path);
      blockPosition++;
    }
  }

  visit(doc.content, null);
  return snapshots;
}

function deterministicBlockId(
  fieldId: string,
  snapshot: Pick<BlockSnapshot, "path" | "kind" | "contentHash">,
): string {
  return `block_${hashString(
    `${fieldId}\0${snapshot.path}\0${snapshot.kind}\0${snapshot.contentHash}`,
  )}`;
}

function publicIdentity(
  stored: StoredBlocksFieldIdentity,
  identityStatus: BlocksFieldIdentityStatus,
): BlocksFieldIdentity {
  return {
    version: BLOCKS_FIELD_IDENTITY_VERSION,
    fieldId: stored.fieldId,
    revision: stored.revision,
    contentHash: stored.contentHash,
    identityStatus,
    blocks: stored.blocks
      .filter((block) => block.state === "live")
      .map(({ id, parentId, kind, position, addressable }) => ({
        id,
        parentId,
        kind,
        position,
        addressable,
      })),
    tombstones: stored.blocks
      .filter(
        (
          block,
        ): block is StoredBlocksFieldBlock & {
          deletedAtRevision: number;
        } => block.state === "deleted" && block.deletedAtRevision !== null,
      )
      .map(({ id, kind, deletedAtRevision }) => ({
        id,
        kind,
        deletedAtRevision,
      })),
    recoveryMode: "editor-undo-with-tombstones",
  };
}

export function legacyBlocksFieldIdentity(args: {
  documentId: string;
  propertyId: string;
  markdown: string;
}): BlocksFieldIdentity {
  const fieldId = blocksFieldId(args.documentId, args.propertyId);
  const snapshots = snapshotMarkdown(args.markdown);
  const idByPath = new Map<string, string>();
  const usedIds = new Set<string>();
  const blocks: StoredBlocksFieldBlock[] = snapshots.map((snapshot) => {
    const preferred = snapshot.preferredId;
    const id =
      preferred && !usedIds.has(preferred)
        ? preferred
        : deterministicBlockId(fieldId, snapshot);
    usedIds.add(id);
    idByPath.set(snapshot.path, id);
    return {
      id,
      parentId: snapshot.parentPath
        ? (idByPath.get(snapshot.parentPath) ?? null)
        : null,
      kind: snapshot.kind,
      position: snapshot.position,
      addressable: snapshot.addressable,
      contentHash: snapshot.contentHash,
      markdown: snapshot.markdown,
      state: "live",
      deletedAtRevision: null,
      recoveredAtRevision: null,
    };
  });
  return publicIdentity(
    {
      fieldId,
      revision: 0,
      contentHash: blocksContentHash(args.markdown),
      blocks,
    },
    "legacy",
  );
}

function uniqueIndexByKey<T>(
  values: T[],
  key: (value: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const index = new Map<string, number>();
  values.forEach((value, valueIndex) => {
    const valueKey = key(value);
    counts.set(valueKey, (counts.get(valueKey) ?? 0) + 1);
    index.set(valueKey, valueIndex);
  });
  for (const [valueKey, count] of counts) {
    if (count !== 1) index.delete(valueKey);
  }
  return index;
}

function characterBigrams(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index++) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function editSimilarity(left: string, right: string): number {
  const leftBigrams = characterBigrams(left);
  const rightBigrams = characterBigrams(right);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
  let shared = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) shared++;
  }
  return (2 * shared) / (leftBigrams.size + rightBigrams.size);
}

export function reconcileBlocksFieldIdentity(args: {
  documentId: string;
  propertyId: string;
  previous: StoredBlocksFieldIdentity;
  markdown: string;
  createId: () => string;
}): StoredBlocksFieldIdentity {
  const nextRevision = args.previous.revision + 1;
  const snapshots = snapshotMarkdown(args.markdown);
  const previousLive = args.previous.blocks.filter(
    (block) => block.state === "live",
  );
  const previousDeleted = args.previous.blocks.filter(
    (block) => block.state === "deleted",
  );
  const matchedPrevious = new Set<number>();
  const assigned = new Map<number, StoredBlocksFieldBlock>();
  const usedIds = new Set(args.previous.blocks.map((block) => block.id));

  const previousExact = uniqueIndexByKey(
    previousLive,
    (block) => `${block.kind}\0${block.contentHash}`,
  );
  const nextExact = uniqueIndexByKey(
    snapshots,
    (snapshot) => `${snapshot.kind}\0${snapshot.contentHash}`,
  );
  for (const [key, previousIndex] of previousExact) {
    const nextIndex = nextExact.get(key);
    if (nextIndex === undefined) continue;
    matchedPrevious.add(previousIndex);
    assigned.set(nextIndex, previousLive[previousIndex]!);
  }

  // Split keeps the leading fragment's ID; merge keeps the receiving block's
  // ID. These are the only cardinality-changing cases where position conveys
  // more identity than text similarity.
  const unmatchedKinds = new Set([
    ...previousLive
      .filter((_block, index) => !matchedPrevious.has(index))
      .map((block) => block.kind),
    ...snapshots
      .filter((_snapshot, index) => !assigned.has(index))
      .map((snapshot) => snapshot.kind),
  ]);
  for (const kind of unmatchedKinds) {
    const previousIndexes = previousLive.flatMap((block, index) =>
      !matchedPrevious.has(index) && block.kind === kind ? [index] : [],
    );
    const nextIndexes = snapshots.flatMap((snapshot, index) =>
      !assigned.has(index) && snapshot.kind === kind ? [index] : [],
    );
    if (previousIndexes.length !== 1 && nextIndexes.length !== 1) {
      continue;
    }
    if (previousIndexes.length === 0 || nextIndexes.length === 0) continue;
    const samePosition = nextIndexes.find(
      (nextIndex) =>
        snapshots[nextIndex]!.position ===
        previousLive[previousIndexes[0]!]!.position,
    );
    if (samePosition === undefined) continue;
    matchedPrevious.add(previousIndexes[0]!);
    assigned.set(samePosition, previousLive[previousIndexes[0]!]!);
  }

  // A reorder and a text edit can happen in one editor transaction. Pair only
  // mutual, sufficiently similar best matches before considering position; an
  // ambiguous match is left for the conservative positional rule below.
  const bestNextForPrevious = new Map<
    number,
    { index: number; score: number }
  >();
  const bestPreviousForNext = new Map<
    number,
    { index: number; score: number }
  >();
  for (
    let previousIndex = 0;
    previousIndex < previousLive.length;
    previousIndex++
  ) {
    if (matchedPrevious.has(previousIndex)) continue;
    const previous = previousLive[previousIndex]!;
    for (let nextIndex = 0; nextIndex < snapshots.length; nextIndex++) {
      if (assigned.has(nextIndex)) continue;
      const snapshot = snapshots[nextIndex]!;
      if (previous.kind !== snapshot.kind) continue;
      const score = editSimilarity(previous.markdown, snapshot.markdown);
      if (score < 0.45) continue;
      const previousBest = bestNextForPrevious.get(previousIndex);
      if (!previousBest || score > previousBest.score) {
        bestNextForPrevious.set(previousIndex, { index: nextIndex, score });
      }
      const nextBest = bestPreviousForNext.get(nextIndex);
      if (!nextBest || score > nextBest.score) {
        bestPreviousForNext.set(nextIndex, { index: previousIndex, score });
      }
    }
  }
  for (const [previousIndex, nextBest] of bestNextForPrevious) {
    const previousBest = bestPreviousForNext.get(nextBest.index);
    if (previousBest?.index !== previousIndex) continue;
    matchedPrevious.add(previousIndex);
    assigned.set(nextBest.index, previousLive[previousIndex]!);
  }

  for (let nextIndex = 0; nextIndex < snapshots.length; nextIndex++) {
    if (assigned.has(nextIndex)) continue;
    const snapshot = snapshots[nextIndex]!;
    const samePosition = previousLive.findIndex(
      (block, previousIndex) =>
        !matchedPrevious.has(previousIndex) &&
        block.kind === snapshot.kind &&
        block.position === snapshot.position,
    );
    if (samePosition !== -1) {
      matchedPrevious.add(samePosition);
      assigned.set(nextIndex, previousLive[samePosition]!);
      continue;
    }
    const sameKind = previousLive.findIndex(
      (block, previousIndex) =>
        !matchedPrevious.has(previousIndex) && block.kind === snapshot.kind,
    );
    if (sameKind !== -1) {
      matchedPrevious.add(sameKind);
      assigned.set(nextIndex, previousLive[sameKind]!);
    }
  }

  const recoverable = uniqueIndexByKey(
    previousDeleted,
    (block) => `${block.kind}\0${block.contentHash}`,
  );
  const recoveredIds = new Set<string>();
  const idByPath = new Map<string, string>();
  const nextBlocks = snapshots.map((snapshot, nextIndex) => {
    let previous = assigned.get(nextIndex);
    if (!previous) {
      const recoveredIndex = recoverable.get(
        `${snapshot.kind}\0${snapshot.contentHash}`,
      );
      if (recoveredIndex !== undefined) {
        previous = previousDeleted[recoveredIndex];
        if (previous) recoveredIds.add(previous.id);
      }
    }
    let id = previous?.id ?? snapshot.preferredId ?? args.createId();
    while (usedIds.has(id) && id !== previous?.id) id = args.createId();
    usedIds.add(id);
    idByPath.set(snapshot.path, id);
    return {
      id,
      parentId: snapshot.parentPath
        ? (idByPath.get(snapshot.parentPath) ?? null)
        : null,
      kind: snapshot.kind,
      position: snapshot.position,
      addressable: snapshot.addressable,
      contentHash: snapshot.contentHash,
      markdown: snapshot.markdown,
      state: "live" as const,
      deletedAtRevision: null,
      recoveredAtRevision: recoveredIds.has(id) ? nextRevision : null,
    };
  });

  const deletedNow = previousLive
    .filter((_block, index) => !matchedPrevious.has(index))
    .map((block) => ({
      ...block,
      state: "deleted" as const,
      deletedAtRevision: nextRevision,
      recoveredAtRevision: null,
    }));
  const retainedTombstones = previousDeleted.filter(
    (block) => !recoveredIds.has(block.id),
  );

  return {
    fieldId: args.previous.fieldId,
    revision: nextRevision,
    contentHash: blocksContentHash(args.markdown),
    blocks: [...nextBlocks, ...retainedTombstones, ...deletedNow],
  };
}

export function exposeBlocksFieldIdentity(
  stored: StoredBlocksFieldIdentity,
  markdown: string,
): BlocksFieldIdentity {
  const currentHash = blocksContentHash(markdown);
  if (currentHash === stored.contentHash) {
    return publicIdentity(stored, "materialized");
  }
  let provisionalIndex = 0;
  const reconciled = reconcileBlocksFieldIdentity({
    documentId: "stale-read",
    propertyId: stored.fieldId,
    previous: stored,
    markdown,
    createId: () =>
      `block_${hashString(`${stored.fieldId}\0${markdown}\0${provisionalIndex++}`)}`,
  });
  return publicIdentity({ ...reconciled, revision: stored.revision }, "stale");
}

export function materializeLegacyBlocksFieldIdentity(args: {
  documentId: string;
  propertyId: string;
  markdown: string;
}): StoredBlocksFieldIdentity {
  const publicState = legacyBlocksFieldIdentity(args);
  const snapshots = snapshotMarkdown(args.markdown);
  return {
    fieldId: publicState.fieldId,
    revision: 0,
    contentHash: publicState.contentHash,
    blocks: publicState.blocks.map((block, index) => ({
      ...block,
      contentHash: snapshots[index]!.contentHash,
      markdown: snapshots[index]!.markdown,
      state: "live",
      deletedAtRevision: null,
      recoveredAtRevision: null,
    })),
  };
}
