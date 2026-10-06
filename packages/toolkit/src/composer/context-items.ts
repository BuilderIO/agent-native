import type { AgentChatContextItem } from "./runtime-adapters.js";

export type ComposerContextSnapshot = readonly Readonly<AgentChatContextItem>[];

export const COMPOSER_CONTEXT_MAX_ITEMS = 32;
export const COMPOSER_CONTEXT_MAX_BYTES = 64 * 1024;

export class ComposerContextError extends Error {
  constructor(
    public readonly code: "not-ready" | "too-many-items" | "too-large",
  ) {
    super(
      code === "not-ready"
        ? "Composer context is not ready"
        : code === "too-many-items"
          ? "Composer context exceeds the item limit"
          : "Composer context exceeds the size limit",
    );
    this.name = "ComposerContextError";
  }
}

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
  if (items.length > COMPOSER_CONTEXT_MAX_ITEMS) {
    throw new ComposerContextError("too-many-items");
  }
  if (!areComposerContextItemsReady(items)) {
    throw new ComposerContextError("not-ready");
  }
  const snapshot = Object.freeze(
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
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).length >
    COMPOSER_CONTEXT_MAX_BYTES
  ) {
    throw new ComposerContextError("too-large");
  }
  return snapshot;
}
