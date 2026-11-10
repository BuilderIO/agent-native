import { docToNfm, nfmToDoc, type PMNode } from "./nfm.js";

export const BLOCKS_FIELD_IDENTITY_VERSION = 1;
export const BLOCK_TOMBSTONE_REVISION_WINDOW = 20;
export const MAX_BLOCK_TOMBSTONES_PER_FIELD = 500;

export const BLOCKS_FIELD_BLOCK_KINDS = [
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
] as const;

export type BlocksFieldBlockKind = (typeof BLOCKS_FIELD_BLOCK_KINDS)[number];
export type BlocksFieldBlockOperation =
  | "insert"
  | "update"
  | "upsert"
  | "delete"
  | "reorder";

const FULL_BLOCK_OPERATIONS = [
  "insert",
  "update",
  "upsert",
  "delete",
  "reorder",
] as const;
const ORDER_ONLY_BLOCK_OPERATIONS = ["delete", "reorder"] as const;

export const BLOCKS_FIELD_OPERATION_CAPABILITIES: Readonly<
  Record<BlocksFieldBlockKind, readonly BlocksFieldBlockOperation[]>
> = {
  paragraph: FULL_BLOCK_OPERATIONS,
  heading: FULL_BLOCK_OPERATIONS,
  horizontalRule: FULL_BLOCK_OPERATIONS,
  codeBlock: FULL_BLOCK_OPERATIONS,
  blockquote: FULL_BLOCK_OPERATIONS,
  bulletList: [],
  orderedList: [],
  listItem: ORDER_ONLY_BLOCK_OPERATIONS,
  taskList: [],
  taskItem: ORDER_ONLY_BLOCK_OPERATIONS,
  notionToggle: FULL_BLOCK_OPERATIONS,
  notionCallout: FULL_BLOCK_OPERATIONS,
  notionColumns: FULL_BLOCK_OPERATIONS,
  notionColumn: FULL_BLOCK_OPERATIONS,
  notionSyncedBlock: FULL_BLOCK_OPERATIONS,
  table: FULL_BLOCK_OPERATIONS,
  tableRow: [],
  tableHeader: [],
  tableCell: [],
  image: FULL_BLOCK_OPERATIONS,
  video: FULL_BLOCK_OPERATIONS,
  audio: FULL_BLOCK_OPERATIONS,
  notionBlockAtom: FULL_BLOCK_OPERATIONS,
  registryBlock: FULL_BLOCK_OPERATIONS,
  contentReference: FULL_BLOCK_OPERATIONS,
  localMdxComponent: FULL_BLOCK_OPERATIONS,
};

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

export interface BlocksFieldBlockSnapshot {
  path: string;
  parentPath: string | null;
  kind: string;
  position: number;
  addressable: boolean;
  contentHash: string;
  markdown: string;
  preferredId: string | null;
}

const BLOCK_NODE_TYPES = new Set<string>(BLOCKS_FIELD_BLOCK_KINDS);

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

const EMPTY_PARAGRAPH_MARKDOWN = nodeMarkdown({ type: "paragraph" });

export function snapshotBlocksFieldMarkdown(
  markdown: string,
): BlocksFieldBlockSnapshot[] {
  const snapshots: BlocksFieldBlockSnapshot[] = [];
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
  snapshot: Pick<BlocksFieldBlockSnapshot, "path" | "kind" | "contentHash">,
): string {
  return `block_${hashString(
    `${fieldId}\0${snapshot.path}\0${snapshot.kind}\0${snapshot.contentHash}`,
  )}`;
}

