import { useState } from "react";

export interface FirstPaintPromptDraft {
  text: string;
  files?: File[];
  source: "composer" | "home_suggestion";
  suggestionId?: string;
  submitted?: boolean;
  revision: number;
}

export type FirstPaintPromptDraftRead =
  | { status: "present"; draft: FirstPaintPromptDraft }
  | { status: "absent" }
  | { status: "unavailable" };

const DRAFTS_KEY = Symbol.for("agent-native.toolkit.firstPaintPromptDrafts");
const DRAFT_STORAGE_PREFIX = "agent-native:first-paint-prompt-draft:";

type DraftStore = Map<string, FirstPaintPromptDraft>;

function draftStoreKey(appId: string, scope?: string): string {
  return `${appId}:${scope ?? "anonymous"}`;
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
  options: {
    files?: readonly File[];
    suggestionId?: string;
    submitted?: boolean;
    scope?: string;
  } = {},
): void {
  const draft: FirstPaintPromptDraft = {
    text,
    ...(options.files?.length ? { files: [...options.files] } : {}),
    source,
    ...(options.suggestionId ? { suggestionId: options.suggestionId } : {}),
    ...(options.submitted ? { submitted: true } : {}),
    revision: Date.now(),
  };
  draftStore().set(draftStoreKey(appId, options.scope), draft);
}

export function consumeFirstPaintPromptDraft(
  appId: string,
  scope?: string,
): FirstPaintPromptDraftRead {
  const key = draftStoreKey(appId, scope);
  const drafts = draftStore();
  const anonymousKey = draftStoreKey(appId);
  const inPageDraft =
    drafts.get(key) ??
    (scope && scope !== "anonymous" ? drafts.get(anonymousKey) : undefined);
  if (inPageDraft) {
    draftStore().delete(key);
    if (scope && scope !== "anonymous") drafts.delete(anonymousKey);
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
  scope?: string,
): FirstPaintPromptDraftRead {
  const [result] = useState(() => consumeFirstPaintPromptDraft(appId, scope));
  return result;
}
