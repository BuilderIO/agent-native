/**
 * GET /_agent-native/voice-providers/status
 *
 * Reports which voice transcription providers are configured for the
 * current user. The desktop Settings UI uses this to show "Connect" vs
 * "Connected" status pills next to each provider option.
 *
 * Resolution mirrors `transcribe-voice.ts`: we try the user-scoped
 * encrypted secret first (set via the sidebar settings UI) and fall back
 * to `resolveCredential()` (env var + SQL settings store). Each lookup is
 * wrapped in try/catch — one provider's failure must never break the
 * whole response.
 *
 * Returns booleans only — never the actual key material.
 */
import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readAppSecret } from "../secrets/storage.js";
import { resolveCredential } from "../credentials/index.js";
import { getSession } from "./auth.js";
import { resolveHasBuilderPrivateKey } from "./credential-provider.js";
import { getOrgContext } from "../org/context.js";
import { runWithRequestContext } from "./request-context.js";
import { resolveGoogleRealtimeCredentials } from "./google-realtime-session.js";

export interface VoiceProvidersStatus {
  builder: boolean;
  gemini: boolean;
  openai: boolean;
  groq: boolean;
  /**
   * Google Speech-to-Text realtime streaming is BYOK-only for v1. This reports
   * whether a service-account credential is configured; the actual stream runs
   * through the dedicated WebSocket -> StreamingRecognize path, not the batch
   * transcribe route.
   */
  googleRealtime: boolean;
  /** Always true — the Web Speech API is available in WebKit-based clients. */
  browser: true;
  /**
   * Apple's SFSpeechRecognizer + AVAudioEngine, exposed by the Tauri
   * desktop client. Always reported as `true` from the server — the
   * desktop client gates this on macOS at the Tauri-command boundary, so
   * non-macOS hosts return a clear error instead of attempting to use it.
   */
  native: true;
}

export function createVoiceProvidersStatusHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const session = await getSession(event).catch(() => null);

    async function hasKey(key: string): Promise<boolean> {
      try {
        if (key === "GOOGLE_APPLICATION_CREDENTIALS") {
          const orgCtx = session?.email
            ? await getOrgContext(event).catch(() => null)
            : null;
          const resolved = await resolveGoogleRealtimeCredentials({
            userEmail: session?.email,
            orgId: orgCtx?.orgId ?? undefined,
          });
          return typeof resolved === "string" && resolved.length > 0;
        }
        const ctx = { userEmail: session?.email };
        if (!session?.email) {
          const v = await resolveCredential(key, ctx);
          return typeof v === "string" && v.length > 0;
        }
        const userSecret = await readAppSecret({
          key,
          scope: "user",
          scopeId: session.email,
        }).catch(() => null);
        if (userSecret?.value && userSecret.value.length > 0) return true;
        const fallback = await resolveCredential(key, ctx);
        return typeof fallback === "string" && fallback.length > 0;
      } catch {
        return false;
      }
    }

    let builder = false;
    try {
      const orgCtx = session?.email
        ? await getOrgContext(event).catch(() => null)
        : null;
      const resolve = () => resolveHasBuilderPrivateKey();
      builder =
        (session?.email
          ? await runWithRequestContext(
              {
                userEmail: session.email,
                orgId: orgCtx?.orgId ?? undefined,
              },
              resolve,
            )
          : await resolve()) === true;
    } catch {
      builder = false;
    }

    const [gemini, openai, groq, googleRealtime] = await Promise.all([
      hasKey("GEMINI_API_KEY"),
      hasKey("OPENAI_API_KEY"),
      hasKey("GROQ_API_KEY"),
      hasKey("GOOGLE_APPLICATION_CREDENTIALS"),
    ]);

    const status: VoiceProvidersStatus = {
      builder,
      gemini,
      openai,
      groq,
      googleRealtime,
      browser: true,
      native: true,
    };
    return status;
  });
}
