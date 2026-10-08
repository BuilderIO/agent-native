import { appPath } from "@agent-native/core/client/api-path";
import type { AgentChatContextItem } from "@agent-native/toolkit/composer";

import type { SlidesComposerContext } from "./composer-context";

export interface NewDeckReferenceSelection {
  composerContext?: SlidesComposerContext;
  contextItems?: readonly AgentChatContextItem[];
  designSystemId?: string | null;
  automaticReferenceDeckId?: string | null;
  referenceDeckId?: string | null;
  referenceDeckIdSource?: ReferenceDeckIdSource;
  referenceFilePaths?: string[];
  importedReferenceFilePath?: string;
  referenceSource?: {
    kind: "google-docs" | "website" | "figma";
    value: string;
  } | null;
}

export type ReferenceDeckIdSource = "prompt" | "selection" | "automatic";

export type NewDeckReferenceSource = NonNullable<
  NewDeckReferenceSelection["referenceSource"]
>;

export function getAutomaticReferenceDeckIdToRemove(
  selection: NewDeckReferenceSelection | undefined,
  fallback?: string | null,
): string | null {
  const automaticReferenceDeckId =
    selection?.automaticReferenceDeckId ?? fallback ?? null;
  const hasExplicitSelection =
    selection?.referenceDeckIdSource === "selection" ||
    (selection?.referenceDeckId !== undefined &&
      selection.referenceDeckIdSource !== "prompt" &&
      selection.referenceDeckIdSource !== "automatic");
  if (
    hasExplicitSelection &&
    selection?.referenceDeckId === automaticReferenceDeckId
  ) {
    return null;
  }
  return automaticReferenceDeckId;
}

export function withoutAutomaticReferenceDeck(
  selection: NewDeckReferenceSelection,
): NewDeckReferenceSelection {
  const automaticDeckIds = new Set(
    [
      getAutomaticReferenceDeckIdToRemove(selection),
      selection.referenceDeckIdSource === "automatic"
        ? selection.referenceDeckId
        : null,
    ].filter((id): id is string => Boolean(id)),
  );
  const next = { ...selection };
  delete next.automaticReferenceDeckId;
  if (selection.referenceDeckIdSource === "automatic") {
    delete next.referenceDeckId;
    delete next.referenceDeckIdSource;
  }
  if (automaticDeckIds.size === 0) return next;

  if (selection.composerContext) {
    next.composerContext = {
      ...selection.composerContext,
      references: selection.composerContext.references.filter(
        (reference) =>
          reference.source !== "slides" || !automaticDeckIds.has(reference.id),
      ),
    };
  }
  if (selection.contextItems) {
    const automaticContextItemKeys = new Set(
      [...automaticDeckIds].map((id) => `slides:${id}:`),
    );
    next.contextItems = selection.contextItems.filter(
      (item) => !automaticContextItemKeys.has(item.key),
    );
  }
  return next;
}

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
