import {
  BLOCKS_FIELD_BLOCK_KINDS,
  BLOCKS_FIELD_OPERATION_CAPABILITIES,
  type BlocksFieldBlockKind,
  type BlocksFieldBlockOperation,
  type BlocksFieldIdentity,
} from "./blocks-field-identity.js";
import { docToNfm, nfmToDoc, type PMDoc, type PMNode } from "./nfm.js";

type Placement =
  | { placement: "start" | "end"; parentBlockId?: string | null }
  | { placement: "before" | "after"; anchorBlockId: string };

export type BlockDocumentMutation =
  | {
      operation: "insert";
      block: { kind: BlocksFieldBlockKind; nfm: string };
      position: Placement;
    }
  | {
      operation: "update" | "upsert";
      blockId: string;
      block: { kind: BlocksFieldBlockKind; nfm: string };
      position?: Placement;
    }
  | { operation: "delete"; blockId: string }
  | { operation: "reorder"; blockId: string; position: Placement };

interface NodeRef {
  node: PMNode;
  nodes: PMNode[];
  nodeIndex: number;
  path: string;
  parentPath: string | null;
}

export interface BlockDocumentMutationResult {
  markdown: string;
  preferredIdsByPath: Record<string, string>;
  requestedBlockId: string | null;
  deletedCandidateIds: string[];
  changed: boolean;
}

const BLOCK_KIND_SET = new Set<string>(BLOCKS_FIELD_BLOCK_KINDS);

function collectNodeRefs(doc: PMDoc): NodeRef[] {
  const refs: NodeRef[] = [];
  const visit = (nodes: PMNode[] | undefined, parentPath: string | null) => {
    let blockPosition = 0;
    for (let nodeIndex = 0; nodeIndex < (nodes?.length ?? 0); nodeIndex++) {
      const node = nodes![nodeIndex]!;
      if (!BLOCK_KIND_SET.has(node.type)) continue;
      const path =
        parentPath === null
          ? `${blockPosition}`
          : `${parentPath}.${blockPosition}`;
      refs.push({ node, nodes: nodes!, nodeIndex, path, parentPath });
      visit(node.content, path);
      blockPosition++;
    }
  };
  visit(doc.content, null);
  return refs;
}

function indexIdentity(markdown: string, identity: BlocksFieldIdentity) {
  const doc = nfmToDoc(markdown);
  const refs = collectNodeRefs(doc);
  if (refs.length !== identity.blocks.length) {
    throw new Error("Blocks identity does not match the current field body.");
  }
  const byId = new Map<string, NodeRef>();
  const idByNode = new Map<PMNode, string>();
  refs.forEach((ref, index) => {
    const block = identity.blocks[index]!;
    if (block.kind !== ref.node.type) {
      throw new Error(
        "Blocks identity kind does not match the current field body.",
      );
    }
    byId.set(block.id, ref);
    idByNode.set(ref.node, block.id);
  });
  return { doc, byId, idByNode };
}

function parsedBlock(kind: BlocksFieldBlockKind, nfm: string): PMNode {
  const doc = nfmToDoc(nfm);
  if (doc.content.length !== 1 || doc.content[0]?.type !== kind) {
    throw new Error(
      `Block value must be canonical NFM containing exactly one top-level ${kind} block.`,
    );
  }
  return doc.content[0];
}

function requireOperation(
  kind: BlocksFieldBlockKind,
  operation: BlocksFieldBlockOperation,
) {
  const supported = BLOCKS_FIELD_OPERATION_CAPABILITIES[
    kind
  ] as readonly string[];
  if (!supported.includes(operation as string)) {
    throw new Error(`Block kind "${kind}" does not support ${operation}.`);
  }
}

