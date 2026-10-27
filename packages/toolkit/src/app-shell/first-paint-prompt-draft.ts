import { useState } from "react";

export interface FirstPaintPromptDraft {
  text: string;
  source: "composer" | "home_suggestion";
  suggestionId?: string;
  revision: number;
}

export type FirstPaintPromptDraftRead =
  | { status: "present"; draft: FirstPaintPromptDraft }
  | { status: "absent" }
  | { status: "unavailable" };

const DRAFTS_KEY = Symbol.for("agent-native.toolkit.firstPaintPromptDrafts");
const DRAFT_STORAGE_PREFIX = "agent-native:first-paint-prompt-draft:";

type DraftStore = Map<string, FirstPaintPromptDraft>;

function isFirstPaintPromptDraft(
  value: unknown,
): value is FirstPaintPromptDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const draft = value as Record<string, unknown>;
  return (
    typeof draft.text === "string" &&
    (draft.source === "composer" || draft.source === "home_suggestion") &&
    typeof draft.revision === "number" &&
    (!Object.hasOwn(draft, "suggestionId") ||
      typeof draft.suggestionId === "string")
  );
}

function draftStore(): DraftStore {
  const globals = globalThis as typeof globalThis & {
    [DRAFTS_KEY]?: DraftStore;
  };
  return (globals[DRAFTS_KEY] ??= new Map());
}

export function writeFirstPaintPromptDraft(
  appId: string,
  text: string,
  source: FirstPaintPromptDraft["source"] = "composer",
  suggestionId?: string,
): void {
  const draft: FirstPaintPromptDraft = {
    text,
    source,
    ...(suggestionId ? { suggestionId } : {}),
    revision: Date.now(),
  };
  draftStore().set(appId, draft);

  try {
    window.sessionStorage.setItem(
      `${DRAFT_STORAGE_PREFIX}${appId}`,
      JSON.stringify(draft),
    );
    // coercion-ok: the in-page bridge preserves the draft when session storage is blocked.
  } catch {
    // The in-page store still bridges the fallback input to the app composer.
  }
}

export function consumeFirstPaintPromptDraft(
  appId: string,
): FirstPaintPromptDraftRead {
  const inPageDraft = draftStore().get(appId);
  if (inPageDraft) {
    draftStore().delete(appId);
    try {
      window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${appId}`);
      // coercion-ok: hydration already has the draft even if stale storage cannot be cleared.
    } catch {
      // The draft was consumed from the in-page store.
    }
    return { status: "present", draft: inPageDraft };
  }

  try {
    const stored = window.sessionStorage.getItem(
      `${DRAFT_STORAGE_PREFIX}${appId}`,
    );
    if (!stored) return { status: "absent" };

    const parsed: unknown = JSON.parse(stored);
    if (!isFirstPaintPromptDraft(parsed)) return { status: "unavailable" };

    window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${appId}`);
    return { status: "present", draft: parsed };
  } catch {
    return { status: "unavailable" };
  }
}

export function useFirstPaintPromptDraft(
  appId: string,
): FirstPaintPromptDraftRead {
  const [result] = useState(() => consumeFirstPaintPromptDraft(appId));
  return result;
}
