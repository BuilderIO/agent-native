#!/usr/bin/env node
/**
 * guard-serverless-function-payload.mjs
 *
 * Everything the deploy build copies into the serverless server directory is
 * paid by EVERY emitted function, including the page-render one, on every cold
 * start — Netlify clones that directory once per function, so the weight is
 * multiplied, not shared.
 *
 * This is not hypothetical. PR #2684 ("Harden auth and cold-start data paths")
 * added two package names to a copy list and one unconditional call:
 *
 *   const SERVERLESS_BROWSER_RUNTIME_PACKAGES = [
 *     "@sparticuz/chromium",
 *     "playwright-core",
 *   ] as const;
 *   ...
 *   copyInstalledBrowserRuntimePackages(nitro.options.output.serverDir);
 *
 * ~10 lines, in a diff about auth. It put 78MB of headless Chromium into the
 * page function of every app in the fleet — the docs function went 59.8MB ->
 * 159.9MB — and agent-native.com cache-miss TTFB measured 4.15-6.03s. Nothing
 * in review connected that diff to that number, because nothing pointed at it.
 * The build-time size report only fires when an app is actually built for a
 * serverless preset, which is deploy time, not PR time.
 *
 * So this guard pins the payload surface itself:
 *
 *   1. Which `copyInstalled*` helpers the deploy build calls at all.
 *   2. Which packages `SERVERLESS_BROWSER_RUNTIME_PACKAGES` names.
 *   3. That `copyInstalledBrowserRuntimePackages` still asks
 *      `findServerlessBrowserRuntimeConsumer` whether THIS app wants a browser.
 *      That gate is the whole fix: package resolution cannot answer it, because
 *      in a workspace every app "resolves" a sibling's Chromium.
 *
 * Scope is deliberately one directory, not a repo-wide grep for "chromium".
 * Measured before writing: `copyInstalled*(` has exactly 4 call sites in the
 * whole tree outside specs, all in packages/core/src/deploy/build.ts. A wider
 * matcher would fire on unrelated code and be disabled inside a week.
 *
 * Opt-out, when the added weight is deliberate and measured:
 *
 *   // guard:allow-serverless-function-payload — +Xmb, why every function needs it
 *
 * Read .agents/skills/performance/SKILL.md section 9 ("Cold start is the
 * artifact, not just the work it does") before reaching for it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const BUILD_FILE = "packages/core/src/deploy/build.ts";
const SKILL_REF = ".agents/skills/performance/SKILL.md section 9";
const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-serverless-function-payload\b/;

/**
 * What the serverless output is allowed to carry today. Small, pre-existing,
 * and each already pruned to linux-x64/arm64 or gated on the consuming app.
 */
const ALLOWED_COPY_CALLS = new Set([
  "copyInstalledLibsqlNativePackages",
  "copyInstalledResvgPackages",
  "copyInstalledFfmpegStaticPackage",
  "copyInstalledBrowserRuntimePackages",
]);

/** The browser runtime, ~78MB, gated on findServerlessBrowserRuntimeConsumer. */
const ALLOWED_BROWSER_PACKAGES = new Set([
  "@sparticuz/chromium",
  "playwright-core",
]);

const GATED_COPY_CALL = "copyInstalledBrowserRuntimePackages";
const REQUIRED_GATE = "findServerlessBrowserRuntimeConsumer";
const BROWSER_PACKAGE_LIST = "SERVERLESS_BROWSER_RUNTIME_PACKAGES";

const absoluteBuildFile = path.join(REPO_ROOT, BUILD_FILE);
let lines;
try {
  lines = readFileSync(absoluteBuildFile, "utf8").split("\n");
} catch (error) {
  // Not a pass. The one file this guard exists to watch is gone or moved, so
  // nothing was checked and saying "OK" here would be a lie.
  console.error(
    `guard-serverless-function-payload: cannot read ${BUILD_FILE} (${error.code ?? error.message}).`,
  );
  console.error(
    "  NOTHING WAS CHECKED. If the deploy build moved, point this guard at its new home.",
  );
  process.exit(1);
}

