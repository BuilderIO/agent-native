import type {
  CanvasPrimitiveInsert,
  MultiScreenCanvasProps,
  PersistedDraftPrimitive,
  PrimitiveCreateOptions,
  PrimitiveCreateResult,
} from "./types";

export function persistBoardDraftPrimitive(args: {
  boardFileId?: string;
  draftId: string;
  primitive: CanvasPrimitiveInsert;
  handler: NonNullable<MultiScreenCanvasProps["onBoardDrawPrimitive"]>;
  options?: PrimitiveCreateOptions;
}): PersistedDraftPrimitive | null {
  const persisted: PrimitiveCreateResult = args.handler(
    args.primitive,
    args.options,
  );
  if (!persisted) return null;

  return {
    frameId: args.boardFileId ?? "__board__",
    nodeId:
      (typeof persisted === "string"
        ? persisted
        : typeof persisted === "object"
          ? persisted.nodeId
          : args.primitive.nodeId) ?? args.draftId,
    ...(typeof persisted === "object"
      ? {
          preparedTargetNodeId: persisted.preparedTargetNodeId,
          preparedTargetIdentity: persisted.preparedTargetIdentity,
        }
      : {}),
  };
}
