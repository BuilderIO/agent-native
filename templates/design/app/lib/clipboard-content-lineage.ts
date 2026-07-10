export type ClipboardContentMutationOrigin =
  | "user"
  | "clipboard-paste"
  | "clipboard-undo"
  | "clipboard-redo";

export interface ClipboardContentMutationPublication {
  mutationId: number;
  contentHash: string;
  origin: ClipboardContentMutationOrigin;
}

export interface ClipboardContentLineage extends ClipboardContentMutationPublication {
  content: string;
}

/**
 * Allocate the next local mutation only when it starts from the currently
 * authoritative document. This prevents a delayed query/Yjs replay from
 * becoming the base of a later paste after undo has already advanced history.
 */
export function publishClipboardContentMutation(args: {
  current: ClipboardContentLineage | undefined;
  baseContentHash: string;
  nextContent: string;
  nextContentHash: string;
  origin: ClipboardContentMutationOrigin;
}): ClipboardContentLineage | null {
  if (args.current && args.current.contentHash !== args.baseContentHash) {
    return null;
  }
  return {
    content: args.nextContent,
    contentHash: args.nextContentHash,
    mutationId: (args.current?.mutationId ?? 0) + 1,
    origin: args.origin,
  };
}

/**
 * Passive save/query/collaboration echoes never create or advance authority.
 * They can only confirm the exact current hash, or acknowledge an explicitly
 * published mutation carrying the same/newer id and matching content hash.
 */
export function acknowledgeClipboardContentMutation(args: {
  current: ClipboardContentLineage | undefined;
  nextContent: string;
  nextContentHash: string;
  publication?: ClipboardContentMutationPublication;
}): ClipboardContentLineage | undefined {
  const { current, publication } = args;
  if (
    publication &&
    publication.contentHash === args.nextContentHash &&
    (!current || publication.mutationId >= current.mutationId)
  ) {
    return {
      ...publication,
      content: args.nextContent,
    };
  }
  if (current?.contentHash === args.nextContentHash) return current;
  return current;
}
