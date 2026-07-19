import AsyncStorage from "@react-native-async-storage/async-storage";

import { callClipsAction } from "./clips-api";
import type { ClipsSession } from "./clips-session";

const DICTATION_PREFERENCES_KEY = "agent-native:dictation-preferences:v1";

export type DictationCleanupStyle =
  | "polished"
  | "light"
  | "verbatim"
  | "concise";

export interface DictationPreferences {
  language: string | null;
  cleanupStyle: DictationCleanupStyle;
  customInstructions: string;
}

export interface DictationLanguageOption {
  value: string | null;
  label: string;
}

export interface DictationVocabularyEntry {
  id: string;
  term: string;
  replacement: string;
  usesCount: number;
}

export const DICTATION_LANGUAGE_OPTIONS: readonly DictationLanguageOption[] = [
  { value: null, label: "System language" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es-ES", label: "Spanish" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
  { value: "it-IT", label: "Italian" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja-JP", label: "Japanese" },
  { value: "ko-KR", label: "Korean" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "hi-IN", label: "Hindi" },
] as const;

export const DICTATION_CLEANUP_STYLES: ReadonlyArray<{
  value: DictationCleanupStyle;
  label: string;
  description: string;
}> = [
  {
    value: "polished",
    label: "Polished",
    description: "Remove fillers and false starts, then fix punctuation.",
  },
  {
    value: "light",
    label: "Light cleanup",
    description: "Fix punctuation and clear transcription mistakes only.",
  },
  {
    value: "verbatim",
    label: "Verbatim",
    description: "Keep fillers, repetition, false starts, and wording.",
  },
  {
    value: "concise",
    label: "Concise",
    description: "Remove repetition and tighten wording without adding facts.",
  },
] as const;

export const DEFAULT_DICTATION_PREFERENCES: DictationPreferences = {
  language: null,
  cleanupStyle: "polished",
  customInstructions: "",
};

const STYLE_INSTRUCTIONS: Record<DictationCleanupStyle, string> = {
  polished:
    "Preserve the speaker's meaning and voice. Remove accidental fillers and false starts, fix punctuation, and keep intentional formatting concise.",
  light:
    "Preserve the speaker's exact wording and tone. Correct punctuation and obvious transcription mistakes only.",
  verbatim:
    "Transcribe verbatim. Preserve fillers, repetition, false starts, tone, and word order. Add only essential punctuation.",
  concise:
    "Preserve the speaker's meaning and voice. Remove fillers, false starts, and repetition, then tighten wording without adding facts.",
};

function isCleanupStyle(value: unknown): value is DictationCleanupStyle {
  return (
    value === "polished" ||
    value === "light" ||
    value === "verbatim" ||
    value === "concise"
  );
}

function normalizeLanguage(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const language = value.trim();
  return DICTATION_LANGUAGE_OPTIONS.some((option) => option.value === language)
    ? language
    : null;
}

function normalizeCustomInstructions(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

export function normalizeDictationPreferences(
  value: unknown,
): DictationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DICTATION_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  return {
    language: normalizeLanguage(record.language),
    cleanupStyle: isCleanupStyle(record.cleanupStyle)
      ? record.cleanupStyle
      : DEFAULT_DICTATION_PREFERENCES.cleanupStyle,
    customInstructions: normalizeCustomInstructions(record.customInstructions),
  };
}

export async function loadDictationPreferences(): Promise<DictationPreferences> {
  const stored = await AsyncStorage.getItem(DICTATION_PREFERENCES_KEY);
  if (!stored) return { ...DEFAULT_DICTATION_PREFERENCES };
  try {
    return normalizeDictationPreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_DICTATION_PREFERENCES };
  }
}

export async function saveDictationPreferences(
  value: DictationPreferences,
): Promise<DictationPreferences> {
  const preferences = normalizeDictationPreferences(value);
  await AsyncStorage.setItem(
    DICTATION_PREFERENCES_KEY,
    JSON.stringify(preferences),
  );
  return preferences;
}

function asVocabularyEntry(value: unknown): DictationVocabularyEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const term = typeof record.term === "string" ? record.term.trim() : "";
  const replacement =
    typeof record.replacement === "string" ? record.replacement.trim() : "";
  if (!id || !term || !replacement) return null;
  return {
    id,
    term,
    replacement,
    usesCount:
      typeof record.usesCount === "number" && Number.isFinite(record.usesCount)
        ? Math.max(0, Math.floor(record.usesCount))
        : 0,
  };
}

export async function listDictationVocabulary(
  session?: ClipsSession,
): Promise<DictationVocabularyEntry[]> {
  const result = await callClipsAction<{ vocabulary?: unknown[] }>(
    "list-vocabulary",
    { limit: 100 },
    { method: "GET", session },
  );
  return (result.vocabulary ?? []).flatMap((value) => {
    const entry = asVocabularyEntry(value);
    return entry ? [entry] : [];
  });
}

export async function addDictationVocabularyTerm(
  term: string,
  replacement?: string,
): Promise<void> {
  const cleanTerm = term.trim().slice(0, 120);
  const cleanReplacement = (replacement?.trim() || cleanTerm).slice(0, 120);
  if (!cleanTerm) throw new Error("Enter a word or phrase first.");
  await callClipsAction("add-vocabulary-term", {
    term: cleanTerm,
    replacement: cleanReplacement,
    confidence: 1,
  });
}

export async function removeDictationVocabularyTerm(id: string): Promise<void> {
  await callClipsAction("remove-vocabulary-term", { id }, { method: "DELETE" });
}

export function buildDictationInstructions(
  preferences: DictationPreferences,
  vocabulary: readonly DictationVocabularyEntry[],
): string {
  const normalized = normalizeDictationPreferences(preferences);
  const parts = [STYLE_INSTRUCTIONS[normalized.cleanupStyle]];
  if (normalized.customInstructions) {
    parts.push(`User style preference: ${normalized.customInstructions}`);
  }
  const terms = vocabulary
    .slice(0, 100)
    .map((entry) => {
      const term = entry.term
        .replace(/[\r\n;]/g, " ")
        .trim()
        .slice(0, 120);
      const replacement = entry.replacement
        .replace(/[\r\n;]/g, " ")
        .trim()
        .slice(0, 120);
      if (!term || !replacement) return null;
      return term === replacement ? replacement : `${term} -> ${replacement}`;
    })
    .filter((value): value is string => Boolean(value));
  if (terms.length > 0) {
    parts.push(`Preferred vocabulary and spellings: ${terms.join("; ")}.`);
  }
  return parts.join("\n");
}
