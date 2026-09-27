import { invoke } from "@tauri-apps/api/core";

export interface VocabularyEntry {
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

export async function loadVocabularyEntries(): Promise<VocabularyEntry[]> {
  if (cachedVocabulary && Date.now() - cachedAt < 60_000) {
    return cachedVocabulary;
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
    return cachedVocabulary;
  } catch (err) {
    console.warn("[personal-vocabulary] loadVocabulary failed:", err);
    return [];
  }
}

export async function loadVocabulary(): Promise<string[]> {
  const vocabulary = await loadVocabularyEntries();
  return vocabulary.map((v) => v.replacement);
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
          cachedVocabulary = null;
          cachedAt = 0;
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
