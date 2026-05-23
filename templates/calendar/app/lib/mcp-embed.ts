/**
 * MCP embed surface detection for Calendar.
 *
 * When the Calendar UI is rendered inside an MCP host's iframe (ChatGPT /
 * Claude.ai render `*.agent-native.com` through their own sandboxed wrapper
 * with strict COEP/CORP headers), cross-origin third-party images
 * (`googleusercontent.com` avatars, etc.) get blocked at the browser level
 * and produce noisy console errors. Templates that ship images that work
 * fine in their own UI need to gate them on this flag and fall back to
 * a same-origin placeholder when embedded.
 *
 * Mirrors `templates/mail/app/lib/mcp-embed.ts` (added in PR #883). A future
 * refactor could lift this to `@agent-native/core/client` so every template
 * uses one helper — for now keep it template-local to match the Mail PR.
 */
export function isMcpEmbedSurface(): boolean {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get("embedded");
  return value === "1" || value === "true";
}