function destination(
  position: Placement,
  byId: Map<string, NodeRef>,
  doc: PMDoc,
): { nodes: PMNode[]; index: number; parentPath: string | null } {
  if ("anchorBlockId" in position) {
    const anchor = byId.get(position.anchorBlockId);
    if (!anchor) throw new Error("Anchor block not found.");
    return {
      nodes: anchor.nodes,
      index: anchor.nodeIndex + (position.placement === "after" ? 1 : 0),
      parentPath: anchor.parentPath,
    };
  }
  if (!position.parentBlockId) {
    return {
      nodes: doc.content,
      index: position.placement === "start" ? 0 : doc.content.length,
      parentPath: null,
    };
  }
  const parent = byId.get(position.parentBlockId);
  if (!parent) throw new Error("Parent block not found.");
  const nodes = (parent.node.content ??= []);
  return {
    nodes,
    index: position.placement === "start" ? 0 : nodes.length,
    parentPath: parent.path,
  };
}

function assertCompatibleParent(
  parentPath: string | null,
  kind: BlocksFieldBlockKind,
  byId: Map<string, NodeRef>,
) {
  const parent = [...byId.values()].find(
    (ref) => ref.path === parentPath,
  )?.node;
  const parentKind = parent?.type;
  const generalContainerKinds = new Set([
    "blockquote",
    "listItem",
    "taskItem",
    "notionToggle",
    "notionCallout",
    "notionColumn",
    "notionSyncedBlock",
    "tableHeader",
    "tableCell",
  ]);
  const valid =
    parentKind === undefined
      ? ![
          "listItem",
          "taskItem",
          "notionColumn",
          "tableRow",
          "tableHeader",
          "tableCell",
        ].includes(kind)
      : parentKind === "bulletList" || parentKind === "orderedList"
        ? kind === "listItem"
        : parentKind === "taskList"
          ? kind === "taskItem"
          : parentKind === "notionColumns"
            ? kind === "notionColumn"
            : parentKind === "table"
              ? kind === "tableRow"
              : parentKind === "tableRow"
                ? kind === "tableHeader" || kind === "tableCell"
                : generalContainerKinds.has(parentKind) &&
                  ![
                    "listItem",
                    "taskItem",
                    "notionColumn",
                    "tableRow",
                    "tableHeader",
                    "tableCell",
                  ].includes(kind);
  if (!valid) {
    throw new Error(
      `Block kind "${kind}" is not valid inside ${parentKind ?? "the field root"}.`,
    );
  }
}

function repositionNode(args: {
  blockId: string;
  current: NodeRef;
  node: PMNode;
  position: Placement;
  byId: Map<string, NodeRef>;
  doc: PMDoc;
}) {
  if (
    "anchorBlockId" in args.position &&
    args.position.anchorBlockId === args.blockId
  ) {
    throw new Error("A block cannot be reordered relative to itself.");
  }
  const target = destination(args.position, args.byId, args.doc);
  if (target.parentPath !== args.current.parentPath) {
    throw new Error("Cross-parent block reorder is not supported.");
  }
  args.current.nodes.splice(args.current.nodeIndex, 1);
  const targetIndex =
    "anchorBlockId" in args.position
      ? (() => {
          const anchor = args.byId.get(args.position.anchorBlockId);
          if (!anchor || anchor.nodes !== target.nodes) {
            throw new Error("Reorder anchor is outside the current parent.");
          }
          const anchorIndex = target.nodes.indexOf(anchor.node);
          return anchorIndex + (args.position.placement === "after" ? 1 : 0);
        })()
      : args.position.placement === "start"
        ? 0
        : target.nodes.length;
  target.nodes.splice(targetIndex, 0, args.node);
}

