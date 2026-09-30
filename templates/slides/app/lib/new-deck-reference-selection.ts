import { appPath } from "@agent-native/core/client/api-path";

export interface NewDeckReferenceSelection {
  designSystemId: string | null;
  referenceDeckId: string | null;
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
