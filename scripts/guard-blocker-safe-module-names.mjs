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

const MODULE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED = /(?:\.spec\.|\.test\.|\/__tests__\/|\.d\.ts$)/;

/**
 * The URL path Vite serves a repo file at in dev, or null when the file never
 * reaches the browser. Package files load from `dist` as `.js`; template files
 * keep their source path and extension.
 */
export function devModuleUrl(file) {
  if (!MODULE.test(file) || SKIPPED.test(file)) return null;
  const pkg = /^packages\/([^/]+)\/src\/(.+)$/.exec(file);
  if (pkg) {
    const rel = pkg[2].replace(MODULE, ".js");
    return `/@fs/node_modules/@agent-native/${pkg[1]}/dist/${rel}`;
  }
  const template = /^templates\/[^/]+\/(app\/.+)$/.exec(file);
  return template ? `/${template[1]}` : null;
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
      "packages/*/src/**",
      "templates/*/app/**",
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
    "\nBrowsers with Brave Shields, uBlock Origin or AdGuard never load these modules, " +
      "so the app never starts. Rename the file to something neutral.",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