function preferredIds(
  doc: PMDoc,
  idByNode: Map<PMNode, string>,
  requestedNode?: PMNode,
  requestedId?: string,
  createInsertedDescendantId?: () => string,
) {
  const requestedDescendants = new Set<PMNode>();
  const collectRequestedDescendants = (nodes: PMNode[] | undefined) => {
    for (const node of nodes ?? []) {
      requestedDescendants.add(node);
      collectRequestedDescendants(node.content);
    }
  };
  if (requestedId && requestedNode) {
    collectRequestedDescendants(requestedNode.content);
  }
  return Object.fromEntries(
    collectNodeRefs(doc).flatMap((ref) => {
      const id =
        idByNode.get(ref.node) ??
        (ref.node === requestedNode
          ? requestedId
          : requestedDescendants.has(ref.node)
            ? createInsertedDescendantId?.()
            : undefined);
      if (
        requestedDescendants.has(ref.node) &&
        !id &&
        !createInsertedDescendantId
      ) {
        throw new Error(
          "Inserting a nested block requires fresh descendant Block IDs.",
        );
      }
      return id ? [[ref.path, id]] : [];
    }),
  );
}

export function mutateBlocksFieldDocument(args: {
  markdown: string;
  identity: BlocksFieldIdentity;
  mutation: BlockDocumentMutation;
  insertedBlockId?: string;
  createInsertedDescendantId?: () => string;
}): BlockDocumentMutationResult {
  const indexed = indexIdentity(args.markdown, args.identity);
  const { doc, byId, idByNode } = indexed;
  const before = docToNfm(doc);
  let requestedNode: PMNode | undefined;
  let requestedBlockId: string | null = null;
  let deletedCandidateIds: string[] = [];

  if (args.mutation.operation === "insert") {
    requireOperation(args.mutation.block.kind, "insert");
    requestedNode = parsedBlock(
      args.mutation.block.kind,
      args.mutation.block.nfm,
    );
    const target = destination(args.mutation.position, byId, doc);
    assertCompatibleParent(target.parentPath, args.mutation.block.kind, byId);
    target.nodes.splice(target.index, 0, requestedNode);
  } else {
    const current = byId.get(args.mutation.blockId);
    if (!current) throw new Error("Block not found.");
    const currentKind = current.node.type as BlocksFieldBlockKind;
    requireOperation(currentKind, args.mutation.operation);
    requestedBlockId = args.mutation.blockId;

    if (
      args.mutation.operation === "update" ||
      args.mutation.operation === "upsert"
    ) {
      if (args.mutation.block.kind !== currentKind) {
        throw new Error("Individual block mutations cannot change block kind.");
      }
      requestedNode = parsedBlock(currentKind, args.mutation.block.nfm);
      current.nodes[current.nodeIndex] = requestedNode;
      current.node = requestedNode;
      idByNode.set(requestedNode, args.mutation.blockId);
      if (args.mutation.operation === "upsert" && args.mutation.position) {
        repositionNode({
          blockId: args.mutation.blockId,
          current,
          node: requestedNode,
          position: args.mutation.position,
          byId,
          doc,
        });
      }
    } else if (args.mutation.operation === "delete") {
      deletedCandidateIds = args.identity.blocks
        .filter((block) => {
          const ref = byId.get(block.id);
          return (
            ref?.path === current.path ||
            ref?.path.startsWith(`${current.path}.`)
          );
        })
        .map((block) => block.id);
      current.nodes.splice(current.nodeIndex, 1);
    } else if (args.mutation.operation === "reorder") {
      repositionNode({
        blockId: args.mutation.blockId,
        current,
        node: current.node,
        position: args.mutation.position,
        byId,
        doc,
      });
    }
  }

  const markdown = docToNfm(doc);
  const preferredIdsByPath = preferredIds(
    doc,
    idByNode,
    requestedNode,
    args.insertedBlockId,
    args.createInsertedDescendantId,
  );
  const identityOrderChanged = collectNodeRefs(doc).some(
    (ref, index) =>
      preferredIdsByPath[ref.path] !== undefined &&
      preferredIdsByPath[ref.path] !== args.identity.blocks[index]?.id,
  );
  return {
    markdown,
    preferredIdsByPath,
    requestedBlockId,
    deletedCandidateIds,
    changed: markdown !== before || identityOrderChanged,
  };
}
