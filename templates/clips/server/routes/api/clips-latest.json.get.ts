import { defineEventHandler, setResponseHeaders, createError } from "h3";

/**
 * Same-origin proxy for the Tauri updater manifest hosted on the
 * `clips-latest` GitHub release. The browser can't hit the GitHub URL
 * directly — release assets don't include CORS headers, so a browser
 * `fetch()` to them fails silently. This route proxies the JSON from the
 * server so `/download` can show the right version + per-asset URLs.
 */
const UPSTREAM =
  "https://github.com/BuilderIO/agent-native/releases/download/clips-latest/clips-latest.json";

export default defineEventHandler(async (event) => {
  const res = await fetch(UPSTREAM, {
    redirect: "follow",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Upstream manifest fetch failed (${res.status})`,
    });
  }
  const body = await res.text();
  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return body;
});
