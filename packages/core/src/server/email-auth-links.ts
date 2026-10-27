import { randomBytes } from "node:crypto";

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
          callback.origin === url.origin &&
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
    url.pathname = publicFrameworkPath(
      `${pathname.slice(0, markerIndex)}${EMAIL_AUTH_LINK_LANDING_PATH}`,
    );
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

const EMAIL_AUTH_LINK_LANDING_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    --auth-canvas: #0a0a0a; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-card: #141414; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-border: rgba(255, 255, 255, 0.08); /* guard:allow-raw-color - match the standalone auth palette */
    --auth-foreground: #e5e5e5; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-heading: #fff; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-muted: #888; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-primary: #fff; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-primary-foreground: #000; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-primary-hover: #e5e5e5; /* guard:allow-raw-color - match the standalone auth palette */
    --auth-focus: #33c4ff; /* guard:allow-raw-color - match the standalone auth palette */
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-height: 100svh;
    margin: 0;
    padding: 1rem;
    background: var(--auth-canvas);
    color: var(--auth-foreground);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .auth-card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: var(--auth-card);
    border: 1px solid var(--auth-border);
    border-radius: 12px;
  }
  h1 {
    margin: 0 0 0.25rem;
    color: var(--auth-heading);
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.5;
  }
  p {
    margin: 0 0 1.5rem;
    color: var(--auth-muted);
    font-size: 0.8125rem;
    line-height: 1.5;
  }
  form { margin: 0; }
  button {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.625rem 0.75rem;
    background: var(--auth-primary);
    color: var(--auth-primary-foreground);
    border: 0;
    border-radius: 6px;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  button:hover { background: var(--auth-primary-hover); }
  button:focus-visible {
    outline: 2px solid var(--auth-focus);
    outline-offset: 2px;
  }
  @media (max-width: 420px) {
    .auth-card { padding: 1.5rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    button { transition: none; }
  }
`;

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
  // A nonce keeps the standalone page styled without allowing arbitrary inline CSS.
  const styleNonce = randomBytes(16).toString("base64");
  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${direction}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(copy.title)}</title>
    <style nonce="${styleNonce}">${EMAIL_AUTH_LINK_LANDING_STYLES}</style>
  </head>
  <body>
    <main class="auth-card">
      <h1>${escapeHtml(copy.title)}</h1>
      <p>${escapeHtml(copy.message)}</p>
      <form method="post" action="${escapeHtml(actionUrl)}" autocomplete="off">
        ${hiddenInputs}
        <button type="submit">${escapeHtml(copy.action)}</button>
      </form>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; style-src 'nonce-${styleNonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}
