import { readFile } from "node:fs/promises";

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { resolveCredential } from "../credentials/index.js";
import { getOrgContext } from "../org/context.js";
import { readAppSecret } from "../secrets/storage.js";
import { getSession } from "./auth.js";
import { resolveBuilderCredentials } from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";

interface GoogleRealtimeSessionResponse {
  websocketUrl: string;
  sessionToken: string;
  websocketProtocol?: string;
}

export async function resolveGoogleRealtimeCredentials(opts: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<string | null> {
  const secretRefs: Array<{
    scope: "user" | "org" | "workspace";
    scopeId: string;
  }> = [];
  if (opts.userEmail) {
    secretRefs.push({ scope: "user", scopeId: opts.userEmail });
    if (opts.orgId) {
      secretRefs.push(
        { scope: "org", scopeId: opts.orgId },
        { scope: "workspace", scopeId: opts.orgId },
      );
    } else {
      secretRefs.push({
        scope: "workspace",
        scopeId: `solo:${opts.userEmail}`,
      });
    }
  }

  for (const ref of secretRefs) {
    const secret = await readAppSecret({
      key: "GOOGLE_APPLICATION_CREDENTIALS",
      scope: ref.scope,
      scopeId: ref.scopeId,
    }).catch(() => null);
    const fromSecret = secret?.value?.trim();
    if (fromSecret) return fromSecret;
  }

  const stored = opts.userEmail
    ? await resolveCredential("GOOGLE_APPLICATION_CREDENTIALS", {
        userEmail: opts.userEmail,
        orgId: opts.orgId ?? undefined,
      }).catch(() => undefined)
    : undefined;
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

      const apiHost = process.env.BUILDER_API_HOST || "https://api.builder.io";
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
