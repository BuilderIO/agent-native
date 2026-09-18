export function composerDraftStorageKey(draftScope: string): string {
  return `an-composer-draft:${encodeURIComponent(draftScope)}`;
}

export function promptToComposerDraftHtml(prompt: string): string {
  if (!prompt.trim()) return "";

  const escaped = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split(/\n+/)
    .map((line) => `<p>${line || "<br/>"}</p>`)
    .join("");
}

export function savePromptToComposerDraft(
  draftScope: string,
  prompt: string,
  storage: Storage = localStorage,
): boolean {
  try {
    storage.setItem(
      composerDraftStorageKey(draftScope),
      promptToComposerDraftHtml(prompt),
    );
    return true;
  } catch {
    return false;
  }
}
