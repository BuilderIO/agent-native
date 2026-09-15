import type { Document } from "@shared/api";

export type SidebarDocumentSection = "private" | "org";

export type SidebarDropTarget =
  | { type: "before"; documentId: string }
  | { type: "after"; documentId: string }
  | { type: "inside"; documentId: string }
  | { type: "root"; section: SidebarDocumentSection };

export interface SidebarMoveTarget {
  parentId: string | null;
  position: number;
}

export type SidebarMoveResolution =
  | { ok: true; move: SidebarMoveTarget }
  | { ok: false; reason: string };

export function documentSection(
  document: Pick<Document, "visibility">,
): SidebarDocumentSection {
  return document.visibility === "org" ? "org" : "private";
}

export function isDocumentDropTargetId(id: string): boolean {
  return (
    id.startsWith("before:") ||
    id.startsWith("after:") ||
    id.startsWith("inside:") ||
    id === "root:private" ||
    id === "root:org"
  );
}

export function parseDocumentDropTargetId(
  id: string,
): SidebarDropTarget | null {
  const [type, value] = id.split(":", 2);
  if (!value) return null;
  if (type === "before" || type === "after" || type === "inside") {
    return { type, documentId: value };
  }
  if (type === "root" && (value === "private" || value === "org")) {
    return { type: "root", section: value };
  }
  return null;
}

function canDragOrDrop(document: Pick<Document, "canEdit" | "source">) {
  return document.canEdit !== false && document.source?.mode !== "local-files";
}

function compareDocumentsByPosition(a: Document, b: Document) {
  return (
    a.position - b.position ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function isDescendantOf(
  documentsById: Map<string, Document>,
  id: string | null,
  possibleAncestorId: string,
) {
  let currentId = id;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    if (currentId === possibleAncestorId) return true;
    seen.add(currentId);
    currentId = documentsById.get(currentId)?.parentId ?? null;
  }
  return false;
}

function resolveSiblingDrop(args: {
  active: Document;
  targetParentId: string | null;
  targetIndex: number;
  documents: Document[];
}): SidebarMoveResolution {
  const siblingsWithoutActive = args.documents
    .filter(
      (document) =>
        document.parentId === args.targetParentId &&
        document.id !== args.active.id &&
        documentSection(document) === documentSection(args.active),
    )
    .sort(compareDocumentsByPosition);
  const nextIndex = Math.max(
    0,
    Math.min(args.targetIndex, siblingsWithoutActive.length),
  );

  if (args.active.parentId === args.targetParentId) {
    const currentSiblings = args.documents
      .filter(
        (document) =>
          document.parentId === args.targetParentId &&
          documentSection(document) === documentSection(args.active),
      )
      .sort(compareDocumentsByPosition);
    const currentIndex = currentSiblings.findIndex(
      (document) => document.id === args.active.id,
    );
    if (currentIndex === nextIndex) {
      return { ok: false, reason: "Document is already in that position" };
    }
  }

  return {
    ok: true,
    move: { parentId: args.targetParentId, position: nextIndex },
  } satisfies SidebarMoveResolution;
}

export function resolveDocumentSidebarMove(args: {
  activeId: string;
  dropTargetId: string;
  documents: Document[];
}): SidebarMoveResolution {
  const target = parseDocumentDropTargetId(args.dropTargetId);
  if (!target) return { ok: false, reason: "Unknown drop target" };

  const documentsById = new Map(args.documents.map((doc) => [doc.id, doc]));
  const active = documentsById.get(args.activeId);
  if (!active) return { ok: false, reason: "Dragged document was not found" };
  if (!canDragOrDrop(active)) {
    return { ok: false, reason: "Document cannot be moved" };
  }

  const activeSection = documentSection(active);

  if (target.type === "root") {
    if (target.section !== activeSection) {
      return {
        ok: false,
        reason: "Moving between Private and Organization is not supported",
      };
    }
    return resolveSiblingDrop({
      active,
      targetParentId: null,
      targetIndex: args.documents.filter(
        (document) =>
          document.parentId === null &&
          document.id !== active.id &&
          documentSection(document) === activeSection,
      ).length,
      documents: args.documents,
    });
  }

  const targetDocument = documentsById.get(target.documentId);
  if (!targetDocument) {
    return { ok: false, reason: "Drop target document was not found" };
  }
  if (!canDragOrDrop(targetDocument)) {
    return { ok: false, reason: "Drop target cannot accept moved documents" };
  }
  if (documentSection(targetDocument) !== activeSection) {
    return {
      ok: false,
      reason: "Moving between Private and Organization is not supported",
    };
  }

  if (target.type === "inside") {
    if (
      targetDocument.id === active.id ||
      isDescendantOf(documentsById, targetDocument.id, active.id)
    ) {
      return { ok: false, reason: "A document cannot be moved into itself" };
    }
    const childCount = args.documents.filter(
      (document) =>
        document.parentId === targetDocument.id &&
        document.id !== active.id &&
        documentSection(document) === activeSection,
    ).length;
    return resolveSiblingDrop({
      active,
      targetParentId: targetDocument.id,
      targetIndex: childCount,
      documents: args.documents,
    });
  }

  const nextParentId = targetDocument.parentId;
  if (
    nextParentId === active.id ||
    isDescendantOf(documentsById, nextParentId, active.id)
  ) {
    return { ok: false, reason: "A document cannot be moved under itself" };
  }

  const targetSiblingsWithoutActive = args.documents
    .filter(
      (document) =>
        document.parentId === nextParentId &&
        document.id !== active.id &&
        documentSection(document) === activeSection,
    )
    .sort(compareDocumentsByPosition);
  const targetIndex = targetSiblingsWithoutActive.findIndex(
    (document) => document.id === targetDocument.id,
  );
  if (targetIndex < 0) {
    return { ok: false, reason: "Drop target sibling was not found" };
  }

  return resolveSiblingDrop({
    active,
    targetParentId: nextParentId,
    targetIndex: target.type === "before" ? targetIndex : targetIndex + 1,
    documents: args.documents,
  });
}
