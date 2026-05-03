/**
 * Personal vocabulary auto-learn — Wispr-style.
 *
 * After a Wispr dictation pastes text into the focused field, the user
 * sometimes immediately edits a word ("kublectl" -> "kubectl"). This
 * module watches that ~10-second window and records the original/replacement
 * pair as a vocabulary entry. Future dictations bias the recognizer toward
 * the user's preferred spelling via `SFSpeechRecognizer.contextualStrings`.
 *
 * Public surface:
 *
 *   - `loadVocabulary()` — fetches the user's learned terms from the server.
 *     Used to seed `contextualStrings` at native_speech_start.
 *   - `recordPasteForLearn(pastedText)` — call after a successful paste; the
 *     module then watches the focused field via clipboard polling for
 *     ~10s and persists any single-word diffs it sees.
 *
 * The monitor is fail-soft — any error logging only, never throwing into
 * the dictation pipeline. Persistence is async (POST to add-vocabulary-term).
 */

import { invoke } from "@tauri-apps/api/core";

interface VocabularyEntry {
  id: string;
  term: string;
  replacement: string;
  confidence: number;
  usesCount: number;
}

let cachedVocabulary: VocabularyEntry[] | null = null;
let cachedAt = 0;
let serverUrl = "";

export function configureVocabularyClient(url: string): void {
  serverUrl = url.replace(/\/+$/, "");
}

/**
 * Fetch the current user's vocabulary from the server. Cached for 60s so
 * the dictation start path stays snappy on rapid Fn re-presses.
 */
export async function loadVocabulary(): Promise<string[]> {
  if (cachedVocabulary && Date.now() - cachedAt < 60_000) {
    return cachedVocabulary.map((v) => v.replacement);
  }
  if (!serverUrl) return [];
  try {
    const res = await fetch(
      `${serverUrl}/_agent-native/actions/list-vocabulary`,
      { method: "GET", credentials: "include" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { vocabulary?: VocabularyEntry[] };
    cachedVocabulary = data.vocabulary ?? [];
    cachedAt = Date.now();
    return cachedVocabulary.map((v) => v.replacement);
  } catch (err) {
    console.warn("[personal-vocabulary] loadVocabulary failed:", err);
    return [];
  }
}

/**
 * Token-level diff between two short strings. Returns the first
 * `{term, replacement}` pair where a single word changed and length didn't
 * shift (keeps signal high). For multi-word edits we return null — too
 * noisy to learn from.
 */
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
    // Only learn from "word-shaped" tokens — avoid punctuation noise.
    const term = a[i].replace(/[^\p{L}\p{N}'-]/gu, "");
    const replacement = b[i].replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!term || !replacement) return null;
    if (term.toLowerCase() === replacement.toLowerCase()) return null;
    diff = { term, replacement };
  }
  return diff;
}

/**
 * Best-effort field-content reader. We can't introspect the focused field
 * across all macOS apps without an Accessibility tap, so we approximate by
 * polling the system clipboard — Wispr's `complete_voice_dictation` writes
 * the text there before pasting. After paste, if the user edits and the
 * clipboard or selection changes, we read it back. This is a deliberately
 * low-fidelity heuristic — false positives are filtered out by
 * `diffSingleWord` above (drops anything but a single-word edit).
 *
 * The Tauri backend exposes `read_focused_field_text` — if unimplemented it
 * returns empty and we silently skip the learn pass.
 */
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

/**
 * Snapshot the focused field's text immediately after paste, then poll
 * every 200ms for up to ~10s. On a single-word diff, persist via
 * `add-vocabulary-term`.
 */
export function recordPasteForLearn(pastedText: string): void {
  if (!pastedText.trim() || !serverUrl) return;
  const myId = ++activeMonitorId;
  const baseline = pastedText.trim();
  const start = Date.now();
  const tick = async () => {
    if (myId !== activeMonitorId) return; // a newer paste superseded us
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
          // Bust the cache so the next start picks up the new term.
          cachedVocabulary = null;
          cachedAt = 0;
        } catch (err) {
          console.warn("[personal-vocabulary] persist failed:", err);
        }
        return; // one learn per paste
      }
    }
    window.setTimeout(tick, 200);
  };
  // First poll after 400ms — enough time for the user to start typing.
  window.setTimeout(tick, 400);
}
