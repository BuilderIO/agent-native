import { matchesWithin } from "./page-track-target";

const FULL_SNAPSHOT = 2;
const INCREMENTAL_SNAPSHOT = 3;
const MUTATION = 0;
const INPUT = 5;
const ADOPTED_STYLE_SHEET = 15;
const ELEMENT_NODE = 1;

type RecordedEvent = { type: number; data?: unknown };

type IncrementalData = {
  source?: unknown;
  isAttachIframe?: unknown;
  id?: unknown;
  styleId?: unknown;
  styleIds?: unknown[];
  adds?: { parentId?: unknown; node?: { id?: unknown } }[];
  removes?: { parentId?: unknown }[];
  texts?: { id?: unknown }[];
  attributes?: { id?: unknown }[];
  positions?: { id?: unknown }[];
  ranges?: { start?: unknown }[];
};

function nodeIds(data: IncrementalData): number[] {
  return [
    data.id,
    ...(data.adds ?? []).map((add) => add.parentId),
    ...(data.removes ?? []).map((remove) => remove.parentId),
    ...(data.texts ?? []).map((text) => text.id),
    ...(data.attributes ?? []).map((attribute) => attribute.id),
    ...(data.positions ?? []).map((position) => position.id),
    ...(data.ranges ?? []).map((range) => range.start),
  ].filter((id): id is number => typeof id === "number");
}

export function blockedFrameFilter(
  blockSelector: string,
  nodeOf: (id: number) => Node | null,
): (event: RecordedEvent) => boolean {
  const blockedDocuments = new WeakSet<Node>();
  const blockedStyleIds = new Set<number>();
  let blocking = false;

  const insideBlocked = (node: Node | null): boolean =>
    node !== null && blockedDocuments.has(node.ownerDocument ?? node);

  const isBlockedFrame = (node: Node | null): node is HTMLIFrameElement =>
    node !== null &&
    node.nodeType === ELEMENT_NODE &&
    node.nodeName === "IFRAME" &&
    (insideBlocked(node) || matchesWithin(node as Element, blockSelector));

  return (event) => {
    if (event.type === FULL_SNAPSHOT) blockedStyleIds.clear();
    if (event.type !== INCREMENTAL_SNAPSHOT || !event.data) return true;
    const data = event.data as IncrementalData;
    if (data.source === MUTATION && data.isAttachIframe === true) {
      const add = data.adds?.[0];
      const frame =
        typeof add?.parentId === "number" ? nodeOf(add.parentId) : null;
      if (!isBlockedFrame(frame)) return true;
      const childId = add?.node?.id;
      const frameDocument =
        (typeof childId === "number" ? nodeOf(childId) : null) ??
        frame.contentDocument;
      if (frameDocument) blockedDocuments.add(frameDocument);
      blocking = true;
      return false;
    }
    if (!blocking) return true;
    if (typeof data.styleId === "number" && blockedStyleIds.has(data.styleId)) {
      return false;
    }
    if (
      data.source === INPUT &&
      typeof data.id === "number" &&
      nodeOf(data.id) === null
    ) {
      return false;
    }
    if (!nodeIds(data).some((id) => insideBlocked(nodeOf(id)))) return true;
    if (data.source === ADOPTED_STYLE_SHEET) {
      for (const styleId of data.styleIds ?? []) {
        if (typeof styleId === "number") blockedStyleIds.add(styleId);
      }
    }
    return false;
  };
}
