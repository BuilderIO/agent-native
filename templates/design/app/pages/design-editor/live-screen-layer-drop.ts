import {
  moveNodeBetweenDocuments,
  type MoveNodeBetweenDocumentsOptions,
} from "@shared/code-layer";

import { extractCanvasPrimitiveHtml } from "./canvas-primitive-insert";
import { isStandaloneHttpUrl } from "./editor-state";

export type LiveScreenLayerDropPreparation =
  | {
      status: "applied";
      html: string;
      destinationContent: string;
    }
  | {
      status: "unsupported";
      reason: "destination-not-live" | "source-is-live" | "node-unresolved";
    };

export function prepareLiveScreenLayerDrop(args: {
  sourceContent: string;
  destinationContent: string;
  nodeId: string;
  moveLayout?: MoveNodeBetweenDocumentsOptions["moveLayout"];
}): LiveScreenLayerDropPreparation {
  if (!isStandaloneHttpUrl(args.destinationContent)) {
    return { status: "unsupported", reason: "destination-not-live" };
  }
  if (isStandaloneHttpUrl(args.sourceContent)) {
    return { status: "unsupported", reason: "source-is-live" };
  }
  let html = extractCanvasPrimitiveHtml(args.sourceContent, args.nodeId);
  if (!html) {
    return { status: "unsupported", reason: "node-unresolved" };
  }
  if (args.moveLayout) {
    const moved = moveNodeBetweenDocuments(
      `<html><body>${html}</body></html>`,
      "<!doctype html><html><body></body></html>",
      {
        nodeId: args.nodeId,
        placement: "inside",
        moveLayout: args.moveLayout,
      },
    );
    if (moved.status !== "applied") {
      return { status: "unsupported", reason: "node-unresolved" };
    }
    const movedRoot = new DOMParser().parseFromString(
      moved.destHtml,
      "text/html",
    ).body.firstElementChild;
    if (!movedRoot) {
      return { status: "unsupported", reason: "node-unresolved" };
    }
    html = movedRoot.outerHTML;
  }
  return {
    status: "applied",
    html,
    destinationContent: args.destinationContent,
  };
}
