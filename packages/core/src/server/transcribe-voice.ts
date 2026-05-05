/**
 * POST /_agent-native/transcribe-voice
 *
 * Receives an audio blob from the agent sidebar composer and forwards it to
 * the configured transcription provider. Returns `{ text }` on success,
 * `{ error }` on failure.
 *
 * Key resolution order for BYOK providers:
 *   1. Request-scoped encrypted secret (`app_secrets`: user, org, workspace).
 *   2. Env var fallback only outside authenticated request contexts.
 *
 * If no server provider is configured, returns 400 with an error the
 * composer UI can surface (the client falls back to Web Speech when possible).
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
import { getSession } from "./auth.js";
import { appStateGet } from "../application-state/store.js";
import {
  resolveHasBuilderPrivateKey,
  resolveSecret,
} from "./credential-provider.js";
import { transcribeWithBuilder } from "../transcription/builder-transcription.js";
import { runWithRequestContext } from "./request-context.js";
import { getOrgContext } from "../org/context.js";
import { createBuilderEngine } from "../agent/engine/builder-engine.js";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const GROQ_CLEANUP_MODEL = "llama-3.3-70b-versatile";
const OPENAI_MODEL = "whisper-1";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CLEANUP_MODEL = "gpt-5.4-mini";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper hard limit.
const MAX_TRANSCRIPT_CHARS = 40_000;
// Public Builder transcription model id. The Builder gateway maps this to
// Gemini 3.1 Flash-Lite.
const BUILDER_GEMINI_TRANSCRIPTION_MODEL = "gemini-3-1-flash-lite";

// Gemini Flash Lite BYOK path when GEMINI_API_KEY is configured.
// Gemini accepts inline audio; we just give it the bytes and a "transcribe
// this" prompt and it replies with text. 2.5x faster TTFT than 2.5 Flash
// per Google's release notes, and noticeably snappier than the Whisper
// round-trip even on a fast connection.
// Keep the direct Google AI path on a stable public model id; Builder's
// managed provider above handles the newer Gemini 3.1 Flash-Lite preview.
const GEMINI_MODEL = "gemini-2.0-flash-lite";
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
    const textPart = parts?.find((p) => p.name === "text");
    const transcriptText = textPart?.data
      ? sanitizeTranscriptText(textPart.data.toString("utf8"))
      : undefined;
    if (!audio?.data?.length && !transcriptText) {
      setResponseStatus(event, 400);
      return { error: "Missing audio or transcript payload" };
    }
    if (audio?.data?.length && audio.data.length > MAX_AUDIO_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Audio too large (max 25 MB)" };
    }

    const languagePart = parts?.find((p) => p.name === "language");
    const language = languagePart?.data
      ? languagePart.data.toString("utf8").trim().slice(0, 8)
      : undefined;
    const instructionsPart = parts?.find((p) => p.name === "instructions");
    const instructions = instructionsPart?.data
      ? sanitizeInstructions(instructionsPart.data.toString("utf8"))
      : undefined;

    // Resolve provider preference. Per-request "provider" form field takes
    // precedence (the desktop client sends it on every dictation press),
    // falling back to the user's stored `voice-transcription-prefs` app
    // state for the agent sidebar composer / web clients that don't send
    // it explicitly.
    const session = await getSession(event).catch(() => null);
    if (!session?.email && process.env.NODE_ENV === "production") {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }
    const orgCtx = session?.email
      ? await getOrgContext(event).catch(() => null)
      : null;
    const requestContext = {
      userEmail: session?.email,
      orgId: orgCtx?.orgId ?? undefined,
    };
    const withRequestContext = async <T>(fn: () => Promise<T>): Promise<T> =>
      requestContext.userEmail
        ? runWithRequestContext(requestContext, fn)
        : fn();
    const hasBuilderPrivateKey = async () =>
      withRequestContext(() => resolveHasBuilderPrivateKey());
    const transcribeWithBuilderForRequest = (
      opts: Parameters<typeof transcribeWithBuilder>[0],
    ) => withRequestContext(() => transcribeWithBuilder(opts));
    const sessionId = session?.email ?? "local";
    let providerPref: string | undefined;
    // CRITICAL: presence of the "provider" form field is the explicit
    // signal that the client is making a per-request choice. Even if
    // the value is "auto" (→ undefined providerPref → fallback chain),
    // we must NOT fall back to app-state's stored preference — the
    // client just told us what it wants. Without this gate, a stale
    // `voice-transcription-prefs.provider = "browser"` in app-state
    // (from earlier testing) would override the client's "auto" and
    // 400 with "Voice provider is set to browser".
    const providerPart = parts?.find((p) => p.name === "provider");
    let providerExplicit = false;
    if (providerPart?.data) {
      const v = providerPart.data.toString("utf8").trim().toLowerCase();
      if (
        v === "auto" ||
        v === "browser" ||
        v === "builder" ||
        v === "builder-gemini" ||
        v === "gemini" ||
        v === "openai" ||
        v === "groq"
      ) {
        providerExplicit = true;
        providerPref = v === "auto" ? undefined : v;
      }
    }
    if (!providerExplicit) {
      try {
        const prefs = await appStateGet(sessionId, "voice-transcription-prefs");
        providerPref = (
          prefs as { provider?: string; value?: { provider?: string } } | null
        )?.provider;
        providerPref ??= (prefs as { value?: { provider?: string } } | null)
          ?.value?.provider;
      } catch {
        /* fall through — default to fallback chain */
      }
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

    // Per-user-or-fallback API key resolution. Hoisted up so the Gemini
    // path below can use it without duplicating logic.
    async function resolveApiKey(key: string): Promise<string | undefined> {
      return (await withRequestContext(() => resolveSecret(key))) ?? undefined;
    }

    if (transcriptText) {
      return await cleanupTranscriptText({
        event,
        text: transcriptText,
        instructions,
        providerPref,
        hasBuilderPrivateKey,
        withRequestContext,
        resolveApiKey,
      });
    }

    if (!audio?.data?.length) {
      setResponseStatus(event, 400);
      return { error: "Missing audio payload" };
    }

    const mime = audio.type || "audio/webm";
    const audioBytes = new Uint8Array(
      audio.data.buffer,
      audio.data.byteOffset,
      audio.data.byteLength,
    );

    let builderError: string | null = null;

    // ── Strict per-provider preferences ─────────────────────────────────
    // When the user explicitly picks a single provider (gemini / builder /
    // groq), we only try that provider and surface its error rather than
    // silently falling through. "auto" / undefined keeps the existing
    // fallback chain below. "openai" is handled by the chain (it skips
    // earlier providers and lands on the Whisper path).

    if (providerPref === "gemini") {
      const geminiKey = await resolveApiKey("GEMINI_API_KEY");
      if (!geminiKey) {
        setResponseStatus(event, 400);
        return {
          error:
            "Gemini is selected but GEMINI_API_KEY is not configured. Add it in Settings → API Keys, or change the provider preference.",
        };
      }
      try {
        const text = await transcribeWithGemini({
          audioBytes,
          mimeType: mime,
          apiKey: geminiKey,
          language: language || undefined,
          instructions,
        });
        const trimmed = text.trim();
        if (!trimmed) {
          setResponseStatus(event, 502);
          return { error: "Gemini returned an empty transcript." };
        }
        return { text: trimmed };
      } catch (err) {
        setResponseStatus(event, 502);
        return {
          error: `Gemini transcription failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }
    }

    if (providerPref === "builder" || providerPref === "builder-gemini") {
      const label =
        providerPref === "builder-gemini"
          ? "Builder Gemini Flash-Lite"
          : "Builder";
      if (!(await hasBuilderPrivateKey())) {
        setResponseStatus(event, 400);
        return {
          error: `${label} is selected but Builder.io is not connected. Connect Builder.io in Settings, or change the provider preference.`,
        };
      }
      try {
        const result = await transcribeWithBuilderForRequest({
          audioBytes,
          mimeType: mime,
          model:
            providerPref === "builder-gemini"
              ? BUILDER_GEMINI_TRANSCRIPTION_MODEL
              : undefined,
          language: language || undefined,
          instructions,
        });
        return { text: (result.text ?? "").trim() };
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        if (message.includes("credits exhausted")) {
          setResponseStatus(event, 402);
          return { error: message };
        }
        setResponseStatus(event, 502);
        return { error: `${label} transcription failed: ${message}` };
      }
    }

    if (providerPref === "groq") {
      const groqKey = await resolveApiKey("GROQ_API_KEY");
      if (!groqKey) {
        setResponseStatus(event, 400);
        return {
          error:
            "Groq is selected but GROQ_API_KEY is not configured. Add it in Settings → API Keys, or change the provider preference.",
        };
      }
      return await callWhisperCompat({
        event,
        provider: {
          name: "groq",
          endpoint: GROQ_URL,
          model: GROQ_MODEL,
          apiKey: groqKey,
        },
        audioBytes,
        mime,
        language,
        instructions,
      });
    }

    // ── Auto / undefined / openai fallback chain ────────────────────────

    // ── Builder Gemini Flash-Lite path ─────────────────────────────────
    // First-priority in auto mode when Builder is connected. This lets users
    // try Gemini 3.1 Flash-Lite without bringing their own Google key.
    if (providerPref !== "openai" && (await hasBuilderPrivateKey())) {
      try {
        const result = await transcribeWithBuilderForRequest({
          audioBytes,
          mimeType: mime,
          model: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
          language: language || undefined,
          instructions,
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

    // ── Gemini Flash Lite BYOK path ────────────────────────────────────
    // If Builder is unavailable, try a user-provided Gemini key before
    // Whisper-compatible providers.
    if (providerPref !== "openai") {
      const geminiKey = await resolveApiKey("GEMINI_API_KEY");
      if (geminiKey) {
        try {
          const text = await transcribeWithGemini({
            audioBytes,
            mimeType: mime,
            apiKey: geminiKey,
            language: language || undefined,
            instructions,
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
          ? `Builder transcription failed: ${builderError}. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY in Settings → API Keys to enable a fallback provider.`
          : "No voice transcription provider configured. Connect Builder.io or add GEMINI_API_KEY / GROQ_API_KEY / OPENAI_API_KEY in Settings → API Keys.",
      };
    }

    return await callWhisperCompat({
      event,
      provider,
      audioBytes,
      mime,
      language,
      instructions,
    });
  });
}

/**
 * Posts the audio to a Whisper-compatible OpenAI-style endpoint (Groq or
 * OpenAI itself) and returns `{ text }` / `{ error }` shaped like the
 * other branches in `createTranscribeVoiceHandler`. Hoisted so the
 * strict-Groq preference path and the auto fallback chain share one
 * implementation.
 */
async function callWhisperCompat({
  event,
  provider,
  audioBytes,
  mime,
  language,
  instructions,
}: {
  event: H3Event;
  provider: {
    name: "groq" | "openai";
    endpoint: string;
    model: string;
    apiKey: string;
  };
  audioBytes: Uint8Array;
  mime: string;
  language?: string;
  instructions?: string;
}): Promise<{ text: string } | { error: string }> {
  const ext = pickExtension(mime);
  const filename = `composer-voice.${ext}`;

  const form = new FormData();
  form.append(
    "file",
    new Blob([audioBytes as BlobPart], { type: mime }),
    filename,
  );
  form.append("model", provider.model);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  if (instructions) form.append("prompt", instructions);

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
}

async function cleanupTranscriptText({
  event,
  text,
  instructions,
  providerPref,
  hasBuilderPrivateKey,
  withRequestContext,
  resolveApiKey,
}: {
  event: H3Event;
  text: string;
  instructions?: string;
  providerPref?: string;
  hasBuilderPrivateKey: () => Promise<boolean>;
  withRequestContext: <T>(fn: () => Promise<T>) => Promise<T>;
  resolveApiKey: (key: string) => Promise<string | undefined>;
}): Promise<{ text: string } | { error: string }> {
  const original = text.trim();
  if (!original) return { text: "" };

  if (providerPref === "browser") {
    return { text: original };
  }

  if (providerPref === "builder" || providerPref === "builder-gemini") {
    if (!(await hasBuilderPrivateKey())) {
      setResponseStatus(event, 400);
      return {
        error:
          "Builder.io cleanup is selected but Builder.io is not connected. Connect Builder.io in Settings, or change the provider preference.",
      };
    }
    try {
      const cleaned = await withRequestContext(() =>
        cleanupWithBuilder({ text: original, instructions }),
      );
      return { text: cleaned || original };
    } catch (err) {
      setResponseStatus(event, 502);
      return {
        error: `Builder.io cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  if (providerPref === "gemini") {
    const geminiKey = await resolveApiKey("GEMINI_API_KEY");
    if (!geminiKey) {
      setResponseStatus(event, 400);
      return {
        error:
          "Gemini cleanup is selected but GEMINI_API_KEY is not configured.",
      };
    }
    try {
      const cleaned = await cleanupWithGemini({
        text: original,
        apiKey: geminiKey,
        instructions,
      });
      return { text: cleaned || original };
    } catch (err) {
      setResponseStatus(event, 502);
      return {
        error: `Gemini cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  if (providerPref === "openai" || providerPref === "groq") {
    const keyName =
      providerPref === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY";
    const apiKey = await resolveApiKey(keyName);
    if (!apiKey) {
      setResponseStatus(event, 400);
      return {
        error: `${providerPref} cleanup is selected but ${keyName} is not configured.`,
      };
    }
    try {
      const cleaned = await cleanupWithChatProvider({
        provider: providerPref,
        text: original,
        apiKey,
        instructions,
      });
      return { text: cleaned || original };
    } catch (err) {
      setResponseStatus(event, 502);
      return {
        error: `${providerPref} cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  if (await hasBuilderPrivateKey()) {
    try {
      const cleaned = await withRequestContext(() =>
        cleanupWithBuilder({ text: original, instructions }),
      );
      if (cleaned) return { text: cleaned };
    } catch {
      // Fall through to BYOK providers, then raw text.
    }
  }

  const geminiKey = await resolveApiKey("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      const cleaned = await cleanupWithGemini({
        text: original,
        apiKey: geminiKey,
        instructions,
      });
      if (cleaned) return { text: cleaned };
    } catch {
      // Fall through.
    }
  }

  const groqKey = await resolveApiKey("GROQ_API_KEY");
  if (groqKey) {
    try {
      const cleaned = await cleanupWithChatProvider({
        provider: "groq",
        text: original,
        apiKey: groqKey,
        instructions,
      });
      if (cleaned) return { text: cleaned };
    } catch {
      // Fall through.
    }
  }

  const openaiKey = await resolveApiKey("OPENAI_API_KEY");
  if (openaiKey) {
    try {
      const cleaned = await cleanupWithChatProvider({
        provider: "openai",
        text: original,
        apiKey: openaiKey,
        instructions,
      });
      if (cleaned) return { text: cleaned };
    } catch {
      // Fall through.
    }
  }

  return { text: original };
}

async function cleanupWithBuilder({
  text,
  instructions,
}: {
  text: string;
  instructions?: string;
}): Promise<string> {
  const engine = createBuilderEngine();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let streamedText = "";
  let finalText = "";
  let terminalError: string | undefined;
  try {
    for await (const event of engine.stream({
      model: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
      systemPrompt: buildCleanupSystemPrompt(instructions),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: buildCleanupUserPrompt(text) }],
        },
      ],
      tools: [],
      abortSignal: controller.signal,
      maxOutputTokens: Math.min(4096, Math.max(512, text.length * 2)),
      temperature: 0,
    })) {
      if (event.type === "text-delta") streamedText += event.text;
      if (event.type === "assistant-content") {
        finalText = event.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
      }
      if (event.type === "stop" && event.reason === "error") {
        terminalError = event.error ?? "Builder gateway returned an error";
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  if (terminalError) throw new Error(terminalError);
  return stripTranscriptEnvelope(finalText || streamedText);
}

async function cleanupWithGemini({
  text,
  apiKey,
  instructions,
}: {
  text: string;
  apiKey: string;
  instructions?: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
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
              { text: buildCleanupSystemPrompt(instructions) },
              { text: buildCleanupUserPrompt(text) },
            ],
          },
        ],
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
    const cleaned = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return stripTranscriptEnvelope(cleaned ?? "");
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanupWithChatProvider({
  provider,
  text,
  apiKey,
  instructions,
}: {
  provider: "openai" | "groq";
  text: string;
  apiKey: string;
  instructions?: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const endpoint = provider === "openai" ? OPENAI_CHAT_URL : GROQ_CHAT_URL;
  const model =
    provider === "openai" ? OPENAI_CLEANUP_MODEL : GROQ_CLEANUP_MODEL;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildCleanupSystemPrompt(instructions) },
          { role: "user", content: buildCleanupUserPrompt(text) },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${provider} ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return stripTranscriptEnvelope(
      data.choices?.[0]?.message?.content?.trim() ?? "",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function pickExtension(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) return "mp4";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  return "webm";
}

function sanitizeInstructions(value: string): string | undefined {
  const trimmed = value.replace(/\0/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 3000);
}

function sanitizeTranscriptText(value: string): string | undefined {
  const trimmed = value.replace(/\0/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_TRANSCRIPT_CHARS);
}

function buildCleanupSystemPrompt(instructions?: string): string {
  const custom = instructions
    ? `\n\nUser's custom cleanup instructions:\n${instructions}`
    : "";
  return `You clean up live speech-recognition transcripts before paste.

Rules:
- Preserve the speaker's meaning and voice.
- Fix obvious recognition mistakes, punctuation, capitalization, spacing, and casing.
- Remove false starts and filler only when they are clearly not intentional.
- Do not add facts, explanations, headings, bullets, quotes, or markdown.
- Output only the cleaned transcript text.${custom}`;
}

function buildCleanupUserPrompt(text: string): string {
  return `Clean up this transcript and return only the final text:\n\n<transcript>\n${text}\n</transcript>`;
}

function stripTranscriptEnvelope(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["“](.*)["”]$/s, "$1")
    .trim();
}

function buildGeminiTranscriptionPrompt({
  language,
  instructions,
}: {
  language?: string;
  instructions?: string;
}): string {
  const base = language
    ? `Transcribe the speech in this audio (language: ${language}).`
    : "Transcribe the speech in this audio.";
  const custom = instructions
    ? `\n\nAdditional user instructions for transcription cleanup:\n${instructions}\n\nApply these only to formatting, casing, punctuation, vocabulary, and cleanup. Do not add content that is not present in the audio.`
    : "";
  return `${base} Output only the transcript text — no preamble, no quotes, no formatting.${custom}`;
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
  instructions,
}: {
  audioBytes: Uint8Array;
  mimeType: string;
  apiKey: string;
  language?: string;
  instructions?: string;
}): Promise<string> {
  const base64 = uint8ArrayToBase64(audioBytes);
  const prompt = buildGeminiTranscriptionPrompt({ language, instructions });

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
