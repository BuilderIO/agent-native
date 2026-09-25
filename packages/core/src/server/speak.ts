/**
 * POST /_agent-native/speak
 *
 * Text in, spoken audio out — the inverse of `transcribe-voice`, and a
 * framework route for the same reason: the response is audio bytes, not the
 * typed JSON an action contract returns.
 *
 * Returns 400 `{ error }` when no provider is configured, so a client can fall
 * back to the browser's own speech synthesiser instead of showing a failure.
 */

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { SPEECH_MAX_CHARS } from "../shared/speech.js";

export { SPEECH_MAX_CHARS };
import { getSession } from "./auth.js";
import { resolveSecret } from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts";

/**
 * Synthesis is slower than a chat completion and scales with the script, so
 * this is a ceiling for a full page of narration, not a typical latency.
 */
const SPEAK_TIMEOUT_MS = 90_000;

/** The provider's named voices. Proper nouns — never localized. */
export const SPEAK_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
] as const;

export type SpeakVoice = (typeof SPEAK_VOICES)[number];

export const DEFAULT_SPEAK_VOICE: SpeakVoice = "alloy";

export function isSpeakVoice(value: unknown): value is SpeakVoice {
  return (
    typeof value === "string" &&
    (SPEAK_VOICES as readonly string[]).includes(value)
  );
}

/**
 * Discriminated on a string rather than a boolean: template code compiles
 * without `strictNullChecks`, where `ok: true | false` widens to `boolean` and
 * stops narrowing the union at the call site.
 */
export type SpeakResult =
  | { status: "ok"; audio: Uint8Array; mimeType: string; model: string }
  | {
      status: "failed";
      /**
       * `no-provider` is a configuration state a client can route around;
       * `provider-error` and `too-long` are failures. They are separate values
       * because the fallback is only correct for the first.
       */
      reason: "no-provider" | "empty" | "too-long" | "provider-error";
      message: string;
    };

export interface SynthesizeSpeechInput {
  text: string;
  voice?: SpeakVoice;
  /**
   * Delivery direction for the model ("read as a calm newsroom anchor"). This
   * is what separates a narrator from a screen reader; the voice alone does not.
   */
  instructions?: string;
  apiKey?: string | null;
}

/**
 * Posts one script to the provider and hands back the bytes. Takes the resolved
 * key rather than resolving it, so it runs in a test without a request context.
 */
