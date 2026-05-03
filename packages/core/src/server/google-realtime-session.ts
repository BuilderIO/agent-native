import { readFile } from "node:fs/promises";
import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readAppSecret } from "../secrets/storage.js";
import { resolveCredential } from "../credentials/index.js";
import { getSession } from "./auth.js";
import { getOrgContext } from "../org/context.js";
import { runWithRequestContext } from "./request-context.js";
import { resolveBuilderCredentials } from "./credential-provider.js";

interface GoogleRealtimeSessionResponse {
  websocketUrl: string;
  sessionToken: string;
  websocketProtocol?: string;
}

function isSameOriginRequest(event: H3Event): boolean {
  const host = getRequestHeader(event, "host");
  const origin = getRequestHeader(event, "origin");
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      if (parsed.host === host) return true;
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
  return true;
}

export async function resolveGoogleRealtimeCredentials(opts: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<string | null> {
  if (opts.userEmail) {
    const userSecret = await readAppSecret({
      key: "GOOGLE_APPLICATION_CREDENTIALS",
      scope: "user",
      scopeId: opts.userEmail,
    }).catch(() => null);
    const fromUserSecret = userSecret?.value?.trim();
    if (fromUserSecret) return fromUserSecret;
  }

  const stored = await resolveCredential("GOOGLE_APPLICATION_CREDENTIALS", {
    userEmail: opts.userEmail ?? undefined,
    orgId: opts.orgId ?? undefined,
  }).catch(() => undefined);
  const fromSettings = stored?.trim();
  if (fromSettings) return fromSettings;

  const envValue = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!envValue) return null;
  if (envValue.startsWith("{")) return envValue;

  try {
    const fileContents = await readFile(envValue, "utf8");
    const trimmed = fileContents.trim();
    return trimmed || null;
  } catch {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS points to a file path the framework server could not read",
    );
  }
}

export function createGoogleRealtimeSessionHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    if (!isSameOriginRequest(event)) {
      setResponseStatus(event, 403);
      return { error: "Cross-origin request rejected" };
    }

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    const orgCtx = await getOrgContext(event).catch(() => null);
    const requestContext = {
      userEmail: session.email,
      orgId: orgCtx?.orgId ?? undefined,
    };

    return runWithRequestContext(requestContext, async () => {
      const googleApplicationCredentials =
        await resolveGoogleRealtimeCredentials({
          userEmail: session.email,
          orgId: orgCtx?.orgId ?? undefined,
        });
      if (!googleApplicationCredentials) {
        setResponseStatus(event, 400);
        return {
          error:
            "Configure GOOGLE_APPLICATION_CREDENTIALS in Settings to use Google realtime transcription.",
        };
      }

      const builderCreds = await resolveBuilderCredentials();
      if (!builderCreds.privateKey || !builderCreds.publicKey) {
        setResponseStatus(event, 400);
        return {
          error:
            "Builder must be connected to mint a managed realtime transcription session.",
        };
      }

      const apiHost =
        process.env.BUILDER_API_HOST || "https://ai-services.builder.io";
      const body = ((await readBody(event).catch(() => ({}))) || {}) as {
        language?: unknown;
      };
      const res = await fetch(
        `${apiHost}/agent-native/transcribe-stream/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${builderCreds.privateKey}`,
            "x-builder-api-key": builderCreds.publicKey,
            ...(builderCreds.userId
              ? { "x-builder-user-id": builderCreds.userId }
              : {}),
          },
          body: JSON.stringify({
            googleApplicationCredentials,
            language:
              typeof body?.language === "string"
                ? body.language.trim()
                : undefined,
          }),
        },
      ).catch((err: any) => {
        throw new Error(
          err?.message || "Failed to reach realtime transcription service",
        );
      });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        setResponseStatus(event, res.status);
        return {
          error:
            typeof errorBody?.error === "string"
              ? errorBody.error
              : `Realtime session failed (${res.status})`,
        };
      }

      const payload = (await res.json()) as GoogleRealtimeSessionResponse;
      if (!payload?.websocketUrl) {
        setResponseStatus(event, 502);
        return {
          error:
            "Realtime transcription service did not return a websocket URL.",
        };
      }
      return payload;
    });
  });
}
