import { invoke } from "@tauri-apps/api/core";

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

function diffSingleWord(
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
        try {
          await fetch(
            `${serverUrl}/_agent-native/actions/add-vocabulary-term`,
            {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                term: diff.term,
                replacement: diff.replacement,
                confidence: 0.7,
              }),
            },
          ).catch(() => {});
          invalidateVocabulary();
        } catch (err) {
          console.warn("[personal-vocabulary] persist failed:", err);
        }
        return;
      }
    }
    window.setTimeout(tick, 200);
  };
  window.setTimeout(tick, 400);
}
