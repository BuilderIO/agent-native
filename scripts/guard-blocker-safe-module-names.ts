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
 * the pair appears, so `.min.js`, `_v2` and other variants are caught too.
 * They were checked in October 2026 against EasyList, EasyPrivacy, EasyList
 * Cookie List (which Brave turns on to hide cookie notices), Fanboy's
 * Annoyance List, Brave's own list and uBlock Origin's lists. They cover every
 * one of the 229 rules on the pairs below, and 376 of the 710 rules that
 * mention "cookie"; most of the rest name a vendor (`evercookie`,
 * `borlabs-cookie`) or are in another language (`aviso_cookies`). The patterns
 * are written here rather than copied from those lists.
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
  // Every word found next to "cookie" in five or more rules, plus `dialog`,
  // `privacy` and `wall`. Rarer neighbours are mostly vendor names.
  {
    pattern:
      /cookies?[-_.]?(?:accept|alert|banner|bar|compliance|consent|control|dialog|directive|disclaimer|gdpr|hinweis|info|law|layer|manager|message|monster|notice|notification|policy|popup|privacy|wall|warning)|(?:eu|gdpr|privacy)[-_.]?cookies?/,
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
// Package sources reach apps as their published `dist/*.js` files. `public/`
// files are served from the site root, and the rest of an app at its own path.
// Server-only code is checked too, because which files reach a browser depends
// on imports, and a rename is cheap: template client code imports from
// `server/`, `actions/` and `.generated/`, not just `app/` and `shared/`.
// Roots are tried in order, so `public/` comes before the rest of a template.
const packageDistUrl = ([, pkg, rel = ""]: RegExpExecArray): string =>
  `/@fs/node_modules/@agent-native/${pkg}/dist/${rel.replace(SCRIPT, ".js")}`;
const servedAt = ([, rel]: RegExpExecArray): string => `/${rel}`;

const BROWSER_ROOTS: BrowserRoot[] = [
  {
    pathspec: "packages/*/src/**",
    pattern: /^packages\/([^/]+)\/src\/(.+)$/,
    url: packageDistUrl,
  },
  // shared-app-config keeps its sources at the package root.
  {
    pathspec: "packages/shared-app-config/*.ts",
    pattern: /^packages\/(shared-app-config)\/([^/]+\.ts)$/,
    url: packageDistUrl,
  },
  {
    pathspec: ["templates/*/public/**", "community-templates/*/public/**"],
    pattern: /^(?:community-)?templates\/[^/]+\/public\/(.+)$/,
    url: servedAt,
  },
  {
    pathspec: ["templates/*/**", "community-templates/*/**"],
    pattern: /^(?:community-)?templates\/[^/]+\/(.+)$/,
    url: servedAt,
  },
  {
    pathspec: "packages/docs/public/**",
    pattern: /^packages\/docs\/public\/(.+)$/,
    url: servedAt,
  },
  {
    pathspec: "packages/docs/app/**",
    pattern: /^packages\/docs\/(app\/.+)$/,
    url: servedAt,
  },
  {
    pathspec: "packages/frame/client/**",
    pattern: /^packages\/frame\/(client\/.+)$/,
    url: servedAt,
  },
];

// Packages with no browser modules. Every other package and template must
// have some, so one that moves out of a wildcard root above is noticed even
// while the others keep that root busy.
const NO_BROWSER_MODULES = new Set([
  "packages/core-corpus", // no source files
  "packages/mobile-app", // React Native, which no browser loads
]);

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

/**
 * Packages and templates with no modules among `files`, other than those in
 * NO_BROWSER_MODULES.
 */
export function uncheckedUnits(files: string[]): string[] {
  const checked = new Map<string, boolean>();
  for (const file of files) {
    const unit = /^(?:packages|(?:community-)?templates)\/[^/]+(?=\/)/.exec(
      file,
    )?.[0];
    if (!unit || NO_BROWSER_MODULES.has(unit)) continue;
    checked.set(
      unit,
      checked.get(unit) === true || devModuleUrl(file) !== null,
    );
  }
  return [...checked]
    .filter(([, hasModules]) => !hasModules)
    .map(([unit]) => unit)
    .sort();
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
        // All of every package and template, so one whose modules moved out
        // of BROWSER_ROOTS still shows up in uncheckedUnits.
        "packages",
        "templates",
        "community-templates",
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
  const empty = [...emptyBrowserRoots(files), ...uncheckedUnits(files)];
  if (empty.length > 0) {
    console.error(
      "guard-blocker-safe-module-names: could not run: no browser modules found under:",
    );
    for (const where of empty) console.error(`  ${where}`);
    console.error(
      "\nMoved a folder? Update BROWSER_ROOTS in this file in the same change. " +
        "A package with no browser code goes in NO_BROWSER_MODULES.",
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
