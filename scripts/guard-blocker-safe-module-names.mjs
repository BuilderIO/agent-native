#!/usr/bin/env node
/**
 * Keep browser module file names clear of content-blocker rules.
 *
 * In dev, Vite serves each module at a URL built from its file name. Brave
 * Shields, uBlock Origin and AdGuard block script URLs that contain certain
 * words by default, and one blocked static import stops the whole module graph:
 * the app stays on its loading skeleton with nothing in the console. This is
 * how `consent-banner-messages.js` broke every app in Brave (issue 8350).
 *
 * RULES are copied verbatim from EasyList Cookie List (which Brave turns on to
 * hide cookie notices) and EasyPrivacy. They are plain substring rules, so a
 * URL that contains one, in any letter case, is blocked.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const RULES = [
  { rule: "/consent-banner-", list: "EasyList Cookie List" },
  { rule: "-consent-banner-", list: "EasyList Cookie List" },
  { rule: "-consent-banner.", list: "EasyList Cookie List" },
  { rule: "/consent_banner.js", list: "EasyList Cookie List" },
  { rule: "/consent-manager.js", list: "EasyList Cookie List" },
  { rule: "/consent-modal.js", list: "EasyList Cookie List" },
  { rule: "/cookie-banner.js", list: "EasyList Cookie List" },
  { rule: "-cookie-banner.", list: "EasyList Cookie List" },
  { rule: "/cookie_banner-", list: "EasyList Cookie List" },
  { rule: "/cookiebanner.js", list: "EasyList Cookie List" },
  { rule: "/cookie-notice-", list: "EasyList Cookie List" },
  { rule: "-cookie-notice-", list: "EasyList Cookie List" },
  { rule: "/cookie-consent.js", list: "EasyList Cookie List" },
  { rule: "/cookieconsent.js", list: "EasyList Cookie List" },
  { rule: "/cookie-popup-", list: "EasyList Cookie List" },
  { rule: "/cookie-privacy-", list: "EasyList Cookie List" },
  { rule: "-cookie-policy.", list: "EasyList Cookie List" },
  { rule: "-cookie-dialog.", list: "EasyList Cookie List" },
  { rule: "/gdpr-consent-", list: "EasyList Cookie List" },
  { rule: "/gdpr-popup-", list: "EasyList Cookie List" },
  { rule: "/privacy-banner.js", list: "EasyList Cookie List" },
  { rule: "/analytics-events-", list: "EasyPrivacy" },
  { rule: "/analytics-event.js", list: "EasyPrivacy" },
  { rule: "/analytics-tracking.js", list: "EasyPrivacy" },
  { rule: "/analytics-helper.js", list: "EasyPrivacy" },
  { rule: "/analytics-sdk.", list: "EasyPrivacy" },
  { rule: "/event-tracking.js", list: "EasyPrivacy" },
  { rule: "/click-tracking.js", list: "EasyPrivacy" },
  { rule: "/pixel-tracking.", list: "EasyPrivacy" },
  { rule: "-tracking-pixel.", list: "EasyPrivacy" },
];

// Vite serves imported CSS and JSON as modules too, so a blocked one breaks
// startup the same way.
const MODULE = /\.(?:[cm]?[jt]sx?|css|json)$/;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED = /(?:\.spec\.|\.test\.|\/__tests__\/|\.d\.ts$)/;

// Every place a browser loads modules from, with the URL each file gets in dev.
// Package sources reach apps as their published `dist/*.js` files. App roots
// are served at their own path, and `public/` files from the site root.
// Package `src` also holds server-only code; it is checked too, because which
// files reach a browser depends on imports, and a rename is cheap.
const BROWSER_ROOTS = [
  {
    pathspec: "packages/*/src/**",
    pattern: /^packages\/([^/]+)\/src\/(.+)$/,
    url: ([, pkg, rel]) =>
      `/@fs/node_modules/@agent-native/${pkg}/dist/${rel.replace(SCRIPT, ".js")}`,
  },
  {
    pathspec: [
      "templates/*/app/**",
      "templates/*/shared/**",
      "community-templates/*/app/**",
      "community-templates/*/shared/**",
    ],
    pattern: /^(?:community-)?templates\/[^/]+\/((?:app|shared)\/.+)$/,
    url: ([, rel]) => `/${rel}`,
  },
  {
    pathspec: ["packages/docs/app/**", "packages/frame/client/**"],
    pattern: /^packages\/(?:docs|frame)\/((?:app|client)\/.+)$/,
    url: ([, rel]) => `/${rel}`,
  },
  {
    pathspec: [
      "templates/*/public/**",
      "community-templates/*/public/**",
      "packages/docs/public/**",
    ],
    pattern:
      /^(?:(?:community-)?templates\/[^/]+|packages\/docs)\/public\/(.+)$/,
    url: ([, rel]) => `/${rel}`,
  },
];

/**
 * The URL path a repo file is served at in dev, or null when the file never
 * reaches a browser.
 */
export function devModuleUrl(file) {
  if (!MODULE.test(file) || SKIPPED.test(file)) return null;
  for (const root of BROWSER_ROOTS) {
    const match = root.pattern.exec(file);
    if (match) return root.url(match);
  }
  return null;
}

export function findBlockedModuleNames(files) {
  const violations = [];
  for (const file of files) {
    const url = devModuleUrl(file)?.toLowerCase();
    if (!url) continue;
    const match = RULES.find(({ rule }) => url.includes(rule));
    if (match) violations.push({ file, ...match });
  }
  return violations;
}

function main() {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...BROWSER_ROOTS.flatMap(({ pathspec }) => pathspec),
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);

  const violations = findBlockedModuleNames(files);
  if (violations.length === 0) {
    const checked = files.filter((file) => devModuleUrl(file)).length;
    console.log(
      `guard-blocker-safe-module-names: OK (${checked} browser modules checked)`,
    );
    process.exit(0);
  }

  console.error(
    `guard-blocker-safe-module-names: ${violations.length} module name(s) are blocked by default content blockers:`,
  );
  for (const { file, rule, list } of violations) {
    console.error(`  ${file}  matches "${rule}" (${list})`);
  }
  console.error(
    "\nBrave Shields, uBlock Origin and AdGuard refuse these URLs, and when a browser " +
      "module is refused the app never starts. Rename the file to something neutral, " +
      "even if it only runs on the server today.",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
