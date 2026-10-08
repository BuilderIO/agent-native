import { buildCodeLayerProjection } from "@shared/code-layer";
import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerSource,
} from "@shared/code-layer";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";

export type AcceptedSourcePublication = Extract<
  ApplyLocalContentUpdateResult,
  { status: "accepted" }
>;

export function projectAcceptedSource(
  publication: AcceptedSourcePublication,
  source: CodeLayerSource,
): CodeLayerProjection {
  return buildCodeLayerProjection(publication.content, { source });
}

export function mapAcceptedSelectionNode(
  publication: AcceptedSourcePublication,
  acceptedProjection: CodeLayerProjection,
  submittedNode: CodeLayerNode | null | undefined,
): CodeLayerNode | null {
  if (!submittedNode) return null;
  const acceptedId = publication.nodeIdMap.get(submittedNode.id);
  if (!acceptedId) return null;
  const matches = acceptedProjection.nodes.filter(
    (node) => node.id === acceptedId,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
