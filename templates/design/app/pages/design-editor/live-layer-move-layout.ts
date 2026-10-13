import type { CodeLayerNode, CodeLayerProjection } from "@shared/code-layer";

import {
  findCanvasIframeForScreen,
  getActiveScreenIframeId,
  getBreakpointIframeId,
  getPrimaryIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";

export interface LiveLayerMoveEndpoint {
  fileId: string;
  node?: CodeLayerNode;
  projection: CodeLayerProjection;
  root?: "body";
}

export type LiveLayerMoveLayout =
  | { status: "unavailable" }
  | { status: "stale" }
  | {
      destinationDisplay: string;
      sourceParentDisplay: string;
      sourcePosition: string;
      status: "resolved";
    };

export function isFlowDisplay(display: string | undefined): boolean {
  return /^(?:inline-)?(?:flex|grid)$/.test(display ?? "");
}

type LivePreviewDocumentResult =
  | { document: Document; status: "resolved" }
  | { status: "unavailable" }
  | { status: "stale" };

export function getLivePreviewDocument(args: {
  activeBreakpointWidthState?: number;
  activeFileId?: string;
  boardFileId?: string;
  fileId: string;
  overviewScreens?: readonly OverviewScreen[];
}): LivePreviewDocumentResult {
  if (typeof document === "undefined" || !document.body) {
    return { status: "unavailable" };
  }
  const screen = args.overviewScreens?.find((item) => item.id === args.fileId);
  const iframeId =
    args.fileId === args.boardFileId
      ? args.fileId
      : screen
        ? getActiveScreenIframeId(screen)
        : args.fileId === args.activeFileId &&
            args.activeBreakpointWidthState !== undefined
          ? getBreakpointIframeId(args.fileId, args.activeBreakpointWidthState)
          : getPrimaryIframeId(args.fileId);
  const iframe = findCanvasIframeForScreen(
    document.body,
    iframeId,
    args.boardFileId,
  );
  if (!iframe) return { status: "unavailable" };
  try {
    const previewDocument = iframe.contentDocument;
    if (!previewDocument?.defaultView || !previewDocument.documentElement) {
      return { status: "stale" };
    }
    return { document: previewDocument, status: "resolved" };
  } catch {
    return { status: "stale" };
  }
}

export function readLiveLayerMoveLayout(args: {
  activeBreakpointWidthState?: number;
  activeFileId?: string;
  boardFileId?: string;
  destination: LiveLayerMoveEndpoint;
  overviewScreens?: readonly OverviewScreen[];
  placement: "before" | "after" | "inside";
  source: LiveLayerMoveEndpoint;
}): LiveLayerMoveLayout {
  if (typeof document === "undefined" || !document.body) {
    return { status: "unavailable" };
  }

  const sourceDocument = getLivePreviewDocument({
    activeBreakpointWidthState: args.activeBreakpointWidthState,
    activeFileId: args.activeFileId,
    boardFileId: args.boardFileId,
    fileId: args.source.fileId,
    overviewScreens: args.overviewScreens,
  });
  const destinationDocument = getLivePreviewDocument({
    activeBreakpointWidthState: args.activeBreakpointWidthState,
    activeFileId: args.activeFileId,
    boardFileId: args.boardFileId,
    fileId: args.destination.fileId,
    overviewScreens: args.overviewScreens,
  });
  if (
    sourceDocument.status === "stale" ||
    destinationDocument.status === "stale"
  ) {
    return { status: "stale" };
  }
  if (
    sourceDocument.status === "unavailable" ||
    destinationDocument.status === "unavailable"
  ) {
    return { status: "unavailable" };
  }

  const elementFor = (
    endpoint: LiveLayerMoveEndpoint,
    previewDocument: Document,
  ): Element | null => {
    const ownerSource = endpoint.projection.source;
    if (
      ownerSource.kind !== "design-file" ||
      ownerSource.fileId !== endpoint.fileId
    ) {
      return null;
    }
    if (endpoint.root === "body") return previewDocument.body;
    const node = endpoint.node;
    if (!node) return null;
    const nodeId = node.dataAttributes["data-agent-native-node-id"];
    const authoredId = node.attributes.id;
    const attribute =
      typeof nodeId === "string" && nodeId ? "data-agent-native-node-id" : "id";
    const value = attribute === "id" ? authoredId : nodeId;
    if (typeof value !== "string" || !value) return null;
    const sourceMatches = endpoint.projection.nodes.filter((candidate) =>
      attribute === "id"
        ? candidate.attributes.id === value
        : candidate.dataAttributes[attribute] === value,
    );
    if (sourceMatches.length !== 1) return null;
    const liveMatches = findLiveIdentityMatches(
      previewDocument,
      attribute,
      value,
    );
    if (liveMatches.length !== 1) return null;
    const element = liveMatches[0];
    return element?.localName === node.tag.toLowerCase() &&
      (typeof nodeId !== "string" ||
        element.getAttribute("data-agent-native-node-id") === nodeId) &&
      (typeof authoredId !== "string" ||
        element.getAttribute("id") === authoredId)
      ? element
      : null;
  };

  const sourceElement = elementFor(args.source, sourceDocument.document);
  const destinationElement = elementFor(
    args.destination,
    destinationDocument.document,
  );
  const sourceParent = sourceElement?.parentElement;
  const destinationParent =
    args.destination.root === "body"
      ? destinationElement
      : args.placement === "inside"
        ? destinationElement
        : destinationElement?.parentElement;
  if (!sourceElement || !sourceParent || !destinationParent) {
    return { status: "stale" };
  }

  const sourceView = sourceDocument.document.defaultView;
  const destinationView = destinationDocument.document.defaultView;
  if (!sourceView || !destinationView) return { status: "stale" };

  return {
    status: "resolved",
    sourcePosition: sourceView.getComputedStyle(sourceElement).position,
    sourceParentDisplay: sourceView.getComputedStyle(sourceParent).display,
    destinationDisplay:
      destinationView.getComputedStyle(destinationParent).display,
  };
}

function findLiveIdentityMatches(
  previewDocument: Document,
  attribute: "data-agent-native-node-id" | "id",
  value: string,
): Element[] {
  const matches: Element[] = [];
  const walker = previewDocument.createTreeWalker(
    previewDocument.documentElement,
    NodeFilter.SHOW_ELEMENT,
  );
  let current: Node | null = walker.currentNode;
  while (current) {
    if (current.nodeType === 1) {
      const candidate = current as Element;
      if (candidate.getAttribute(attribute) !== value) {
        current = walker.nextNode();
        continue;
      }
      matches.push(candidate);
      if (matches.length === 2) break;
    }
    current = walker.nextNode();
  }
  return matches;
}
