import { callClipsAction, getClipsBaseUrl } from "./clips-api";
import { type ClipsSession, getClipsSession } from "./clips-session";
import {
  buildDictationInstructions,
  listDictationVocabulary,
  loadDictationPreferences,
} from "./dictation-preferences";

interface TranscribeVoiceResult {
  text?: string;
  error?: string;
}

interface CreateDictationResult {
  id: string;
}

function extensionForMimeType(mimeType: string): string {
  if (/webm/i.test(mimeType)) return "webm";
  if (/aac/i.test(mimeType)) return "aac";
  return "m4a";
}

async function resolveDictationSession(
  expectedOwnerKey?: string,
): Promise<ClipsSession> {
  const session = await getClipsSession();
  if (!session) throw new Error("Connect to Clips before using dictation.");
  if (expectedOwnerKey && expectedOwnerKey !== session.ownerKey) {
    throw new Error(
      "This dictation belongs to a different Clips account. Switch back to retry it.",
    );
  }
  return session;
}

export async function transcribeMobileAudio(
  uri: string,
  mimeType: string,
  signal?: AbortSignal,
  expectedOwnerKey?: string,
): Promise<string> {
  const session = await resolveDictationSession(expectedOwnerKey);
  const [preferences, vocabulary] = await Promise.all([
    loadDictationPreferences(),
    listDictationVocabulary(session).catch(() => []),
  ]);
  const form = new FormData();
  form.append("audio", {
    uri,
    name: `mobile-dictation.${extensionForMimeType(mimeType)}`,
    type: mimeType,
  } as unknown as Blob);
  form.append("provider", "auto");
  if (preferences.language) form.append("language", preferences.language);
  form.append(
    "instructions",
    buildDictationInstructions(preferences, vocabulary),
  );

  const response = await fetch(
    `${getClipsBaseUrl()}/_agent-native/transcribe-voice`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "X-Agent-Native-Client": "mobile",
      },
      body: form,
      signal,
    },
  );
  const payload = (await response
    .json()
    .catch(() => ({}))) as TranscribeVoiceResult;
  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Could not transcribe this recording (${response.status}).`,
    );
  }
  const text = payload.text?.trim();
  if (!text)
    throw new Error("No speech was detected. Your audio is still saved.");
  return text;
}

export async function saveMobileDictation(input: {
  id: string;
  text: string;
  durationMs: number;
  startedAt: string;
  ownerKey?: string;
}): Promise<string> {
  const session = await resolveDictationSession(input.ownerKey);
  const result = await callClipsAction<CreateDictationResult>(
    "create-dictation",
    {
      id: input.id,
      fullText: input.text,
      cleanedText: input.text,
      durationMs: input.durationMs,
      source: "mobile",
      targetApp: "Mobile clipboard",
      startedAt: input.startedAt,
    },
    { idempotencyKey: `dictation:${input.id}:create`, session },
  );
  return result.id;
}

export async function updateMobileDictation(
  id: string,
  text: string,
  ownerKey?: string,
): Promise<void> {
  const session = await resolveDictationSession(ownerKey);
  await callClipsAction(
    "update-dictation",
    {
      id,
      fullText: text,
      cleanedText: text,
      source: "mobile",
      targetApp: "Mobile clipboard",
    },
    { session },
  );
}

let lastDictatedText: string | null = null;

export function setLastDictatedText(text: string | null) {
  lastDictatedText = text;
}

export function getAndClearLastDictatedText(): string | null {
  const t = lastDictatedText;
  lastDictatedText = null;
  return t;
}
