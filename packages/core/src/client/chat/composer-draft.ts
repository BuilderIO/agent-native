const ASSISTANT_CHAT_COMPOSER_DRAFT_PREFIX = "agent-chat-composer-text:";

export function assistantChatComposerDraftKey(
  scope?: string | null,
): string | null {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${ASSISTANT_CHAT_COMPOSER_DRAFT_PREFIX}${encodeURIComponent(normalizedScope)}`
    : null;
}

function getComposerDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // coercion-ok: browser storage may be unavailable; treat it as absent.
    return null;
  }
}

export function readAssistantChatComposerDraft(
  scope?: string | null,
): string | null {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return null;
  try {
    const draft = storage.getItem(key);
    return draft && draft.trim().length > 0 ? draft : null;
  } catch {
    // coercion-ok: browser storage may be unavailable; treat it as absent.
    return null;
  }
}

export function writeAssistantChatComposerDraft(
  scope: string | null | undefined,
  text: string,
): void {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return;
  try {
    if (text.trim().length > 0) {
      storage.setItem(key, text);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // coercion-ok: browser storage may be unavailable; keep the live editor authoritative.
    // The live editor remains the source of truth when browser storage is unavailable.
  }
}

export function clearAssistantChatComposerDraft(scope?: string | null): void {
  const key = assistantChatComposerDraftKey(scope);
  const storage = getComposerDraftStorage();
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // coercion-ok: browser storage may be unavailable; keep the live editor authoritative.
    // The live editor remains the source of truth when browser storage is unavailable.
  }
}
