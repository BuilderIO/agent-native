import type { ElementInfo } from "../types";

export function vectorEndpointInspectorIdentity(
  element: Pick<
    ElementInfo,
    | "sourceLayerIdentity"
    | "sourceId"
    | "pendingNodeId"
    | "runtimeSourceId"
    | "runtimeSelector"
    | "selector"
    | "id"
    | "tagName"
    | "primitiveKind"
    | "boundingRect"
  >,
): string {
  const identity = element.sourceLayerIdentity
    ? `${element.sourceLayerIdentity.screenId}:${element.sourceLayerIdentity.nodeId}`
    : element.sourceId ||
      element.pendingNodeId ||
      element.runtimeSourceId ||
      element.runtimeSelector ||
      element.selector ||
      element.id ||
      `${element.tagName}:${element.boundingRect.x}:${element.boundingRect.y}:${element.boundingRect.width}:${element.boundingRect.height}`;
  return `${identity}:${element.primitiveKind ?? ""}`;
}
