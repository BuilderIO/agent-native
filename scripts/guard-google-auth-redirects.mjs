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
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const GOOGLE_AUTH_URL_FILE_PATTERNS = [
  /^packages\/core\/src\/server\/auth\.ts$/,
  /^templates\/[^/]+\/server\/handlers\/google-auth\.ts$/,
  /^templates\/[^/]+\/server\/routes\/(?:\[[^\]]+\]\/)?_agent-native\/google\/(?:add-account\/)?auth-url\.get\.ts$/,
];

const SEND_REDIRECT_CALL = /\bsendRedirect\s*\(/;

const checked = [];
const violations = [];

for (const file of trackedFiles) {
  if (!GOOGLE_AUTH_URL_FILE_PATTERNS.some((pattern) => pattern.test(file))) {
    continue;
  }

  checked.push(file);
  const contents = readFileSync(file, "utf8");
  if (SEND_REDIRECT_CALL.test(contents)) {
    violations.push(file);
  }
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
  `guard-google-auth-redirects: clean (${checked.length} auth-url files checked).`,
);