const allowed = (index) =>
  PRAGMA.test(lines[index] ?? "") || PRAGMA.test(lines[index - 1] ?? "");

const violations = [];

// 1. Copy calls. Declarations are not call sites.
const CALL_SITE = /(?<!function\s)\bcopy(Installed\w+)\s*\(/;
for (const [index, line] of lines.entries()) {
  const match = CALL_SITE.exec(line);
  if (!match) continue;
  const name = `copy${match[1]}`;
  if (ALLOWED_COPY_CALLS.has(name) || allowed(index)) continue;
  violations.push({
    line: index + 1,
    what: `${name}() copies a new package tree into every serverless function`,
  });
}

// 2. Contents of the browser runtime package list.
const listStart = lines.findIndex((line) =>
  new RegExp(`\\bconst\\s+${BROWSER_PACKAGE_LIST}\\s*=\\s*\\[`).test(line),
);
if (listStart !== -1) {
  for (let index = listStart + 1; index < lines.length; index += 1) {
    if (/^\s*\]/.test(lines[index])) break;
    const entry = /["'`]([^"'`]+)["'`]/.exec(lines[index]);
    if (!entry) continue;
    if (ALLOWED_BROWSER_PACKAGES.has(entry[1]) || allowed(index)) continue;
    violations.push({
      line: index + 1,
      what: `"${entry[1]}" added to ${BROWSER_PACKAGE_LIST}`,
    });
  }
}

// 3. The per-app gate on the browser copy. Its absence IS the original bug.
const callsGatedHelper = lines.some((line) =>
  new RegExp(`(?<!function\\s)\\b${GATED_COPY_CALL}\\s*\\(`).test(line),
);
if (callsGatedHelper) {
  const bodyStart = lines.findIndex((line) =>
    new RegExp(`function\\s+${GATED_COPY_CALL}\\s*\\(`).test(line),
  );
  const bodyEnd =
    bodyStart === -1
      ? -1
      : lines.findIndex((line, index) => index > bodyStart && /^\}/.test(line));
  const body =
    bodyStart === -1 || bodyEnd === -1
      ? null
      : lines.slice(bodyStart, bodyEnd).join("\n");

  if (body === null) {
    violations.push({
      line: bodyStart === -1 ? 1 : bodyStart + 1,
      what: `${GATED_COPY_CALL} is called but its body could not be located, so its gate could not be verified`,
    });
  } else if (!body.includes(REQUIRED_GATE)) {
    violations.push({
      line: bodyStart + 1,
      what: `${GATED_COPY_CALL} no longer consults ${REQUIRED_GATE}, so every app ships the browser again`,
    });
  }
}

if (violations.length === 0) {
  console.log("guard-serverless-function-payload: OK");
  process.exit(0);
}

console.error(
  `guard-serverless-function-payload: ${violations.length} change(s) to what every serverless function carries.`,
);
console.error(
  "\nThe serverless server directory is copied into EVERY emitted function and\n" +
    "unpacked on every cold start. Adding to it is not a build-config detail; it\n" +
    "is a latency change for every page view of every app.\n",
);
for (const violation of violations) {
  console.error(`  ${BUILD_FILE}:${violation.line} — ${violation.what}`);
}
console.error(
  "\nMeasured last time this shape landed (PR #2684, a ~10-line diff titled\n" +
    '"Harden auth and cold-start data paths"): +78MB of Chromium in the page\n' +
    "function of every app, docs function 59.8MB -> 159.9MB, cache-miss TTFB\n" +
    "4.15-6.03s. It shipped unnoticed because no check connected the two.\n",
);
console.error(
  `Read ${SKILL_REF} first. If the app that needs the package can be detected\n` +
    "from its OWN manifest, gate the copy on that instead — that is what\n" +
    `${REQUIRED_GATE} does, and it is why 13 of 18 apps stopped shipping a browser.\n\n` +
    "If every function genuinely needs the weight, say so on the line with the\n" +
    "measured cost, so a reviewer sees the decision:\n" +
    "  // guard:allow-serverless-function-payload — +Xmb, reason\n",
);

process.exit(1);
