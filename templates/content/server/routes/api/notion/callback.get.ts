/**
 * Notion OAuth callback.
 *
 * Notion redirects here with `?code=...&state=...`. The `state` param is
 * an unsigned base64-JSON blob crafted by the call site (see
 * `../../lib/notion.ts:encodeState`). Trusting `state.redirectPath`
 * verbatim is an open-redirect primitive: an attacker can craft a state
 * blob that points the post-callback redirect at `//evil.example/phish`.
 *
 * To close that hole without depending on the lib's internal helpers (the
 * lib is in concurrent flight elsewhere), this handler:
 *
 *   1. Parses the state JSON exactly the way the lib does.
 *   2. Verifies an HMAC signature in `state.sig` against
 *      `BETTER_AUTH_SECRET` (or `AUTH_SECRET`). If absent or wrong, we
 *      ignore the carried `redirectPath` entirely.
 *   3. Even when the HMAC verifies, the resulting `redirectPath` is run
 *      through a same-origin path-only check (modeled on
 *      `safeReturnPath`) before being passed to `sendRedirect` — so a
 *      protocol-relative URL like `//host/evil` falls back to `/`.
 */
import crypto from "node:crypto";
import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
} from "h3";
import {
  exchangeNotionCodeForTokens,
  getDocumentOwnerEmail,
  saveNotionTokensForOwner,
} from "../../../lib/notion.js";

function decodeStateJson(stateParam: string | undefined): Record<string, any> {
  if (!stateParam) return {};
  try {
    return JSON.parse(Buffer.from(stateParam, "base64url").toString());
  } catch {
    return {};
  }
}

function getStateSecret(): string | null {
  return (
    process.env.NOTION_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    null
  );
}

function hmacSign(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

/**
 * Compute the HMAC over the state JSON's stable fields. We verify only the
 * `redirectPath` claim (the field we'd otherwise blindly trust) so legacy
 * state blobs without a `sig` simply fall back to `"/"` rather than
 * exploding the flow for already-issued OAuth links.
 */
function verifyStateSignature(
  state: Record<string, any>,
): { ok: boolean; redirectPath: string | null } {
  const secret = getStateSecret();
  if (!secret) {
    // Without a secret we cannot verify — refuse to honour any
    // attacker-controllable redirect path.
    return { ok: false, redirectPath: null };
  }
  const claimed =
    typeof state.redirectPath === "string" ? state.redirectPath : null;
  const sig = typeof state.sig === "string" ? state.sig : null;
  if (!claimed || !sig) return { ok: false, redirectPath: null };

  const message = `redirectPath:${claimed}`;
  const expected = hmacSign(message, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, redirectPath: null };
  }
  return { ok: true, redirectPath: claimed };
}

/**
 * Mirror of `safeReturnPath` from `@agent-native/core/server` — duplicated
 * here so this fix doesn't depend on a yet-unreleased core export. Rejects
 * absolute URLs, protocol-relative `//host` URLs, backslash bypasses, and
 * data:/javascript: schemes by parsing against a sentinel origin.
 */
function safeReturnPathLocal(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (/[\x00-\x1f]/.test(raw)) return "/";
  try {
    const parsed = new URL(raw, "http://safe-base.invalid");
    if (parsed.origin !== "http://safe-base.invalid") return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code as string | undefined;
  const error = query.error as string | undefined;
  const stateParam = query.state as string | undefined;

  if (error) {
    setResponseStatus(event, 400);
    return { error };
  }

  if (!code) {
    setResponseStatus(event, 400);
    return { error: "Missing authorization code" };
  }

  const owner = await getDocumentOwnerEmail(event);
  const tokens = await exchangeNotionCodeForTokens(event, code);
  await saveNotionTokensForOwner(owner, tokens);

  // Decide where to redirect AFTER the token swap. Default to `/` on any
  // signature failure so a forged state never produces an open redirect.
  const state = decodeStateJson(stateParam);
  const verified = verifyStateSignature(state);
  const target = verified.ok
    ? safeReturnPathLocal(verified.redirectPath)
    : "/";
  return sendRedirect(event, target, 302);
});
