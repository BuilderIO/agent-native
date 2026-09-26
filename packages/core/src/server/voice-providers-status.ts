import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import {
  prefetchSecrets,
  resolveHasCompleteBuilderConnection,
  resolveSecret,
} from "./credential-provider.js";
import { resolveGoogleRealtimeCredentials } from "./google-realtime-session.js";
import { runWithRequestContext } from "./request-context.js";

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
  browser: true;
  native: true;
}

export function createVoiceProvidersStatusHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "GET") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const session = await getSession(event).catch(() => null);
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

    async function hasKey(key: string): Promise<boolean> {
      try {
        if (key === "GOOGLE_APPLICATION_CREDENTIALS") {
          const resolved = await withRequestContext(() =>
            resolveGoogleRealtimeCredentials({
              userEmail: session?.email,
              orgId: orgCtx?.orgId ?? undefined,
            }),
          );
          return typeof resolved === "string" && resolved.length > 0;
        }
        const resolved = await withRequestContext(() => resolveSecret(key));
        return typeof resolved === "string" && resolved.length > 0;
      } catch {
        return false;
      }
    }

    // One read per scope for every key below, instead of one per key per scope.
    await withRequestContext(() =>
      prefetchSecrets([
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "GROQ_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ]),
    );

    let builder = false;
    try {
      builder =
        (await withRequestContext(() =>
          resolveHasCompleteBuilderConnection(),
        )) === true;
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
