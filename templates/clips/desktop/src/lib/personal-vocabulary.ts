import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export interface VocabularyEntry {
  id: string;
  term: string;
  replacement: string;
  confidence: number;
  usesCount: number;
}

/** The vocabulary as this client knows it. Only `loaded` carries entries, so
 * a vocabulary that never loaded, or failed to, can't pass for an empty one. */
export type Vocabulary =
  | { status: "unloaded" }
  | { status: "failed"; error: string }
  | { status: "loaded"; entries: VocabularyEntry[]; loadedAt: number };

const FRESH_MS = 60_000;

let vocabulary: Vocabulary = { status: "unloaded" };
let serverUrl = "";
// Bumped whenever a fetch already under way may return a stale list.
let generation = 0;
let inflight: { generation: number; promise: Promise<Vocabulary> } | null =
  null;

export function configureVocabularyClient(url: string): void {
  const next = url.replace(/\/+$/, "");
  if (next === serverUrl) return;
  serverUrl = next;
  generation += 1;
  vocabulary = { status: "unloaded" };
}

function isFresh(current: Vocabulary): boolean {
  return (
    current.status === "loaded" && Date.now() - current.loadedAt < FRESH_MS
  );
}

/** One fetch per generation, however many callers ask. A response from an
 * older generation is dropped, and a failed fetch keeps entries already
 * loaded. */