function fieldScopedBlockId(fieldId: string, candidateId: string): string {
  return `block_${hashString(fieldId)}_${hashString(candidateId)}`;
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
  const snapshots = snapshotBlocksFieldMarkdown(args.markdown);
  const idByPath = new Map<string, string>();
  const usedIds = new Set<string>();
  const blocks: StoredBlocksFieldBlock[] = snapshots.map((snapshot) => {
    const preferred = snapshot.preferredId
      ? fieldScopedBlockId(fieldId, snapshot.preferredId)
      : null;
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

const MIN_EDIT_SIMILARITY = 0.45;

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

function appendTo<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function startsWithBlock(whole: string, part: string): boolean {
  const prefix = part.trim();
  return prefix.length > 0 && whole.trimStart().startsWith(prefix);
}

// A split or merge keeps most of its text: the one block on one side reads
// like the blocks on the other side joined together.
function keepsText(whole: string, parts: readonly string[]): boolean {
  return editSimilarity(whole, parts.join("\n")) >= MIN_EDIT_SIMILARITY;
}

interface PreviousSibling {
  index: number;
  block: StoredBlocksFieldBlock;
}

interface NextSibling {
  index: number;
  snapshot: BlocksFieldBlockSnapshot;
}

export function reconcileBlocksFieldIdentity(args: {
  documentId: string;
  propertyId: string;
  previous: StoredBlocksFieldIdentity;
  markdown: string;
  createId: () => string;
  preferredIdsByPath?: Readonly<Record<string, string>>;
}): StoredBlocksFieldIdentity {
  const nextRevision = args.previous.revision + 1;
  const snapshots = snapshotBlocksFieldMarkdown(args.markdown);
  const previousLive = args.previous.blocks.filter(
    (block) => block.state === "live",
  );
  const previousDeleted = args.previous.blocks.filter(
    (block) => block.state === "deleted",
  );
  const matchedPrevious = new Set<number>();
  const assigned = new Map<number, StoredBlocksFieldBlock>();
  const usedIds = new Set(args.previous.blocks.map((block) => block.id));
  const assignedNextIds = new Set<string>();

  const previousLiveById = new Map(
    previousLive.map((block, index) => [block.id, index]),
  );
  for (let nextIndex = 0; nextIndex < snapshots.length; nextIndex++) {
    const explicitId = args.preferredIdsByPath?.[snapshots[nextIndex]!.path];
    if (!explicitId) continue;
    const previousIndex = previousLiveById.get(explicitId);
    if (previousIndex === undefined || matchedPrevious.has(previousIndex)) {
      continue;
    }
    matchedPrevious.add(previousIndex);
    assigned.set(nextIndex, previousLive[previousIndex]!);
  }

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

  const pair = (previous: PreviousSibling, nextIndex: number) => {
    matchedPrevious.add(previous.index);
    assigned.set(nextIndex, previous.block);
  };
  const nextIndexByPath = new Map(
    snapshots.map((snapshot, index) => [snapshot.path, index]),
  );

  // A leftover block's place is its parent plus the nearest siblings before
  // and after it that kept their identity under that same parent. Nested
  // blocks have no place until their parent is matched.
  const leftoverPlaces = () => {
    const nextIndexForPrevious = new Map<number, number>();
    for (const [nextIndex, block] of assigned) {
      const previousIndex = previousLiveById.get(block.id);
      if (previousIndex !== undefined) {
        nextIndexForPrevious.set(previousIndex, nextIndex);
      }
    }
    const nextParentKey = (
      snapshot: BlocksFieldBlockSnapshot,
    ): string | null => {
      if (snapshot.parentPath === null) return "";
      const parentIndex = nextIndexByPath.get(snapshot.parentPath);
      if (parentIndex === undefined) return null;
      return assigned.get(parentIndex)?.id ?? null;
    };
    const groupByPlace = <T>(
      siblingsByParent: Map<string, T[]>,
      anchorId: (sibling: T, parentKey: string) => string | null,
      isLeftover: (sibling: T) => boolean,
    ) => {
      const groups = new Map<string, T[]>();
      for (const [parentKey, siblings] of siblingsByParent) {
        let before = "";
        let pending: T[] = [];
        const flush = (after: string) => {
          const key = JSON.stringify([parentKey, before, after]);
          groups.set(key, [...(groups.get(key) ?? []), ...pending]);
          pending = [];
        };
        for (const sibling of siblings) {
          const anchor = anchorId(sibling, parentKey);
          if (anchor !== null) {
            flush(anchor);
            before = anchor;
          } else if (isLeftover(sibling)) {
            pending.push(sibling);
          }
        }
        flush("");
      }
      return groups;
    };

    const nextParentKeys: (string | null)[] = [];
    const nextByParent = new Map<string, NextSibling[]>();
    snapshots.forEach((snapshot, index) => {
      const parentKey = nextParentKey(snapshot);
      nextParentKeys.push(parentKey);
      if (parentKey !== null) {
        appendTo(nextByParent, parentKey, { index, snapshot });
      }
    });
    const previousByParent = new Map<string, PreviousSibling[]>();
    previousLive.forEach((block, index) => {
      appendTo(previousByParent, block.parentId ?? "", { index, block });
    });

    const previousPlaces = groupByPlace(
      previousByParent,
      (sibling, parentKey) => {
        const nextIndex = nextIndexForPrevious.get(sibling.index);
        return nextIndex !== undefined &&
          nextParentKeys[nextIndex] === parentKey
          ? sibling.block.id
          : null;
      },
      (sibling) => !matchedPrevious.has(sibling.index),
    );
    const nextPlaces = groupByPlace(
      nextByParent,
      (sibling, parentKey) => {
        const block = assigned.get(sibling.index);
        return block && (block.parentId ?? "") === parentKey ? block.id : null;
      },
      (sibling) => !assigned.has(sibling.index),
    );
    return [...previousPlaces].map(([key, previous]) => ({
      previous,
      next: nextPlaces.get(key) ?? [],
    }));
  };

  // Pair leftovers only where their place says which block is which:
  // identical blocks in order, the first part of a split or merge, the first
  // block written into an empty paragraph, and, once `allowRewrite` is set,
  // the one block of a kind that was rewritten in place.
  // A place with several unrelated candidates pairs nothing, so a deleted
  // block's ID never moves to new text.
  const pairWithinPlaces = (allowRewrite: boolean) => {
    let paired: boolean;
    do {
      paired = false;
      for (const place of leftoverPlaces()) {
        const kinds = new Set(
          place.previous.map((sibling) => sibling.block.kind),
        );
        for (const kind of kinds) {
          const previous = place.previous.filter(
            (sibling) => sibling.block.kind === kind,
          );
          const next = place.next.filter(
            (sibling) => sibling.snapshot.kind === kind,
          );
          for (const previousSibling of [...previous]) {
            const match = next.find(
              (sibling) =>
                sibling.snapshot.contentHash ===
                previousSibling.block.contentHash,
            );
            if (!match) continue;
            pair(previousSibling, match.index);
            previous.splice(previous.indexOf(previousSibling), 1);
            next.splice(next.indexOf(match), 1);
            paired = true;
          }
          const previousTexts = previous.map(
            (sibling) => sibling.block.markdown,
          );
          const nextTexts = next.map((sibling) => sibling.snapshot.markdown);
          const manyPrevious = previous.length > 1;
          const manyNext = next.length > 1;
          const firstPrevious = previous.shift();
          const firstNext = next.shift();
          if (!firstPrevious || !firstNext) continue;
          const previousMarkdown = firstPrevious.block.markdown;
          const nextMarkdown = firstNext.snapshot.markdown;
          const split =
            !manyPrevious &&
            manyNext &&
            (previousMarkdown === EMPTY_PARAGRAPH_MARKDOWN ||
              (startsWithBlock(previousMarkdown, nextMarkdown) &&
                keepsText(previousMarkdown, nextTexts)));
          const merge =
            manyPrevious &&
            !manyNext &&
            startsWithBlock(nextMarkdown, previousMarkdown) &&
            keepsText(nextMarkdown, previousTexts);
          const rewrite = allowRewrite && !manyPrevious && !manyNext;
          if (split || merge || rewrite) {
            pair(firstPrevious, firstNext.index);
            paired = true;
          }
        }
      }
    } while (paired);
  };
  pairWithinPlaces(false);

  const leftoverNextByContent = new Map<string, number[]>();
  snapshots.forEach((snapshot, nextIndex) => {
    if (assigned.has(nextIndex)) return;
    appendTo(
      leftoverNextByContent,
      `${snapshot.kind}\0${snapshot.contentHash}`,
      nextIndex,
    );
  });
  previousLive.forEach((block, previousIndex) => {
    if (matchedPrevious.has(previousIndex)) return;
    const nextIndex = leftoverNextByContent
      .get(`${block.kind}\0${block.contentHash}`)
      ?.shift();
    if (nextIndex !== undefined)
      pair({ index: previousIndex, block }, nextIndex);
  });

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
      if (score < MIN_EDIT_SIMILARITY) continue;
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

  pairWithinPlaces(true);

  const recoverable = uniqueIndexByKey(
    previousDeleted,
    (block) => `${block.kind}\0${block.contentHash}`,
  );
  const recoveredIds = new Set<string>();
  const idByPath = new Map<string, string>();
  const nextBlocks = snapshots.map((snapshot, nextIndex) => {
    const explicitId = args.preferredIdsByPath?.[snapshot.path];
    let previous = assigned.get(nextIndex);
    if (!previous && !explicitId) {
      const recoveredIndex = recoverable.get(
        `${snapshot.kind}\0${snapshot.contentHash}`,
      );
      if (recoveredIndex !== undefined) {
        previous = previousDeleted[recoveredIndex];
        if (previous) {
          recoveredIds.add(previous.id);
          recoverable.delete(`${snapshot.kind}\0${snapshot.contentHash}`);
        }
      }
    }
    if (explicitId && usedIds.has(explicitId) && explicitId !== previous?.id) {
      throw new Error(`Preferred Block ID is already reserved: ${explicitId}`);
    }
    let id =
      explicitId ??
      previous?.id ??
      fieldScopedBlockId(
        args.previous.fieldId,
        snapshot.preferredId ?? args.createId(),
      );
    while (
      assignedNextIds.has(id) ||
      (!explicitId && usedIds.has(id) && id !== previous?.id)
    ) {
      id = fieldScopedBlockId(args.previous.fieldId, args.createId());
    }
    usedIds.add(id);
    assignedNextIds.add(id);
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
  const oldestRecoverableRevision =
    nextRevision - BLOCK_TOMBSTONE_REVISION_WINDOW;
  const retainedTombstones = [...previousDeleted, ...deletedNow]
    .filter(
      (block) =>
        !recoveredIds.has(block.id) &&
        block.deletedAtRevision !== null &&
        block.deletedAtRevision > oldestRecoverableRevision,
    )
    .sort(
      (left, right) =>
        (right.deletedAtRevision ?? 0) - (left.deletedAtRevision ?? 0),
    )
    .slice(0, MAX_BLOCK_TOMBSTONES_PER_FIELD);

  return {
    fieldId: args.previous.fieldId,
    revision: nextRevision,
    contentHash: blocksContentHash(args.markdown),
    blocks: [...nextBlocks, ...retainedTombstones],
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
  const snapshots = snapshotBlocksFieldMarkdown(args.markdown);
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
