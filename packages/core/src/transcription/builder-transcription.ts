import {
  resolveBuilderAuthHeader,
  getBuilderProxyOrigin,
} from "../server/credential-provider.js";

export interface BuilderTranscribeOptions {
  audioBytes: Uint8Array;
  mimeType: string;
  model?: string;
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
  language?: string;
  instructions?: string;
  timeoutMs?: number;
}

export interface BuilderTranscribeResult {
  text: string;
  language: string;
  durationSeconds: number;
  segments: Array<{
    startMs: number;
    endMs: number;
    text: string;
    speakerLabel?: string;
    words?: Array<{
      startMs: number;
      endMs: number;
      text: string;
      confidence?: number;
    }>;
  }>;
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeText = cause ? `; cause: ${describeError(cause)}` : "";
  return `${err.name}: ${err.message}${causeText}`;
}

export async function transcribeWithBuilder(
  opts: BuilderTranscribeOptions,
): Promise<BuilderTranscribeResult> {
  const authHeader = await resolveBuilderAuthHeader();
  if (!authHeader) {
    throw new Error(
      "Builder private key not configured. Connect your Builder.io account in Settings.",
    );
  }

  const params = new URLSearchParams();
  params.set("mimeType", opts.mimeType);
  if (opts.model) params.set("model", opts.model);
  if (opts.diarize != null) params.set("diarize", String(opts.diarize));
  if (opts.minSpeakers != null)
    params.set("minSpeakers", String(opts.minSpeakers));
  if (opts.maxSpeakers != null)
    params.set("maxSpeakers", String(opts.maxSpeakers));
  if (opts.language) params.set("language", opts.language);
  if (opts.instructions) params.set("instructions", opts.instructions);

  const url = `${getBuilderProxyOrigin()}/agent-native/transcribe-audio?${params.toString()}`;

  // Copy to a plain ArrayBuffer so TS6 accepts it as BodyInit (Uint8Array
  // with ArrayBufferLike doesn't satisfy the strict BlobPart/BodyInit types).
  const body = opts.audioBytes.buffer.slice(
    opts.audioBytes.byteOffset,
    opts.audioBytes.byteOffset + opts.audioBytes.byteLength,
  ) as ArrayBuffer;

  const timeoutMs =
    typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/octet-stream",
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error(
        `Builder transcription timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`,
      );
    }
    throw new Error(
      `Builder transcription request failed before response: ${describeError(err)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 402) {
    throw new Error(
      "Builder transcription credits exhausted. Upgrade your Builder.io plan or configure another supported fallback.",
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Builder transcription failed (${res.status} ${res.statusText}): ${text}`,
    );
  }

  return (await res.json()) as BuilderTranscribeResult;
}
