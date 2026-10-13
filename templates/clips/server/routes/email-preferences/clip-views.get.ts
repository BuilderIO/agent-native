import {
  getAppProductionUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import {
  defineEventHandler,
  getQuery,
  setResponseHeaders,
  setResponseStatus,
  type H3Event,
} from "h3";

import { CLIPS_USER_PREFS_KEY } from "../../../shared/clips-ai-prefs.js";
import { readClipsNotificationOptOutToken } from "../../lib/notification-preferences.js";

const INVALID_LINK_MESSAGE =
  "This Clips notification link is invalid or has expired.";

const PAGE_BACKGROUND = "#09090b"; // guard:allow-raw-color - standalone page has no app theme tokens
const PAGE_SURFACE = "#141417"; // guard:allow-raw-color - standalone page has no app theme tokens
const PAGE_BORDER = "#3f3f46"; // guard:allow-raw-color - standalone page has no app theme tokens
const PAGE_FOREGROUND = "#fafafa"; // guard:allow-raw-color - standalone page has no app theme tokens
const PAGE_MUTED = "#a1a1aa"; // guard:allow-raw-color - standalone page has no app theme tokens
const PAGE_ACCENT = "#48ffe4"; // guard:allow-raw-color - matches the Agent-Native brand mark

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appUrl(event: H3Event, path: string): string {
  return `${withConfiguredAppBasePath(getAppProductionUrl(event))}${path}`;
}

function htmlPage(
  title: string,
  message: string,
  settingsUrl: string,
  settingsLabel: string,
  logoUrl: string,
  status: "success" | "error",
): string {
  const statusSymbol = status === "success" ? "✓" : "!";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="${PAGE_BACKGROUND}">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background: ${PAGE_BACKGROUND};
        color: ${PAGE_FOREGROUND};
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .page { width: min(100%, 520px); }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 18px 8px;
        color: ${PAGE_FOREGROUND};
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .brand img { width: 28px; height: auto; display: block; }
      .card {
        padding: 32px;
        border: 1px solid ${PAGE_BORDER};
        border-radius: 24px;
        background: ${PAGE_SURFACE};
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.28); /* guard:allow-raw-color - standalone page shadow */
      }
      .status {
        display: grid;
        width: 44px;
        height: 44px;
        margin-bottom: 24px;
        place-items: center;
        border: 1px solid ${PAGE_ACCENT};
        border-radius: 14px;
        color: ${PAGE_ACCENT};
        font-size: 22px;
        line-height: 1;
      }
      .status-error { border-color: ${PAGE_BORDER}; color: ${PAGE_MUTED}; }
      h1 {
        max-width: 420px;
        margin: 0;
        font-size: 30px;
        font-weight: 650;
        line-height: 1.05;
      }
      p {
        max-width: 420px;
        margin: 18px 0 0;
        color: ${PAGE_MUTED};
        font-size: 16px;
        line-height: 1.6;
      }
      .button {
        display: block;
        margin-top: 28px;
        padding: 14px 18px;
        border-radius: 12px;
        background: ${PAGE_FOREGROUND};
        color: ${PAGE_BACKGROUND};
        font-size: 15px;
        font-weight: 650;
        line-height: 1.35;
        text-align: center;
        text-decoration: none;
        transition: opacity 160ms ease-out, transform 160ms ease-out;
      }
      .button:hover { opacity: 0.88; transform: translateY(-1px); }
      .button:focus-visible { outline: 2px solid ${PAGE_ACCENT}; outline-offset: 4px; }
      .note { margin-top: 18px; font-size: 13px; line-height: 1.5; }
      @media (max-width: 480px) {
        body { padding: 16px; }
        .card { padding: 24px; border-radius: 20px; }
        .brand { margin-left: 4px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .button { transition: none; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="brand">
        <img src="${escapeHtml(logoUrl)}" alt="" aria-hidden="true">
        <span>Agent-Native Clips</span>
      </div>
      <section class="card" aria-labelledby="page-title">
        <div class="status${status === "error" ? " status-error" : ""}" aria-hidden="true">${statusSymbol}</div>
        <h1 id="page-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        <a class="button" href="${escapeHtml(settingsUrl)}">${escapeHtml(settingsLabel)} <span aria-hidden="true">→</span></a>
        <p class="note">You can change your email preferences anytime.</p>
      </section>
    </main>
  </body>
</html>`;
}

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

  const query = getQuery(event);
  const token = typeof query.token === "string" ? query.token : null;
  const claims = readClipsNotificationOptOutToken(token, "views");
  const settingsUrl = appUrl(event, "/settings/notifications");
  const logoUrl = appUrl(event, "/agent-native-icon-dark.svg");
  if (!claims) {
    setResponseStatus(event, 400);
    return htmlPage(
      "Link not valid",
      INVALID_LINK_MESSAGE,
      settingsUrl,
      "Open notification settings",
      logoUrl,
      "error",
    );
  }

  await mutateUserSetting(claims.email, CLIPS_USER_PREFS_KEY, (current) => ({
    ...(current ?? {}),
    viewNotifications: false,
  }));

  return htmlPage(
    "Clip view emails are off",
    "You will no longer receive optional email notifications when someone views your Clips.",
    settingsUrl,
    "See or edit all notification settings",
    logoUrl,
    "success",
  );
});
