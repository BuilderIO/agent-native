/**
 * Zoom OAuth callback. Exchanges `?code` for access + refresh tokens, stores
 * them (encrypted when possible) in `zoom_connections`, and redirects back
 * to /settings.
 *
 * Env:
 *   ZOOM_CLIENT_ID        — required to exchange the code
 *   ZOOM_CLIENT_SECRET    — required
 *   ZOOM_REDIRECT_URI     — must match the redirect registered with Zoom
 *   AUTH_SECRET           — used to derive an encryption key. If unset we fall
 *                           back to plaintext with a console warning.
 *
 * Query: ?code=<oauth-code>&state=<b64url-json>
 *
 * State is a base64url-encoded JSON blob of at least:
 *   { email, verifier? }
 * where `verifier` is the PKCE code_verifier (if we used PKCE). If state is
 * missing or can't be parsed we fall back to the current session email.
 *
 * Route: GET /api/oauth/zoom/callback
 */

import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { getSession } from "@agent-native/core/server";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";

interface ZoomTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface PkceState {
  email?: string;
  verifier?: string;
  returnTo?: string;
}

function decodeState(raw: string | undefined): PkceState {
  if (!raw || typeof raw !== "string") return {};
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const json = Buffer.from(normalized + pad, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function deriveKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function encryptValue(plaintext: string): string {
  const key = deriveKey();
  if (!key) {
    console.warn(
      "[calls] AUTH_SECRET not set — storing Zoom tokens in plaintext",
    );
    return `plain:${plaintext}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

// Exposed as an unused helper so the symmetric decrypt path lives in one
// place if a future server route needs it. Keeps the shape self-documenting.
export function decryptValue(encrypted: string): string | null {
  if (encrypted.startsWith("plain:")) return encrypted.slice("plain:".length);
  if (!encrypted.startsWith("v1:")) return null;
  const key = deriveKey();
  if (!key) return null;
  const [, ivHex, ctHex, tagHex] = encrypted.split(":");
  if (!ivHex || !ctHex || !tagHex) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctHex, "hex")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  verifier: string | undefined,
): Promise<ZoomTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  if (verifier) body.set("code_verifier", verifier);

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as ZoomTokenResponse;
  if (!res.ok) {
    throw new Error(
      `Zoom token exchange failed: ${res.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim(),
    );
  }
  return json;
}

export default defineEventHandler(async (event: H3Event) => {
  const q = getQuery(event) as {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };

  if (q.error) {
    setResponseStatus(event, 400);
    return {
      error: q.error,
      description: q.error_description,
    };
  }

  const code = q.code;
  if (!code) {
    setResponseStatus(event, 400);
    return { error: "Missing authorization code" };
  }

  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const redirectUri = process.env.ZOOM_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    setResponseStatus(event, 501);
    return {
      error: "Zoom is not configured",
      hint: "Set ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_REDIRECT_URI.",
    };
  }

  const state = decodeState(q.state);
  const session = await getSession(event).catch(() => null);
  const email = (state.email || session?.email || "").toLowerCase();
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "No authenticated session — cannot attach Zoom tokens" };
  }

  let tokens: ZoomTokenResponse;
  try {
    tokens = await exchangeCode(
      code,
      redirectUri,
      clientId,
      clientSecret,
      state.verifier,
    );
  } catch (err) {
    console.error("[calls] Zoom OAuth exchange failed:", err);
    setResponseStatus(event, 502);
    return {
      error: err instanceof Error ? err.message : "Zoom token exchange failed",
    };
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    setResponseStatus(event, 502);
    return { error: "Zoom did not return tokens" };
  }

  const expiresAt = new Date(
    Date.now() + Math.max(60, Number(tokens.expires_in ?? 3600)) * 1000,
  ).toISOString();
  const now = new Date().toISOString();
  const accessEncrypted = encryptValue(tokens.access_token);
  const refreshEncrypted = encryptValue(tokens.refresh_token);

  const db = getDb();
  const [existing] = await db
    .select({ email: schema.zoomConnections.email })
    .from(schema.zoomConnections)
    .where(eq(schema.zoomConnections.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(schema.zoomConnections)
      .set({
        accessTokenEncrypted: accessEncrypted,
        refreshTokenEncrypted: refreshEncrypted,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(schema.zoomConnections.email, email));
  } else {
    await db.insert(schema.zoomConnections).values({
      email,
      accessTokenEncrypted: accessEncrypted,
      refreshTokenEncrypted: refreshEncrypted,
      expiresAt,
      autoImport: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const returnTo =
    typeof state.returnTo === "string" && state.returnTo.startsWith("/")
      ? state.returnTo
      : "/settings?zoom=connected";
  return sendRedirect(event, returnTo, 302);
});
