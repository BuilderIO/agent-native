import type { SuggestionAdapter } from "./types.js";
const adapters = new Map<string, SuggestionAdapter>();
export function registerSuggestionAdapter(adapter: SuggestionAdapter): void {
  if (
    !adapter.kind.trim() ||
    !Number.isInteger(adapter.version) ||
    adapter.version < 1
  )
    throw new Error(
      "Suggestion adapter requires a non-empty kind and positive version",
    );
  const existing = adapters.get(adapter.kind);
  if (existing) {
    if (existing.version === adapter.version) {
      adapters.set(adapter.kind, adapter);
      return;
    }
    throw new Error(
      `Suggestion adapter ${adapter.kind} was registered at conflicting versions`,
    );
  }
  adapters.set(adapter.kind, adapter);
}
export function getSuggestionAdapter(kind: string) {
  return adapters.get(kind);
}
export function listSuggestionAdapters() {
  return [...adapters.values()];
}
export function __resetSuggestionAdaptersForTests() {
  adapters.clear();
}
