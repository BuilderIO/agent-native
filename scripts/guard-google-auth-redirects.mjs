#!/usr/bin/env node
/**
 * guard-google-auth-redirects.mjs
 *
 * h3 v2's `sendRedirect` returns a non-standard response object. In the
 * framework request-handler shim that can be stringified into "[object Object]"
 * instead of becoming a real 302, which breaks popup Google OAuth flows.
 *
 * Google auth-url endpoints that support `?redirect=1` must return a native web
 * Response with a Location header instead.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\n")
  .filter(Boolean);

const SEND_REDIRECT_CALL = /\bsendRedirect\s*\(/;
const GOOGLE_AUTH_CONTEXT =
  /\bGOOGLE_[A-Z_]+\b|\/(?:api\/auth\/google|_agent-native\/google(?:[\/?-]|$))|oauth2\.googleapis\.com|Google (?:Calendar|Docs|OAuth)/;

const checked = [];
const violations = [];

for (const file of trackedFiles) {
  if (!/\.(?:[cm]?js|tsx?)$/.test(file)) continue;
  if (!existsSync(file)) continue;
  const contents = readFileSync(file, "utf8");
  const lines = contents.split("\n");
  const googleRedirectLines = lines.flatMap((line, index) => {
    if (!SEND_REDIRECT_CALL.test(line)) return [];
    const context = lines.slice(Math.max(0, index - 80), index + 81).join("\n");
    return GOOGLE_AUTH_CONTEXT.test(context) ? [index] : [];
  });
  if (googleRedirectLines.length > 0) {
    checked.push(file);
    violations.push(file);
    continue;
  }
  if (GOOGLE_AUTH_CONTEXT.test(contents)) checked.push(file);
}

if (violations.length > 0) {
  console.error(
    [
      "Google auth-url redirect handlers must not call h3 sendRedirect:",
      "",
      ...violations.map((file) => `  - ${file}`),
      "",
      "Use `return new Response(null, { status: 302, headers: { Location: url } })` for `?redirect=1` paths.",
      'Otherwise production OAuth popups can render "[object Object]" instead of redirecting.',
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `guard-google-auth-redirects: clean (${checked.length} Google auth source files checked).`,
);
