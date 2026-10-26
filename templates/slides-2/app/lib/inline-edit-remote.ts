/**
 * The open text edit's side of showing another writer's saved edit to the same
 * slide. The deck state asks the registered editor to put `remote` on its
 * canvas; it adopts the copy only when the editor did, because an adopted copy
 * the canvas never showed would be saved over by the next draft.
 *
 * - `applied`: the canvas now shows `remote` around the unsaved edit.
 * - `later`: the editor cannot take it right now (an IME composition is open);
 *   it asks for a retry through `requestInlineEditRemoteRetry`.
 * - `held`: the other writer's change touches the edited text or the slide's
 *   structure. It waits for the edit to end, or meets the draft at save time.
 */
export type InlineEditRemoteResult = "applied" | "later" | "held";

export type InlineEditRemoteApplier = (
  confirmed: string,
  remote: string,
) => InlineEditRemoteResult;

const appliers = new Map<string, InlineEditRemoteApplier>();
const retryHandlers = new Set<(deckId: string) => void>();

const keyOf = (deckId: string, slideId: string) => `${deckId}\u0000${slideId}`;

export function registerInlineEditRemoteApplier(
  deckId: string,
  slideId: string,
  applier: InlineEditRemoteApplier,
): () => void {
  const key = keyOf(deckId, slideId);
  appliers.set(key, applier);
  return () => {
    if (appliers.get(key) === applier) appliers.delete(key);
  };
}

export function applyRemoteSlideUnderInlineEdit(
  deckId: string,
  slideId: string,
  confirmed: string,
  remote: string,
): InlineEditRemoteResult {
  return appliers.get(keyOf(deckId, slideId))?.(confirmed, remote) ?? "held";
}

export function onInlineEditRemoteRetry(
  handler: (deckId: string) => void,
): () => void {
  retryHandlers.add(handler);
  return () => retryHandlers.delete(handler);
}

export function requestInlineEditRemoteRetry(deckId: string) {
  for (const handler of retryHandlers) handler(deckId);
}
