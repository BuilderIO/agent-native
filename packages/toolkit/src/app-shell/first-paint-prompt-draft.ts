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
}

export function consumeFirstPaintPromptDraft(
  appId: string,
): FirstPaintPromptDraftRead {
  const inPageDraft = draftStore().get(appId);
  if (inPageDraft) {
    draftStore().delete(appId);
    return { status: "present", draft: inPageDraft };
  }

  try {
    window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${appId}`);
  } catch {
    // coercion-ok: old persisted drafts are ignored when storage is unavailable.
  }
  return { status: "absent" };
}

export function useFirstPaintPromptDraft(
  appId: string,
): FirstPaintPromptDraftRead {
  const [result] = useState(() => consumeFirstPaintPromptDraft(appId));
  return result;
}
