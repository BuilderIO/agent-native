import type { AgentChatContextItem } from "./runtime-adapters.js";

export type ComposerContextSnapshot = readonly Readonly<AgentChatContextItem>[];

export function areComposerContextItemsReady(
  items: readonly AgentChatContextItem[] | undefined,
): boolean {
  return !items?.some(
    (item) =>
      item.blocksSubmission !== false && item.status && item.status !== "ready",
  );
}

export function snapshotComposerContextItems(
  items: readonly AgentChatContextItem[],
): ComposerContextSnapshot;
export function snapshotComposerContextItems(
  items: readonly AgentChatContextItem[] | undefined,
): ComposerContextSnapshot | undefined;
export function snapshotComposerContextItems(
  items: readonly AgentChatContextItem[] | undefined,
): ComposerContextSnapshot | undefined {
  if (items === undefined) return undefined;
  if (!areComposerContextItemsReady(items)) {
    throw new Error("Composer context is not ready");
  }
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        key: item.key,
        title: item.title,
        context: item.context,
        ...(item.removable === undefined ? {} : { removable: item.removable }),
        ...(item.blocksSubmission === undefined
          ? {}
          : { blocksSubmission: item.blocksSubmission }),
        ...(item.status === undefined ? {} : { status: item.status }),
        ...(item.statusMessage === undefined
          ? {}
          : { statusMessage: item.statusMessage }),
      }),
    ),
  );
}
