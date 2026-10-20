import { sourceContentHash } from "@shared/source-workspace";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

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

export function publishClipboardContentMutation(args: {
  current: ClipboardContentLineage | undefined;
  baseContentHash: string;
  fileId: string;
  fileType?: string | null;
  nextContent: string;
  origin: ClipboardContentMutationOrigin;
  baseSource?: "lineage" | "document";
}): ClipboardContentLineage | null {
  let canonicalNextContent: string;
  try {
    canonicalNextContent = prepareCanonicalSourceContent(args.nextContent, {
      fileId: args.fileId,
      fileType: args.fileType,
    }).content;
  } catch {
    // coercion-ok: canonicalization failure is a refused publication; callers abort writes.
    return null;
  }
  if (
    args.current &&
    args.current.contentHash !== args.baseContentHash &&
    args.baseSource !== "document"
  ) {
    return null;
  }
  return {
    content: canonicalNextContent,
    contentHash: sourceContentHash(canonicalNextContent),
    mutationId: (args.current?.mutationId ?? 0) + 1,
    origin: args.origin,
  };
}

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
