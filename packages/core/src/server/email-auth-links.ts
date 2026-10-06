import {
  canonicalFrameworkPathname,
  publicFrameworkPath,
} from "./framework-route-prefix.js";

export const EMAIL_AUTH_LINK_LANDING_PATH =
  "/_agent-native/auth/email-link/landing";

const BETTER_AUTH_MAGIC_LINK_VERIFY_PATH =
  "/_agent-native/auth/ba/magic-link/verify";
const BETTER_AUTH_VERIFY_EMAIL_PATH = "/_agent-native/auth/ba/verify-email";
const DESKTOP_MAGIC_LINK_CALLBACK_PATH =
  "/_agent-native/auth/magic-link/desktop-callback";
const EMAIL_AUTH_LINK_CALLBACK_KEYS = [
  "callbackURL",
  "newUserCallbackURL",
  "errorCallbackURL",
] as const;

export type EmailAuthLinkKind = "magic-link" | "verify-email";

export function emailAuthVerificationPath(kind: unknown): string | undefined {
  if (kind === "magic-link") return BETTER_AUTH_MAGIC_LINK_VERIFY_PATH;
  if (kind === "verify-email") return BETTER_AUTH_VERIFY_EMAIL_PATH;
  return undefined;
}

export function emailAuthLinkLandingUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const pathname = canonicalFrameworkPathname(url.pathname);
    const kind = pathname.endsWith(BETTER_AUTH_MAGIC_LINK_VERIFY_PATH)
      ? "magic-link"
      : pathname.endsWith(BETTER_AUTH_VERIFY_EMAIL_PATH)
        ? "verify-email"
        : undefined;
    const marker =
      kind === "magic-link"
        ? BETTER_AUTH_MAGIC_LINK_VERIFY_PATH
        : kind === "verify-email"
          ? BETTER_AUTH_VERIFY_EMAIL_PATH
          : undefined;
    if (!kind || !marker || !url.searchParams.get("token")) return undefined;

    if (kind === "magic-link") {
      const callbackURL = url.searchParams.get("callbackURL");
      if (callbackURL) {
        const callback = new URL(callbackURL, url.origin);
        if (
          callback.origin !== url.origin ||
          canonicalFrameworkPathname(callback.pathname).endsWith(
            DESKTOP_MAGIC_LINK_CALLBACK_PATH,
          )
        ) {
          return undefined;
        }
      }
    }

    const markerIndex = pathname.lastIndexOf(marker);
    if (markerIndex < 0 || markerIndex + marker.length !== pathname.length) {
      return undefined;
    }
    url.pathname = `${pathname.slice(0, markerIndex)}${publicFrameworkPath(EMAIL_AUTH_LINK_LANDING_PATH)}`;
    url.searchParams.set("kind", kind);
    return url.toString();
  } catch {
    // coercion-ok: malformed provider URLs are returned unchanged by the caller.
    return undefined;
  }
}

export function emailAuthLinkFields(
  values: Record<string, unknown>,
): Record<string, string> | undefined {
  const kind = values.kind;
  if (kind !== "magic-link" && kind !== "verify-email") return undefined;
  const token = typeof values.token === "string" ? values.token.trim() : "";
  if (!token) return undefined;

  const fields: Record<string, string> = { kind, token };
  for (const key of EMAIL_AUTH_LINK_CALLBACK_KEYS) {
    const value = values[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return undefined;
    fields[key] = value;
  }
  return fields;
}

export function emailAuthVerificationUrl(
  baseUrl: string,
  values: Record<string, unknown>,
): URL | undefined {
  const fields = emailAuthLinkFields(values);
  if (!fields) return undefined;

  try {
    const verificationURL = new URL(baseUrl);
    for (const key of EMAIL_AUTH_LINK_CALLBACK_KEYS) {
      const callback = fields[key];
      if (!callback) continue;
      if (
        new URL(callback, verificationURL.origin).origin !==
        verificationURL.origin
      ) {
        return undefined;
      }
      verificationURL.searchParams.set(key, callback);
    }
    verificationURL.searchParams.set("token", fields.token);
    return verificationURL;
  } catch {
    // coercion-ok: malformed verification URLs are rejected by the landing route.
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function emailAuthLinkLandingPage(
  actionUrl: string,
  fields: Record<string, string>,
  copy: {
    title: string;
    message: string;
    action: string;
  },
  locale: string,
  direction: "ltr" | "rtl",
): Response {
  const hiddenInputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const html = `<!DOCTYPE html><html lang="${escapeHtml(locale)}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title></head><body><main><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.message)}</p><form method="post" action="${escapeHtml(actionUrl)}" autocomplete="off">${hiddenInputs}<button type="submit">${escapeHtml(copy.action)}</button></form></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}
