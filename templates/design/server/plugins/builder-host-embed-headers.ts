/**
 * `require-corp` would make the browser reject the containers this canvas frames,
 * and they cannot opt in via CORP. `frame-ancestors` replaces the embed token as
 * the limit on who may embed this route. A `response` hook, not middleware: core
 * sets its security headers from a plugin, which runs later.
 */
import { getRequestURL, type H3Event } from "h3";

import { SHELL_CANVAS_PATH } from "../../shared/shell-screens.js";

const BUILDER_FRAME_ANCESTORS = [
  "https://builder.io",
  "https://*.builder.io",
  "https://*.builder.my",
  "http://localhost:*",
  "http://127.0.0.1:*",
].join(" ");

export function isShellCanvasRequest(event: H3Event): boolean {
  try {
    return getRequestURL(event).pathname === SHELL_CANVAS_PATH;
    // coercion-ok: an unparseable URL is not the shell route.
  } catch {
    return false;
  }
}

export default (nitroApp: any): void => {
  nitroApp.hooks.hook("response", (res: Response, event: H3Event) => {
    if (!isShellCanvasRequest(event)) return;
    res.headers.set("Cross-Origin-Embedder-Policy", "unsafe-none");
    res.headers.set(
      "Content-Security-Policy",
      `frame-ancestors ${BUILDER_FRAME_ANCESTORS}`,
    );
  });
};
