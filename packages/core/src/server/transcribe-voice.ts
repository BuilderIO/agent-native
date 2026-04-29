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
import { appStateGet } from "../application-state/store.js";
import { resolveHasBuilderPrivateKey } from "./credential-provider.js";
import { transcribeWithBuilder } from "../transcription/builder-transcription.js";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const OPENAI_MODEL = "whisper-1";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper hard limit.

// Gemini Flash Lite — fastest path when GEMINI_API_KEY is configured.
// Gemini accepts inline audio; we just give it the bytes and a "transcribe
// this" prompt and it replies with text. 2.5x faster TTFT than 2.5 Flash
// per Google's release notes, and noticeably snappier than the Whisper
// round-trip even on a fast connection.
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
      const parsed = new URL(origin);
      if (parsed.host === host) return true;
      // Tauri desktop dev serves the tray WebView from localhost:1420 while
      // the app server lives on the template dev port. Production Tauri
      // WebViews can also send a tauri://localhost origin. Treat only those
      // desktop origins as trusted cross-origin callers; arbitrary websites
      // still fail the CSRF check.
      if (parsed.protocol === "tauri:" && parsed.hostname === "localhost") {
        return true;
      }
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname === "tauri.localhost" &&
        (host.startsWith("localhost:") || host.startsWith("127.0.0.1:"))
      ) {
        return true;
      }
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        parsed.port === "1420" &&
        (host.startsWith("localhost:") || host.startsWith("127.0.0.1:"))
      ) {
        return true;
      }
      return false;
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

    // Resolve provider preference from application_state.
    const session = await getSession(event).catch(() => null);
    const sessionId =
      session?.email === "local@localhost"
        ? "local"
        : (session?.email ?? "local");
    let providerPref: string | undefined;
    try {
      const prefs = await appStateGet(sessionId, "voice-transcription-prefs");
      providerPref = (prefs as { provider?: string } | null)?.provider;
    } catch {
      /* fall through — default to openai path */
    }

    // Respect explicit "browser" preference — user chose Web Speech API and
    // does not want audio uploaded to any external provider. The client
    // shouldn't hit this endpoint when "browser" is selected; this is a
    // defense-in-depth refusal.
    if (providerPref === "browser") {
      setResponseStatus(event, 400);
      return {
        error:
          'Voice provider is set to "browser" (Web Speech API only). Change the preference in Settings → Voice Transcription to use a server-side provider.',
      };
    }

    const mime = audio.type || "audio/webm";
    const audioBytes = new Uint8Array(
      audio.data.buffer,
      audio.data.byteOffset,
      audio.data.byteLength,
    );

    let builderError: string | null = null;

    // Per-user-or-fallback API key resolution. Hoisted up so the Gemini
    // path below can use it without duplicating logic.
    async function resolveApiKey(key: string): Promise<string | undefined> {
      const ctx = { userEmail: session?.email };
      if (!session?.email)
        return (await resolveCredential(key, ctx)) ?? undefined;
      const userSecret = await readAppSecret({
        key,
        scope: "user",
        scopeId: session.email,
      }).catch(() => null);
      return (
        userSecret?.value || (await resolveCredential(key, ctx)) || undefined
      );
    }

    // ── Gemini Flash Lite path (fastest) ────────────────────────────────
    // First-priority when a Gemini key is configured. The provider-pref
    // "openai" still forces Whisper; otherwise we try Gemini before
    // Builder / Groq / OpenAI Whisper because it's reliably faster.
    if (providerPref !== "openai") {
      const geminiKey = await resolveApiKey("GEMINI_API_KEY");
      if (geminiKey) {
        try {
          const text = await transcribeWithGemini({
            audioBytes,
            mimeType: mime,
            apiKey: geminiKey,
            language: language || undefined,
          });
          const trimmed = text.trim();
          if (trimmed) {
            console.log(`[transcribe-voice] Gemini → ${trimmed.length} chars`);
            return { text: trimmed };
          }
          console.warn(
            "[transcribe-voice] Gemini returned empty text — falling through to next provider",
          );
        } catch (err) {
          console.warn(
            "[transcribe-voice] Gemini path failed, falling through:",
            (err as Error)?.message ?? err,
          );
        }
      }
    }

    // ── Builder proxy path ──────────────────────────────────────────────
    if (providerPref !== "openai" && (await resolveHasBuilderPrivateKey())) {
      try {
        const result = await transcribeWithBuilder({
          audioBytes,
          mimeType: mime,
          language: language || undefined,
        });
        return { text: (result.text ?? "").trim() };
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        // Surface 402 (credits exhausted) as a 402 so the client can show
        // a specific upgrade prompt.
        if (message.includes("credits exhausted")) {
          setResponseStatus(event, 402);
          return { error: message };
        }
        builderError = message;
      }
    }

    // If Builder is unavailable, fall through to BYOK providers rather than
    // hard-failing. This mirrors Clips' batch transcription path.

    // ── Groq / OpenAI Whisper-compatible path ──────────────────────────
    // (resolveApiKey is hoisted above so the Gemini path can use it too.)

    let provider: {
      name: "groq" | "openai";
      endpoint: string;
      model: string;
      apiKey: string;
    } | null = null;

    if (providerPref !== "openai") {
      const groqKey = await resolveApiKey("GROQ_API_KEY");
      if (groqKey) {
        provider = {
          name: "groq",
          endpoint: GROQ_URL,
          model: GROQ_MODEL,
          apiKey: groqKey,
        };
      }
    }
    if (!provider) {
      const openaiKey = await resolveApiKey("OPENAI_API_KEY");
      if (openaiKey) {
        provider = {
          name: "openai",
          endpoint: WHISPER_URL,
          model: OPENAI_MODEL,
          apiKey: openaiKey,
        };
      }
    }

    if (!provider) {
      setResponseStatus(event, builderError ? 502 : 400);
      return {
        error: builderError
          ? `Builder transcription failed: ${builderError}. Add GROQ_API_KEY or OPENAI_API_KEY in Settings → API Keys to enable a fallback provider.`
          : "No voice transcription provider configured. Connect Builder.io or add GROQ_API_KEY / OPENAI_API_KEY in Settings → API Keys.",
      };
    }

    const ext = pickExtension(mime);
    const filename = `composer-voice.${ext}`;

    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: mime }), filename);
    form.append("model", provider.model);
    form.append("response_format", "json");
    if (language) form.append("language", language);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(provider.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setResponseStatus(event, res.status === 401 ? 401 : 502);
        return {
          error:
            res.status === 401
              ? `${provider.name} rejected the API key. Update it in Settings → API Keys.`
              : `${provider.name} transcription error ${res.status}: ${text.slice(0, 300)}`,
        };
      }
      const data = (await res.json()) as { text?: string };
      return { text: (data.text ?? "").trim() };
    } catch (err) {
      setResponseStatus(event, 502);
      return {
        error:
          (err as Error)?.name === "AbortError"
            ? `${provider.name} transcription timed out after 45 seconds.`
            : `Could not reach ${provider.name}: ${(err as Error)?.message ?? err}`,
      };
    } finally {
      clearTimeout(timeout);
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

/**
 * Transcribe audio via Gemini Flash Lite.
 *
 * Gemini accepts the audio inline as base64 alongside a text prompt; we
 * ask for just the transcript with no preamble. 30s timeout — Gemini is
 * fast and we'd rather fall through to Whisper than wait longer.
 *
 * Gemini's documented audio formats are WAV / MP3 / AIFF / AAC / OGG /
 * FLAC — webm/opus is not officially supported but in practice it
 * accepts webm too. If Gemini rejects it the caller falls through.
 */
async function transcribeWithGemini({
  audioBytes,
  mimeType,
  apiKey,
  language,
}: {
  audioBytes: Uint8Array;
  mimeType: string;
  apiKey: string;
  language?: string;
}): Promise<string> {
  const base64 = uint8ArrayToBase64(audioBytes);
  const prompt = language
    ? `Transcribe the speech in this audio (language: ${language}). Output only the transcript text — no preamble, no quotes, no formatting.`
    : "Transcribe the speech in this audio. Output only the transcript text — no preamble, no quotes, no formatting.";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: normalizeAudioMimeForGemini(mimeType),
                  data: base64,
                },
              },
            ],
          },
        ],
        // Keep generation tight — we want the transcript verbatim, no
        // creative reinterpretation.
        generationConfig: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAudioMimeForGemini(mime: string): string {
  // Strip codec parameters — Gemini doesn't need them and some variants
  // (e.g. "audio/webm;codecs=opus") are rejected as unknown.
  const lower = mime.toLowerCase().split(";")[0].trim();
  if (!lower) return "audio/webm";
  return lower;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Fallback for non-Node runtimes — chunk to avoid stack overflow.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return btoa(binary);
}
