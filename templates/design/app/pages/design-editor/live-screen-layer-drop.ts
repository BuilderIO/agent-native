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

/**
 * Serialize one stored layer subtree for insertion into a live iframe.
 *
 * A live screen's stored content is its route URL. The caller must hand this
 * fragment to the runtime bridge and leave `destinationContent` untouched.
 */
export function prepareLiveScreenLayerDrop(args: {
  sourceContent: string;
  destinationContent: string;
  nodeId: string;
}): LiveScreenLayerDropPreparation {
  if (!isStandaloneHttpUrl(args.destinationContent)) {
    return { status: "unsupported", reason: "destination-not-live" };
  }
  if (isStandaloneHttpUrl(args.sourceContent)) {
    return { status: "unsupported", reason: "source-is-live" };
  }
  const html = extractCanvasPrimitiveHtml(args.sourceContent, args.nodeId);
  if (!html) {
    return { status: "unsupported", reason: "node-unresolved" };
  }
  return {
    status: "applied",
    html,
    destinationContent: args.destinationContent,
  };
}