export async function synthesizeSpeech({
  text,
  voice = DEFAULT_SPEAK_VOICE,
  instructions,
  apiKey,
}: SynthesizeSpeechInput): Promise<SpeakResult> {
  const input = text.trim();
  if (!input) {
    return { status: "failed", reason: "empty", message: "Nothing to speak" };
  }
  if (input.length > SPEECH_MAX_CHARS) {
    return {
      status: "failed",
      reason: "too-long",
      message: `Script is ${input.length} characters; the limit is ${SPEECH_MAX_CHARS}`,
    };
  }
  if (!apiKey) {
    return {
      status: "failed",
      reason: "no-provider",
      message:
        "No speech provider configured. Add OPENAI_API_KEY in Settings → API Keys to enable narration.",
    };
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_SPEECH_MODEL,
        input,
        voice,
        response_format: "mp3",
        ...(instructions ? { instructions } : {}),
      }),
      signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(
      `[speak] ${OPENAI_SPEECH_MODEL} request threw: ${message(err)}`,
    );
    return {
      status: "failed",
      reason: "provider-error",
      message: `Speech request failed: ${message(err)}`,
    };
  }

  if (!res.ok) {
    // coercion-ok: the non-ok status is already the failure; an unreadable body loses detail, not the refusal.
    const detail = await res.text().catch(() => "");
    // The caller only forwards this to a browser, where a 502 shows as a bare
    // status; without a server-side line the upstream reason is unreachable.
    console.warn(
      `[speak] ${OPENAI_SPEECH_MODEL} returned ${res.status}: ${detail.slice(0, 600)}`,
    );
    return {
      status: "failed",
      reason: "provider-error",
      message: `Speech provider returned ${res.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    };
  }

  const audio = new Uint8Array(await res.arrayBuffer());
  // An empty 200 is a failure wearing a success code: play it and the reader
  // hears silence and concludes the feature is broken, not the provider.
  if (audio.byteLength === 0) {
    return {
      status: "failed",
      reason: "provider-error",
      message: "Speech provider returned an empty audio body",
    };
  }
  return {
    status: "ok",
    audio,
    mimeType: "audio/mpeg",
    model: OPENAI_SPEECH_MODEL,
  };
}

function message(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

export function createSpeakHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed", reason: "not-allowed" };
    }
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected", reason: "not-allowed" };
    }

    let body:
      | {
          text?: unknown;
          voice?: unknown;
          instructions?: unknown;
        }
      | null
      | undefined;
    try {
      body = await readBody(event);
    } catch (err) {
      setResponseStatus(event, 400);
      return {
        error: `Request body was not readable JSON: ${message(err)}`,
        reason: "unreadable-body",
      };
    }
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) {
      setResponseStatus(event, 400);
      return { error: "Missing text", reason: "empty" };
    }
    if (text.length > SPEECH_MAX_CHARS) {
      setResponseStatus(event, 413);
      return {
        error: `Script is ${text.length} characters; the limit is ${SPEECH_MAX_CHARS}`,
        reason: "too-long",
      };
    }

    /*
     * A session or org read that throws must not degrade to "anonymous".
     * `resolveSecret` searches exactly one organization, so losing the
     * caller's identity here resolves the wrong key — or none, which this
     * route reports as `no-provider` and every client treats as "narration is
     * not configured". The user who did configure it would never find out.
     */
    let session: Awaited<ReturnType<typeof getSession>> | null;
    try {
      session = await getSession(event);
    } catch (err) {
      setResponseStatus(event, 503);
      return {
        error: `Session could not be read: ${message(err)}`,
        reason: "identity-unavailable",
      };
    }
    // Synthesis spends the resolved provider key, so an identity is required
    // before one is read: an anonymous caller would otherwise bill the deploy
    // key, and a caller-less resolve searches the wrong organization anyway.
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Authentication required", reason: "not-allowed" };
    }

    let orgId: string | undefined;
    try {
      orgId = (await getOrgContext(event))?.orgId ?? undefined;
    } catch (err) {
      setResponseStatus(event, 503);
      return {
        error: `Organization context could not be read: ${message(err)}`,
        reason: "identity-unavailable",
      };
    }
    const apiKey = await runWithRequestContext(
      { userEmail: session.email, orgId },
      () => resolveSecret("OPENAI_API_KEY"),
    );

    // A misspelled voice must not quietly become the default one: the caller
    // asked for a specific narrator and would never hear that it got another.
    if (body?.voice !== undefined && !isSpeakVoice(body.voice)) {
      setResponseStatus(event, 400);
      return {
        error: `Unknown voice ${JSON.stringify(body.voice)}. Expected one of: ${SPEAK_VOICES.join(", ")}`,
        reason: "unknown-voice",
      };
    }

    const result = await synthesizeSpeech({
      text,
      voice: isSpeakVoice(body?.voice) ? body.voice : DEFAULT_SPEAK_VOICE,
      instructions:
        typeof body?.instructions === "string" ? body.instructions : undefined,
      apiKey,
    });

    if (result.status === "failed") {
      setResponseStatus(
        event,
        result.reason === "no-provider" || result.reason === "empty"
          ? 400
          : result.reason === "too-long"
            ? 413
            : 502,
      );
      return { error: result.message, reason: result.reason };
    }

    setResponseHeader(event, "Content-Type", result.mimeType);
    setResponseHeader(event, "Content-Length", String(result.audio.byteLength));
    // Session-scoped narration of a possibly private document: a shared cache
    // must never hold it, and the client keeps its own object URL anyway.
    setResponseHeader(event, "Cache-Control", "no-store");
    return Buffer.from(result.audio);
  });
}
