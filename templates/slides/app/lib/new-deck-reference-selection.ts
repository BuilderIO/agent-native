import { appPath } from "@agent-native/core/client/api-path";

export interface NewDeckReferenceSelection {
  designSystemId: string | null;
  referenceDeckId: string | null;
}

export type ReferenceDeckIdSource = "prompt" | "selection" | "automatic";

export function findPromptReferenceDeckId(
  prompt: string,
  origin: string,
  decks: readonly { id: string }[],
): string | null {
  const idsByPath = new Map(
    decks.map((deck) => [
      new URL(appPath(`/deck/${encodeURIComponent(deck.id)}`), origin).pathname,
      deck.id,
    ]),
  );
  const matches = new Set<string>();

  for (const rawUrl of prompt.match(/https?:\/\/[^\s<>"'`]+/g) ?? []) {
    try {
      const url = new URL(rawUrl.replace(/[)\]}>,.;!?]+$/u, ""));
      if (url.origin !== origin) continue;
      const id = idsByPath.get(url.pathname);
      if (id) matches.add(id);
    } catch {
      continue;
    }
  }

  return matches.size === 1 ? (matches.values().next().value ?? null) : null;
}

export function resolveNewDeckReferenceSelection(args: {
  designSystemAuto: boolean;
  selectedDesignSystemId: string | null;
  defaultDesignSystemId: string | null;
  referenceDeckAuto: boolean;
  selectedReferenceDeckId: string | null;
  defaultReferenceDeckId: string | null;
}): NewDeckReferenceSelection {
  return {
    designSystemId: args.designSystemAuto
      ? args.defaultDesignSystemId
      : args.selectedDesignSystemId,
    referenceDeckId: args.referenceDeckAuto
      ? args.defaultReferenceDeckId
      : args.selectedReferenceDeckId,
  };
}

export function resolveRetryReferenceDeckSelection(args: {
  automaticReferenceDeckRemovedFromComposer: boolean;
  carriedDeckMissing: boolean;
  hasComposerContext: boolean;
  hasExplicitComposerDeckReference: boolean;
  carriedImportedReferenceDeckId?: string;
  promptReferenceDeckId: string | null;
  reusingRetryInputs: boolean;
  retryReferenceDeckId?: string | null;
  retryReferenceDeckIdSource?: ReferenceDeckIdSource;
}): {
  referenceDeckId: string | null | undefined;
  referenceDeckIdSource?: ReferenceDeckIdSource;
} {
  const {
    automaticReferenceDeckRemovedFromComposer,
    carriedDeckMissing,
    hasComposerContext,
    hasExplicitComposerDeckReference,
    carriedImportedReferenceDeckId,
    promptReferenceDeckId,
    reusingRetryInputs,
    retryReferenceDeckId,
    retryReferenceDeckIdSource,
  } = args;
  const referenceDeckId =
    carriedDeckMissing || hasExplicitComposerDeckReference
      ? null
      : retryReferenceDeckIdSource === "automatic"
        ? (promptReferenceDeckId ??
          (!reusingRetryInputs || automaticReferenceDeckRemovedFromComposer
            ? null
            : (carriedImportedReferenceDeckId ??
              retryReferenceDeckId ??
              (hasComposerContext ? null : undefined))))
        : retryReferenceDeckIdSource === "prompt"
          ? reusingRetryInputs
            ? (retryReferenceDeckId ?? promptReferenceDeckId ?? null)
            : (promptReferenceDeckId ?? null)
          : retryReferenceDeckIdSource === "selection"
            ? (retryReferenceDeckId ?? null)
            : retryReferenceDeckId !== undefined
              ? retryReferenceDeckId
              : (carriedImportedReferenceDeckId ??
                promptReferenceDeckId ??
                (hasComposerContext ? null : undefined));
  const hasExplicitDeckSelection =
    hasExplicitComposerDeckReference ||
    retryReferenceDeckIdSource === "selection" ||
    (retryReferenceDeckId !== undefined &&
      retryReferenceDeckIdSource !== "prompt" &&
      retryReferenceDeckIdSource !== "automatic");

  return {
    referenceDeckId,
    referenceDeckIdSource: hasExplicitDeckSelection
      ? "selection"
      : promptReferenceDeckId
        ? "prompt"
        : retryReferenceDeckIdSource,
  };
}
