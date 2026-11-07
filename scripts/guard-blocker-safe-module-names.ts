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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as TypeScript from "typescript";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

interface BlockedWords {
  pattern: RegExp;
  list: string;
}

interface BrowserRoot {
  pathspec: string | string[];
  pattern: RegExp;
  url: (match: RegExpExecArray) => string;
  // The file types that count as its code, when not MODULE.
  modules?: RegExp;
  // Static files or docs, which can't stand in for a package's or app's own
  // code.
  assets?: true;
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

// Script, style and JSON files, which Vite serves as modules. They're also the
// code a root, package or template must still hold to count as checked.
const MODULE = /\.(?:[cm]?[jt]sx?|css|json)$/;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED = /(?:\.spec\.|\.test\.|\/__tests__\/|\.d\.ts$)/;

// Imports that make a module of a file of any type: one with a query, such as
// `?raw`, `?url` or `?worker`, and `import.meta.glob` calls. Each template's
// settings page imports its CHANGELOG.md this way. Only relative paths are
// followed, as no such import in the repo uses an alias.
const QUERY_IMPORT =
  /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"'?]+)\?[^"']*["']/g;

// TypeScript parses the files that call `import.meta.glob`. It's loaded on
// first use, as the CI scope script imports devModuleUrl from here before
// dependencies are installed.
const require = createRequire(import.meta.url);
let ts: typeof TypeScript | undefined;

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
  // The docs site imports core's docs as raw Markdown modules, from outside
  // its own root.
  {
    pathspec: "packages/core/docs/content/**",
    pattern: /^packages\/core\/docs\/content\/(.+)$/,
    url: ([, rel]) => `/@fs/packages/core/docs/content/${rel}?raw`,
    modules: /\.mdx?$/,
    assets: true,
  },
  {
    pathspec: ["templates/*/public/**", "community-templates/*/public/**"],
    pattern: /^(?:community-)?templates\/[^/]+\/public\/(.+)$/,
    url: servedAt,
    assets: true,
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
    assets: true,
  },
  // The docs site is an app too; its components import from `lib/` as well.
  {
    pathspec: "packages/docs/**",
    pattern: /^packages\/docs\/(.+)$/,
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
 * The browser root a repo file is served from, with its match, or null when
 * it's a test or type declaration, or outside every root.
 */
function servingRoot(
  file: string,
): { root: BrowserRoot; match: RegExpExecArray } | null {
  if (SKIPPED.test(file)) return null;
  for (const root of BROWSER_ROOTS) {
    const match = root.pattern.exec(file);
    if (match) return { root, match };
  }
  return null;
}

/** Whether `file` is code, rather than a static file, in the root serving it. */
function isCode(file: string, root: BrowserRoot): boolean {
  return (root.modules ?? MODULE).test(file);
}

/**
 * The URL path a repo file is served at in dev, or null when it's a test or
 * type declaration, or outside every browser root.
 */
export function devModuleUrl(file: string): string | null {
  const served = servingRoot(file);
  return served ? served.root.url(served.match) : null;
}

const GLOB_WILDCARDS: Record<string, string> = {
  "**/": "(?:.*/)?",
  "**": ".*",
  "*": "[^/]*",
  "?": "[^/]",
};

/**
 * The patterns a glob's brace alternatives stand for, innermost first, so
 * `*.{md,mdx}` is `*.md` and `*.mdx`.
 */
function expandBraces(glob: string): string[] {
  const braces = /\{([^{}]*,[^{}]*)\}/.exec(glob);
  if (!braces) return [glob];
  const before = glob.slice(0, braces.index);
  const after = glob.slice(braces.index + braces[0].length);
  return braces[1]
    .split(",")
    .flatMap((alternative) => expandBraces(before + alternative + after));
}

/** A regex for the repo paths a Vite glob pattern matches. */
function globPattern(glob: string): RegExp {
  const source = glob
    .replace(/[.+^$|\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*|\?/g, (wild) => GLOB_WILDCARDS[wild] ?? wild);
  return new RegExp(`^${source}$`);
}

/**
 * The `import.meta.glob` calls in `source`, each with its first line and its
 * patterns, or null patterns when they aren't string literals. Comments and
 * strings that only mention it don't count.
 */
function globCalls(
  file: string,
  source: string,
): { text: string; patterns: string[] | null }[] {
  if (!source.includes("import.meta.glob")) return [];
  const parser = (ts ??= require("typescript") as typeof TypeScript);
  const sourceFile = parser.createSourceFile(
    file,
    source,
    parser.ScriptTarget.Latest,
  );
  const calls: { text: string; patterns: string[] | null }[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (
      parser.isCallExpression(node) &&
      parser.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "glob" &&
      parser.isMetaProperty(node.expression.expression) &&
      node.expression.expression.keywordToken ===
        parser.SyntaxKind.ImportKeyword
    ) {
      const [first] = node.arguments;
      const elements =
        first && parser.isArrayLiteralExpression(first)
          ? [...first.elements]
          : [first];
      calls.push({
        text: node.getText(sourceFile).split("\n", 1)[0],
        patterns: elements.every(
          (element) => element && parser.isStringLiteralLike(element),
        )
          ? elements.map(
              (element) => (element as TypeScript.StringLiteral).text,
            )
          : null,
      });
    }
    parser.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

interface GlobCall {
  include: RegExp[];
  exclude: RegExp[];
}

/**
 * The files among `files` that browsers can load as modules: code under a
 * browser root, and files of any type that this code imports as modules.
 * `read` returns a file's source. Throws on an `import.meta.glob` pattern it
 * can't follow.
 */
export function browserModules(
  files: string[],
  read: (file: string) => string,
): string[] {
  const modules = new Set<string>();
  const imported = new Set<string>();
  const globs: GlobCall[] = [];
  for (const file of files) {
    const served = servingRoot(file);
    if (!served || !isCode(file, served.root)) continue;
    modules.add(file);
    if (!SCRIPT.test(file)) continue;
    const dir = path.posix.dirname(file);
    const source = read(file);
    for (const [, spec] of source.matchAll(QUERY_IMPORT)) {
      imported.add(path.posix.join(dir, spec));
    }
    for (const { text, patterns } of globCalls(file, source)) {
      // Rather than skip the files, stop at what this can't follow: patterns
      // that aren't string literals, syntax such as `[ab]` or `{1..3}`, and
      // paths from the project root.
      if (patterns === null) {
        throw new Error(`${file} imports a glob it can't follow: ${text}`);
      }
      const glob: GlobCall = { include: [], exclude: [] };
      for (const pattern of patterns.flatMap(expandBraces)) {
        const followable = (relative: string) =>
          relative.startsWith(".") && !/[[\](){}]/.test(relative);
        if (pattern.startsWith("!")) {
          // An exclusion only narrows the match, so one this can't follow,
          // such as `!**/*.test.ts`, is left out: it checks more files, not
          // fewer.
          if (followable(pattern.slice(1))) {
            glob.exclude.push(
              globPattern(path.posix.join(dir, pattern.slice(1))),
            );
          }
        } else if (followable(pattern)) {
          glob.include.push(globPattern(path.posix.join(dir, pattern)));
        } else {
          throw new Error(`${file} imports a glob it can't follow: ${pattern}`);
        }
      }
      globs.push(glob);
    }
  }
  for (const file of files) {
    if (SKIPPED.test(file)) continue;
    if (
      imported.has(file) ||
      globs.some(
        ({ include, exclude }) =>
          include.some((regex) => regex.test(file)) &&
          !exclude.some((regex) => regex.test(file)),
      )
    ) {
      modules.add(file);
    }
  }
  return [...modules];
}

/**
 * The pathspecs of browser roots that serve no code among `files`. A root
 * that stops matching, say after a folder moves, would otherwise pass
 * unchecked. Only the root a file is served from counts, so `public/` files
 * can't stand in for the rest of an app.
 */
export function emptyBrowserRoots(files: string[]): string[] {
  const served = new Set<BrowserRoot>();
  for (const file of files) {
    const root = servingRoot(file)?.root;
    if (root && isCode(file, root)) served.add(root);
  }
  return BROWSER_ROOTS.filter((root) => !served.has(root)).map(({ pathspec }) =>
    [pathspec].flat().join(", "),
  );
}

/**
 * Packages and templates with no code among `files` outside the roots for
 * static files and docs, leaving out those in NO_BROWSER_MODULES.
 */
export function uncheckedUnits(files: string[]): string[] {
  const checked = new Map<string, boolean>();
  for (const file of files) {
    const unit = /^(?:packages|(?:community-)?templates)\/[^/]+(?=\/)/.exec(
      file,
    )?.[0];
    if (!unit || NO_BROWSER_MODULES.has(unit)) continue;
    const served = servingRoot(file);
    checked.set(
      unit,
      checked.get(unit) === true ||
        (served !== null && !served.root.assets && isCode(file, served.root)),
    );
  }
  return [...checked]
    .filter(([, hasModules]) => !hasModules)
    .map(([unit]) => unit)
    .sort();
}

/**
 * The modules whose URLs hold a blocked word pair. A module outside every
 * browser root, like the CHANGELOG.md dispatch's settings page imports, is
 * served from the file system.
 */
export function findBlockedModuleNames(modules: string[]): BlockedModuleName[] {
  const violations: BlockedModuleName[] = [];
  for (const file of modules) {
    const url = (devModuleUrl(file) ?? `/@fs/${file}`).toLowerCase();
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

  let modules: string[];
  try {
    modules = browserModules(files, (file) => {
      try {
        return readFileSync(path.join(REPO_ROOT, file), "utf8");
      } catch (error) {
        // Deleted but not yet staged, so it imports nothing.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      }
    });
  } catch (error) {
    console.error(
      `guard-blocker-safe-module-names: could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      "\nPass import.meta.glob relative string patterns using `*`, `**`, `?` and `{a,b}`, or teach this guard the new syntax.",
    );
    process.exit(2);
  }
  const violations = findBlockedModuleNames(modules);
  if (violations.length === 0) {
    console.log(
      `guard-blocker-safe-module-names: OK (${modules.length} browser modules checked)`,
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
