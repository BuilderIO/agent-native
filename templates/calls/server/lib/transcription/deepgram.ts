import type { TranscriptSegment } from "../../../shared/api.js";

export interface TranscribeOptions {
  apiKey: string;
  mediaUrl?: string;
  mediaBytes?: Uint8Array | ArrayBuffer;
  mimeType?: string;
  callbackUrl?: string;
}

export interface TranscribeResult {
  language: string;
  segments: TranscriptSegment[];
  fullText: string;
  requestId: string | null;
}

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";

const BASE_QUERY_PARAMS: Record<string, string> = {
  model: "nova-3",
  diarize: "true",
  punctuate: "true",
  paragraphs: "true",
  utterances: "true",
  smart_format: "true",
  detect_language: "true",
};

function buildQueryString(callbackUrl?: string): string {
  const params = new URLSearchParams(BASE_QUERY_PARAMS);
  if (callbackUrl) params.set("callback", callbackUrl);
  return params.toString();
}

export async function transcribeWithDeepgram(
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const { apiKey, mediaUrl, mediaBytes, mimeType, callbackUrl } = options;

  if (!apiKey) {
    throw new Error("Deepgram API key is required");
  }
  if (!mediaUrl && !mediaBytes) {
    throw new Error("Either mediaUrl or mediaBytes must be provided");
  }

  const url = `${DEEPGRAM_ENDPOINT}?${buildQueryString(callbackUrl)}`;
  const headers: Record<string, string> = {
    Authorization: `Token ${apiKey}`,
  };

  let body: BodyInit;
  if (mediaUrl) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ url: mediaUrl });
  } else {
    headers["Content-Type"] = mimeType || "application/octet-stream";
    body = mediaBytes as BodyInit;
  }

  const response = await fetch(url, { method: "POST", headers, body });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Deepgram request failed: ${response.status} ${response.statusText}${
        errorText ? ` — ${errorText.slice(0, 500)}` : ""
      }`,
    );
  }

  const json = (await response.json().catch(() => null)) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("Deepgram returned an empty or invalid response");
  }

  if (callbackUrl) {
    const requestId =
      (json as { request_id?: string }).request_id ||
      (json as { requestId?: string }).requestId ||
      null;
    return { language: "en", segments: [], fullText: "", requestId };
  }

  return parseDeepgramResponse(json);
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number;
}

interface DeepgramUtterance {
  start?: number;
  end?: number;
  speaker?: number;
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  detected_language?: string;
  alternatives?: Array<{
    transcript?: string;
    confidence?: number;
    words?: DeepgramWord[];
  }>;
}

interface DeepgramResponse {
  request_id?: string;
  metadata?: { request_id?: string };
  results?: {
    language?: string;
    utterances?: DeepgramUtterance[];
    channels?: DeepgramChannel[];
  };
}

export function parseDeepgramResponse(raw: unknown): TranscribeResult {
  const json = (raw || {}) as DeepgramResponse;
  const requestId = json.request_id || json.metadata?.request_id || null;

  const utterances = json.results?.utterances ?? [];
  const channelLanguage =
    json.results?.language ||
    json.results?.channels?.[0]?.detected_language ||
    "en";

  const segments: TranscriptSegment[] = utterances
    .map((u) => toSegment(u))
    .filter((s): s is TranscriptSegment => s !== null);

  let fullText = segments
    .map((s) => s.text)
    .join(" ")
    .trim();
  if (!fullText) {
    const alt = json.results?.channels?.[0]?.alternatives?.[0];
    if (alt?.transcript) fullText = alt.transcript.trim();
  }

  return {
    language: channelLanguage,
    segments,
    fullText,
    requestId,
  };
}

function toSegment(u: DeepgramUtterance): TranscriptSegment | null {
  const text = (u.transcript ?? "").trim();
  if (!text) return null;
  const startMs = Math.max(0, Math.round((u.start ?? 0) * 1000));
  const endMs = Math.max(startMs, Math.round((u.end ?? 0) * 1000));
  const speaker = typeof u.speaker === "number" ? u.speaker : 0;
  const words =
    u.words?.map((w) => ({
      startMs: Math.max(0, Math.round((w.start ?? 0) * 1000)),
      endMs: Math.max(0, Math.round((w.end ?? 0) * 1000)),
      text: w.punctuated_word || w.word || "",
      confidence: typeof w.confidence === "number" ? w.confidence : undefined,
    })) ?? undefined;
  return {
    startMs,
    endMs,
    text,
    speakerLabel: `Speaker ${speaker}`,
    confidence: typeof u.confidence === "number" ? u.confidence : undefined,
    words,
  };
}
