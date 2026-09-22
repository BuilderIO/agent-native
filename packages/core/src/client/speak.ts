/**
 * Client for `POST /_agent-native/speak`.
 *
 * Exists so app code never hand-writes the framework route. Returns the audio
 * as a `Blob` the caller turns into an object URL, and keeps "no provider is
 * configured" as its own outcome — a caller that can fall back to the
 * browser's speech synthesiser must be able to tell that apart from a failure.
 */

import { SPEECH_MAX_CHARS } from "../shared/speech.js";
import { agentNativePath } from "./api-path.js";

export { SPEECH_MAX_CHARS };

const SPEAK_PATH = "/_agent-native/speak";

export type SpeechClipFailure = "no-provider" | "too-long" | "provider-error";

/**
 * Discriminated on a string rather than a boolean: app code compiles without
 * `strictNullChecks`, where `ok: true | false` widens to `boolean` and stops
 * narrowing the union at the call site.
 */
export type SpeechClipResult =
  | { status: "ok"; blob: Blob }
  | { status: "failed"; reason: SpeechClipFailure; message: string };

export interface SpeechClipInput {
  text: string;
  /** One of the provider's named voices; the server rejects an unknown one. */
  voice?: string;
  /** Delivery direction for the model, e.g. "read as a newsroom anchor". */
  instructions?: string;
  signal?: AbortSignal;
}

export async function fetchSpeechClip({
  text,
  voice,
  instructions,
  signal,
}: SpeechClipInput): Promise<SpeechClipResult> {
  let res: Response;
  try {
    res = await fetch(agentNativePath(SPEAK_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ...(voice ? { voice } : {}),
        ...(instructions ? { instructions } : {}),
      }),
      signal,
    });
  } catch (err) {
    return {
      status: "failed",
      reason: "provider-error",
      message: (err as Error)?.message ?? String(err),
    };
  }

  if (!res.ok) {
    // coercion-ok: the non-ok status is already the failure; a non-JSON body falls back to the status-derived reason below.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      reason?: string;
    } | null;
    // Only an explicit `no-provider` earns the fallback. Mapping any 400 to it
    // would let a malformed request read as "narration is not configured", and
    // the caller would quietly downgrade the voice forever.
    const reason: SpeechClipFailure =
      body?.reason === "no-provider"
        ? "no-provider"
        : body?.reason === "too-long" || res.status === 413
          ? "too-long"
          : "provider-error";
    return {
      status: "failed",
      reason,
      message: body?.error ?? `Speech request failed (${res.status})`,
    };
  }

  const blob = await res.blob();
  // A 200 with no bytes plays as silence, which reads to the listener as a
  // broken feature rather than a broken provider.
  if (blob.size === 0) {
    return {
      status: "failed",
      reason: "provider-error",
      message: "Speech response was empty",
    };
  }
  return { status: "ok", blob };
}
