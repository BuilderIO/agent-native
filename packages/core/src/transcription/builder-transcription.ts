import {
  hasBuilderPrivateKey,
  getBuilderProxyOrigin,
  getBuilderAuthHeader,
} from "../server/credential-provider.js";

export interface BuilderTranscribeOptions {
  audioBytes: Uint8Array;
  mimeType: string;
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
  language?: string;
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

export async function transcribeWithBuilder(
  opts: BuilderTranscribeOptions,
): Promise<BuilderTranscribeResult> {
  if (!hasBuilderPrivateKey()) {
    throw new Error(
      "Builder private key not configured. Connect your Builder.io account in Settings.",
    );
  }

  const authHeader = getBuilderAuthHeader();
  if (!authHeader) {
    throw new Error("Could not generate Builder auth header.");
  }

  const params = new URLSearchParams();
  params.set("mimeType", opts.mimeType);
  if (opts.diarize != null) params.set("diarize", String(opts.diarize));
  if (opts.minSpeakers != null)
    params.set("minSpeakers", String(opts.minSpeakers));
  if (opts.maxSpeakers != null)
    params.set("maxSpeakers", String(opts.maxSpeakers));
  if (opts.language) params.set("language", opts.language);

  const url = `${getBuilderProxyOrigin()}/agent-native/transcribe-audio?${params.toString()}`;

  // Copy to a plain ArrayBuffer so TS6 accepts it as BodyInit (Uint8Array
  // with ArrayBufferLike doesn't satisfy the strict BlobPart/BodyInit types).
  const body = opts.audioBytes.buffer.slice(
    opts.audioBytes.byteOffset,
    opts.audioBytes.byteOffset + opts.audioBytes.byteLength,
  ) as ArrayBuffer;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
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
      throw new Error("Builder transcription timed out after 45 seconds.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 402) {
    throw new Error(
      "Builder transcription credits exhausted. Upgrade your plan or switch to OpenAI Whisper in Settings.",
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Builder transcription failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  return (await res.json()) as BuilderTranscribeResult;
}
