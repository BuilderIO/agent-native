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
 * BLOCKED_WORDS holds the word pairs that cookie-notice and tracker rules are
 * built on, such as `cookie-banner`. A URL holding one of them, with `-`, `_`
 * or nothing between the words and in any letter case, is flagged wherever
 * the pair appears, so `.min.js`, `_v2` and other variants are caught too. In
 * October 2026 these patterns covered every one of the 229 rules on these
 * pairs in EasyList, EasyPrivacy, EasyList Cookie List (which Brave turns on
 * to hide cookie notices), Fanboy's Annoyance List, Brave's own list and
 * uBlock Origin's lists. They are written here rather than copied from those
 * lists.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

interface BlockedWords {
  pattern: RegExp;
  list: string;
}

interface BrowserRoot {
  pathspec: string | string[];
  pattern: RegExp;
  url: (match: RegExpExecArray) => string;
}

export interface BlockedModuleName {
  file: string;
  words: string;
  list: string;
}

const BLOCKED_WORDS: BlockedWords[] = [
  // `ConsentBanner.js` passes every list, so this pair needs a separator.
  { pattern: /consent[-_]banner|consentbanner-/, list: "cookie-notice lists" },
  { pattern: /consent[-_]?(?:manager|modal)/, list: "cookie-notice lists" },
  {
    pattern: /cookie[-_]?(?:banner|notice|consent|popup|privacy|policy|dialog)/,
    list: "cookie-notice lists",
  },
  { pattern: /gdpr[-_]?(?:consent|popup)/, list: "cookie-notice lists" },
  { pattern: /privacy[-_]?banner/, list: "cookie-notice lists" },
  { pattern: /analytics[-_]?(?:tracking|helper|sdk)/, list: "tracker lists" },
  {
    pattern: /(?:event|click|pixel)[-_]?tracking|tracking[-_]?pixel/,
    list: "tracker lists",
  },
  // `analytics-events.js` passes every list, so this pair keeps the exact
  // forms the lists block.
  {
    pattern:
      /analytics-events?-|analytics-event\.js|analytics_events?\.js|analyticsevents?\.js|tracking-analytics-events|loganalyticsevent/,
    list: "tracker lists",
  },
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
const BROWSER_ROOTS: BrowserRoot[] = [
  {
    pathspec: "packages/*/src/**",
    pattern: /^packages\/([^/]+)\/src\/(.+)$/,
    url: ([, pkg, rel = ""]) =>
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
export function devModuleUrl(file: string): string | null {
  if (!MODULE.test(file) || SKIPPED.test(file)) return null;
  for (const root of BROWSER_ROOTS) {
    const match = root.pattern.exec(file);
    if (match) return root.url(match);
  }
  return null;
}

/**
 * The pathspecs of browser roots with no modules among `files`. A root that
 * stops matching, say after a folder moves, would otherwise pass unchecked.
 */
export function emptyBrowserRoots(files: string[]): string[] {
  return BROWSER_ROOTS.filter(
    (root) =>
      !files.some((file) => root.pattern.test(file) && devModuleUrl(file)),
  ).map(({ pathspec }) => [pathspec].flat().join(", "));
}

export function findBlockedModuleNames(files: string[]): BlockedModuleName[] {
  const violations: BlockedModuleName[] = [];
  for (const file of files) {
    const url = devModuleUrl(file)?.toLowerCase();
    if (!url) continue;
    for (const { pattern, list } of BLOCKED_WORDS) {
      const match = pattern.exec(url);
      if (match) {
        violations.push({ file, words: match[0], list });
        break;
      }
    }
  }
  return violations;
}

function main(): void {
  let files: string[];
  try {
    files = execFileSync(
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
  } catch (error) {
    console.error(
      `guard-blocker-safe-module-names: could not run: cannot list files — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }

  // A pass that inspected nothing is not a pass.
  const empty = emptyBrowserRoots(files);
  if (empty.length > 0) {
    console.error(
      "guard-blocker-safe-module-names: could not run: no browser modules found under:",
    );
    for (const pathspecs of empty) console.error(`  ${pathspecs}`);
    console.error(
      "\nMoved a folder? Update BROWSER_ROOTS in this file in the same change.",
    );
    process.exit(2);
  }

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
  for (const { file, words, list } of violations) {
    console.error(`  ${file}  contains "${words}" (${list})`);
  }
  console.error(
    "\nBrave Shields, uBlock Origin and AdGuard refuse these URLs, and when a browser " +
      "module is refused the app never starts. Rename the file to something neutral, " +
      "even if it only runs on the server today.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
