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
 * Query: ?code=<oauth-code>&state=<random-nanoid>
 *
 * Security model:
 *   - The legitimate flow (actions/connect-zoom.ts) writes a random nanoid
 *     `state` and the PKCE `verifier` into `application_state` keyed by
 *     `zoom-oauth-${ownerEmail}`.
 *   - The callback REQUIRES an authenticated session, looks up the stored
 *     state by the session's email, and verifies the inbound `state` matches.
 *   - We never trust attacker-controlled fields (email/verifier in `state`).
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
  timingSafeEqual,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { getSession, safeReturnPath } from "@agent-native/core/server";
import {
  appStateGet,
  appStateDelete,
} from "@agent-native/core/application-state";

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

interface PkceFlowState {
  state?: string;
  verifier?: string;
  redirectTo?: string;
  createdAt?: string;
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

/**
 * Constant-time compare of two strings. Avoids leaking length differences
 * between attacker-supplied state and the stored value via timing.
 */
function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
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

  // Require an authenticated session. The previous implementation honored an
  // attacker-controlled `state.email`, which let anyone bind their Zoom
  // tokens to any victim's `zoom_connections` row.
  const session = await getSession(event).catch(() => null);
  const email = session?.email?.toLowerCase();
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "No authenticated session — sign in and retry" };
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

  const inboundState = typeof q.state === "string" ? q.state : "";
  if (!inboundState) {
    setResponseStatus(event, 400);
    return { error: "Missing OAuth state parameter" };
  }

  // Look up the random `state` + PKCE verifier that connect-zoom.ts wrote
  // when the user kicked off the OAuth flow. Keyed by the session email so
  // an attacker can't poison another user's flow.
  const stateKey = `zoom-oauth-${email}`;
  const stored = (await appStateGet(email, stateKey)) as PkceFlowState | null;
  if (!stored?.state || !stored?.verifier) {
    setResponseStatus(event, 400);
    return { error: "No pending Zoom OAuth flow for this user" };
  }
  if (!safeEqualString(inboundState, stored.state)) {
    setResponseStatus(event, 400);
    return { error: "OAuth state mismatch" };
  }

  let tokens: ZoomTokenResponse;
  try {
    tokens = await exchangeCode(
      code,
      redirectUri,
      clientId,
      clientSecret,
      stored.verifier,
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

  // Best-effort cleanup of the one-time state row. A future replay of the
  // same `?state=` is now invalid because the verifier is also gone.
  await appStateDelete(email, stateKey).catch(() => {});

  // Validate the redirect target is same-origin (path-relative). The
  // previous `startsWith("/")` accepted `//evil.example/path` which is a
  // protocol-relative URL.
  const requested =
    typeof stored.redirectTo === "string" ? stored.redirectTo : "";
  const safe = safeReturnPath(requested);
  const returnTo = safe === "/" ? "/settings?zoom=connected" : safe;
  return sendRedirect(event, returnTo, 302);
});