function refreshVocabulary(): Promise<Vocabulary> {
  if (inflight?.generation === generation) return inflight.promise;
  const requested = generation;
  const url = serverUrl;
  const promise = (async (): Promise<Vocabulary> => {
    try {
      const res = await fetch(`${url}/_agent-native/actions/list-vocabulary`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { vocabulary?: unknown };
      if (!Array.isArray(data.vocabulary)) {
        throw new Error("the response has no vocabulary list");
      }
      if (requested === generation) {
        vocabulary = {
          status: "loaded",
          entries: data.vocabulary as VocabularyEntry[],
          loadedAt: Date.now(),
        };
      }
    } catch (err) {
      console.warn("[personal-vocabulary] loading the vocabulary failed:", err);
      if (requested === generation && vocabulary.status !== "loaded") {
        vocabulary = {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return requested === generation ? vocabulary : loadVocabulary();
  })();
  inflight = { generation: requested, promise };
  void promise.finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  return promise;
}

/** The vocabulary, fetched first when the copy on hand is missing or a minute
 * old. */
export async function loadVocabulary(): Promise<Vocabulary> {
  if (isFresh(vocabulary) || !serverUrl) return vocabulary;
  return refreshVocabulary();
}

/**
 * The vocabulary on hand, without waiting on the network. Starts a refresh
 * when it is missing or a minute old. A dictation start reads this so the
 * microphone does not wait for the server.
 */
export function currentVocabulary(): Vocabulary {
  if (!isFresh(vocabulary) && serverUrl) void refreshVocabulary();
  return vocabulary;
}

// After a write the list on hand is out of date, and so is any fetch already
// under way; the old entries stay usable until the new list arrives.
function invalidateVocabulary(): void {
  generation += 1;
  if (vocabulary.status === "loaded") {
    vocabulary = { ...vocabulary, loadedAt: 0 };
  }
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * True when `replacement` reads as a spelling fix of `term` ("kublectl" ->
 * "kubectl"), not a different word. Any single-word change in the field
 * within the watch window used to be learned, which taught rules like
 * "Test -> He" that then rewrote every later dictation.
 */
export function isPlausibleCorrection(
  term: string,
  replacement: string,
): boolean {
  if (term.length < 3 || replacement.length < 3) return false;
  const a = term.toLowerCase();
  const b = replacement.toLowerCase();
  // One word inside the other ("staan" -> "staanbu", "niets" -> "niet") is
  // a typing slip next to the word or a grammar edit, not a spelling the
  // speech engine got wrong.
  if (a.includes(b) || b.includes(a)) return false;
  const allowed = Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
  return editDistance(a, b) <= allowed;
}

/**
 * Token-level diff between two short strings. Returns the first
 * `{term, replacement}` pair where a single word changed and length didn't
 * shift (keeps signal high). For multi-word edits we return null — too
 * noisy to learn from.
 */
export function diffSingleWord(
  before: string,
  after: string,
): { term: string; replacement: string } | null {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  if (a.length !== b.length) return null;
  let diff: { term: string; replacement: string } | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (diff) return null;
    const term = a[i].replace(/[^\p{L}\p{N}'-]/gu, "");
    const replacement = b[i].replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!term || !replacement) return null;
    if (term.toLowerCase() === replacement.toLowerCase()) return null;
    if (!isPlausibleCorrection(term, replacement)) return null;
    diff = { term, replacement };
  }
  return diff;
}

async function readFocusedFieldText(): Promise<string | null> {
  try {
    const text = await invoke<string>("read_focused_field_text").catch(
      () => "",
    );
    return text || null;
  } catch {
    return null;
  }
}

let activeMonitorId = 0;

/** A correction Clips noticed, waiting for the user to accept or ignore it. */
export interface VocabularySuggestion {
  id: number;
  term: string;
  replacement: string;
}

/** Event the flow bar listens to, to show the suggestion. */
export const VOCAB_SUGGESTION_EVENT = "voice:vocab-suggestion";
/** Event the flow bar sends back with the user's answer. */
export const VOCAB_SUGGESTION_ANSWER_EVENT = "voice:vocab-suggestion-answer";
/** The flow bar sends this once its suggestion listener is live. */
export const VOCAB_SUGGESTION_READY_EVENT = "voice:vocab-suggestion-ready";
/** Sent back to the flow bar after an accepted suggestion was saved or not. */
export const VOCAB_SUGGESTION_SAVED_EVENT = "voice:vocab-suggestion-saved";
/** How long a suggestion waits for an answer; no answer means ignore. */
export const VOCAB_SUGGESTION_TIMEOUT_MS = 12_000;

const pendingSuggestions = new Map<number, VocabularySuggestion>();
let nextSuggestionId = 0;
let answerListener: Promise<unknown> | null = null;

/** True while a suggestion waits for the user, so the flow bar stays up. */
export function hasPendingVocabularySuggestion(): boolean {
  return pendingSuggestions.size > 0;
}

/** Saves a term; true only when the server accepted it. */
async function saveVocabularyTerm(
  term: string,
  replacement: string,
): Promise<boolean> {
  if (!serverUrl) return false;
  try {
    const res = await fetch(
      `${serverUrl}/_agent-native/actions/add-vocabulary-term`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ term, replacement, confidence: 0.7 }),
      },
    );
    if (!res.ok) {
      console.error("[personal-vocabulary] save rejected:", res.status);
      return false;
    }
    invalidateVocabulary();
    return true;
  } catch (err) {
    console.error("[personal-vocabulary] save failed:", err);
    return false;
  }
}

/**
 * Handles the flow bar's answer. Only an explicit accept saves the term, and
 * the flow bar hears back whether the save landed.
 */
export async function answerVocabularySuggestion(
  id: number,
  accept: boolean,
): Promise<void> {
  const suggestion = pendingSuggestions.get(id);
  if (!suggestion) return;
  pendingSuggestions.delete(id);
  if (!accept) return;
  const saved = await saveVocabularyTerm(
    suggestion.term,
    suggestion.replacement,
  );
  void emit(VOCAB_SUGGESTION_SAVED_EVENT, { id, saved }).catch(() => {});
}

function ensureAnswerListener(): void {
  answerListener ??= Promise.all([
    listen<{ id: number; accept: boolean }>(
      VOCAB_SUGGESTION_ANSWER_EVENT,
      (event) => {
        const { id, accept } = event.payload ?? {};
        if (Number.isSafeInteger(id)) {
          void answerVocabularySuggestion(id, accept === true);
        }
      },
    ),
    // A flow bar that was just created may miss the first emit: send the
    // waiting suggestion again once its listener is live.
    listen(VOCAB_SUGGESTION_READY_EVENT, () => {
      const all = [...pendingSuggestions.values()];
      const waiting = all[all.length - 1];
      if (waiting) void emit(VOCAB_SUGGESTION_EVENT, waiting).catch(() => {});
    }),
  ]).catch((err) => {
    answerListener = null;
    console.warn("[personal-vocabulary] suggestion listeners failed:", err);
  });
}

/**
 * Asks the user, in the flow bar, whether to remember a correction. Nothing
 * is saved until they accept; no answer within the timeout means ignore.
 */
export function proposeVocabularySuggestion(
  term: string,
  replacement: string,
): VocabularySuggestion {
  ensureAnswerListener();
  const suggestion = { id: ++nextSuggestionId, term, replacement };
  // Only the newest suggestion is shown; an older one is dropped.
  pendingSuggestions.clear();
  pendingSuggestions.set(suggestion.id, suggestion);
  window.setTimeout(() => {
    pendingSuggestions.delete(suggestion.id);
  }, VOCAB_SUGGESTION_TIMEOUT_MS);
  void invoke("show_flow_bar").catch(() => {});
  void emit(VOCAB_SUGGESTION_EVENT, suggestion).catch(() => {});
  return suggestion;
}

export function recordPasteForLearn(pastedText: string): void {
  if (!pastedText.trim() || !serverUrl) return;
  const myId = ++activeMonitorId;
  const baseline = pastedText.trim();
  const start = Date.now();
  const tick = async () => {
    if (myId !== activeMonitorId) return;
    if (Date.now() - start > 10_000) return;
    const current = await readFocusedFieldText();
    if (current && current.trim() !== baseline) {
      const diff = diffSingleWord(baseline, current.trim());
      if (diff) {
        proposeVocabularySuggestion(diff.term, diff.replacement);
        return;
      }
    }
    window.setTimeout(tick, 200);
  };
  window.setTimeout(tick, 400);
}
