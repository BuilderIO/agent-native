import { createHmac } from "node:crypto";

import { CompactEncrypt, compactDecrypt } from "jose";

import { getAuthSecret } from "../server/better-auth-instance.js";

const HANDLE_VERSION = 1;
const HANDLE_TTL_SECONDS = 60 * 60;
const INVALID_HANDLE_ERROR = "Invalid or expired ask_app task handle.";

export interface AskAppTaskHandleRoute {
  app: string;
  origin: string;
  routedVia: "local" | "a2a";
  requestOrigin?: string;
}

interface AskAppTaskHandleClaims {
  version: number;
  issuerApp: string;
  subject: string;
  route: AskAppTaskHandleRoute;
  taskId: string;
  expiresAt: number;
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function rootSecrets(): string[] {
  const a2a = process.env.A2A_SECRET?.trim();
  const auth = getAuthSecret();
  return [...new Set([a2a, auth].filter((value): value is string => !!value))];
}

function handleKey(rootSecret: string): Uint8Array {
  return createHmac("sha256", rootSecret)
    .update("agent-native:ask-app-task-handle:v1")
    .digest();
}

function validHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function validRoute(value: unknown): value is AskAppTaskHandleRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<AskAppTaskHandleRoute>;
  if (typeof route.app !== "string" || !route.app.trim()) return false;
  if (route.routedVia !== "local" && route.routedVia !== "a2a") return false;
  if (typeof route.origin !== "string") return false;
  const endpoint = validHttpUrl(route.origin);
  if (!endpoint) return false;
  if (route.requestOrigin == null) return true;
  if (typeof route.requestOrigin !== "string") return false;
  const requestOrigin = validHttpUrl(route.requestOrigin);
  return requestOrigin?.origin === endpoint.origin;
}

function invalidHandle(): Error {
  return new Error(INVALID_HANDLE_ERROR);
}

export async function signAskAppTaskHandle(params: {
  issuerApp: string;
  subject: string;
  route: AskAppTaskHandleRoute;
  taskId: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const issuerApp = normalizedIdentity(params.issuerApp);
  const subject = normalizedIdentity(params.subject);
  const taskId = params.taskId.trim();
  if (!issuerApp || !subject || !taskId || !validRoute(params.route)) {
    throw invalidHandle();
  }

  const claims: AskAppTaskHandleClaims = {
    version: HANDLE_VERSION,
    issuerApp,
    subject,
    route: {
      ...params.route,
      app: normalizedIdentity(params.route.app),
    },
    taskId,
    expiresAt:
      Math.floor(Date.now() / 1000) +
      (params.expiresInSeconds ?? HANDLE_TTL_SECONDS),
  };
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  return new CompactEncrypt(payload)
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: "agent-native-ask-app-task-handle",
    })
    .encrypt(handleKey(rootSecrets()[0]));
}

export async function verifyAskAppTaskHandle(
  handle: string,
  expected: { issuerApp: string; subject: string },
): Promise<{ route: AskAppTaskHandleRoute; taskId: string }> {
  const issuerApp = normalizedIdentity(expected.issuerApp);
  const subject = normalizedIdentity(expected.subject);
  if (!handle.trim() || !issuerApp || !subject) throw invalidHandle();

  for (const rootSecret of rootSecrets()) {
    try {
      const { plaintext, protectedHeader } = await compactDecrypt(
        handle,
        handleKey(rootSecret),
      );
      if (
        protectedHeader.alg !== "dir" ||
        protectedHeader.enc !== "A256GCM" ||
        protectedHeader.typ !== "agent-native-ask-app-task-handle"
      ) {
        continue;
      }
      const claims = JSON.parse(
        new TextDecoder().decode(plaintext),
      ) as Partial<AskAppTaskHandleClaims>;
      if (
        claims.version !== HANDLE_VERSION ||
        claims.issuerApp !== issuerApp ||
        claims.subject !== subject ||
        typeof claims.taskId !== "string" ||
        !claims.taskId ||
        typeof claims.expiresAt !== "number" ||
        claims.expiresAt <= Math.floor(Date.now() / 1000) ||
        !validRoute(claims.route)
      ) {
        continue;
      }
      return { route: claims.route, taskId: claims.taskId };
    } catch {
      // All handle failures are deliberately indistinguishable to callers.
    }
  }
  throw invalidHandle();
}
