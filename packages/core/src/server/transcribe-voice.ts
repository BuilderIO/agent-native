/**
 * POST /_agent-native/transcribe-voice
 *
 * Receives an audio blob from the agent sidebar composer and forwards it to
 * OpenAI Whisper. Returns `{ text }` on success, `{ error }` on failure.
 *
 * Key resolution order (mirrors `templates/clips/actions/request-transcript.ts`):
 *   1. User-scoped encrypted secret (`readAppSecret` — set via the sidebar
 *      settings UI).
 *   2. `resolveCredential("OPENAI_API_KEY")` — env var + SQL settings store.
 *
 * If no key is configured, returns 400 with an error the composer UI can
 * surface (the client falls back to the browser Web Speech API).
 *
 * This is a framework route rather than a `defineAction` because multipart
 * audio bodies aren't a clean fit for the action contract (actions are
 * typed JSON-in / JSON-out).
 */

import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readAppSecret } from "../secrets/storage.js";
import { resolveCredential } from "../credentials/index.js";
import { getSession } from "./auth.js";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper hard limit.

/**
 * Reject cross-site POSTs. Cookies are `SameSite=None; Secure` over HTTPS so
 * the browser would otherwise attach the session to a forged form submission
 * from evil.com, causing us to spend OpenAI credits on the user's behalf.
 * Same-origin browsers always send `Origin` on POST; if it's missing we fall
 * back to `Sec-Fetch-Site` so Safari's fetch-spec behavior still works.
 */
function isSameOriginRequest(event: H3Event): boolean {
  const host = getRequestHeader(event, "host");
  const origin = getRequestHeader(event, "origin");
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const fetchSite = getRequestHeader(event, "sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  // No Origin and no Sec-Fetch-Site: likely a non-browser client (curl,
  // server-side) — safe to allow, CSRF requires a browser with ambient cookies.
  return true;
}

export function createTranscribeVoiceHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected" };
    }

    const parts = await readMultipartFormData(event).catch(() => null);
    const audio = parts?.find((p) => p.name === "audio");
    if (!audio?.data?.length) {
      setResponseStatus(event, 400);
      return { error: "Missing audio payload" };
    }
    if (audio.data.length > MAX_AUDIO_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Audio too large (max 25 MB)" };
    }

    const languagePart = parts?.find((p) => p.name === "language");
    const language = languagePart?.data
      ? languagePart.data.toString("utf8").trim().slice(0, 8)
      : undefined;

    // Resolve the key.
    let apiKey: string | undefined;
    const session = await getSession(event).catch(() => null);
    if (session?.email) {
      const userSecret = await readAppSecret({
        key: "OPENAI_API_KEY",
        scope: "user",
        scopeId: session.email,
      }).catch(() => null);
      if (userSecret?.value) apiKey = userSecret.value;
    }
    if (!apiKey) {
      apiKey = await resolveCredential("OPENAI_API_KEY");
    }
    if (!apiKey) {
      setResponseStatus(event, 400);
      return {
        error:
          "OPENAI_API_KEY not configured. Add it in Settings → API Keys to enable Whisper transcription.",
      };
    }

    const mime = audio.type || "audio/webm";
    const ext = pickExtension(mime);
    const filename = `composer-voice.${ext}`;

    const form = new FormData();
    const bytes = new Uint8Array(
      audio.data.buffer,
      audio.data.byteOffset,
      audio.data.byteLength,
    );
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("model", "whisper-1");
    form.append("response_format", "json");
    if (language) form.append("language", language);

    try {
      const res = await fetch(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setResponseStatus(event, res.status === 401 ? 401 : 502);
        return {
          error:
            res.status === 401
              ? "OpenAI rejected the API key. Update it in Settings → API Keys."
              : `Whisper API error ${res.status}: ${text.slice(0, 300)}`,
        };
      }
      const data = (await res.json()) as { text?: string };
      return { text: (data.text ?? "").trim() };
    } catch (err) {
      setResponseStatus(event, 502);
      return {
        error: `Could not reach OpenAI: ${(err as Error)?.message ?? err}`,
      };
    }
  });
}

function pickExtension(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) return "mp4";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  return "webm";
}
