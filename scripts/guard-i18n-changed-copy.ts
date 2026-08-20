import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "../packages/core/src/localization/shared.js";
import { findCatalogDirs } from "./guard-i18n-catalogs";
import { requireAddedLines, resolveDiffBase } from "./lib/changed-lines.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceDocsDir = path.join(rootDir, "packages", "core", "docs", "content");
const localeDocsDir = path.join(sourceDocsDir, "locales");
const localeAliases = new Map([
  ["zh-CN", "zhCN"],
  ["zh-TW", "zhTW"],
  ["es-ES", "esES"],
  ["fr-FR", "frFR"],
  ["de-DE", "deDE"],
  ["ja-JP", "jaJP"],
  ["ko-KR", "koKR"],
  ["pt-BR", "ptBR"],
  ["hi-IN", "hiIN"],
  ["ar-SA", "arSA"],
]);
const localeMarkerPattern = new RegExp(
  `(?:[\"'](${[...localeAliases.keys()].join("|")})[\"']\\s*:|(?:const|let)\\s+\\w*(?:${[...localeAliases.values()].join("|")})\\w*\\s*=)`,
);
const catalogCopyPattern = /(?:^|[:=])\s*["'`]([^"'`]*[A-Za-z][^"'`]*)["'`]/;

type ChangedCopySurface = {
  source: string;
  targets: readonly string[];
  changedTargets: ReadonlySet<string>;
};

export function checkChangedCopyCoverage(
  surfaces: readonly ChangedCopySurface[],
): string[] {
  const errors: string[] = [];
  for (const surface of surfaces) {
    for (const target of surface.targets) {
      if (surface.changedTargets.has(target)) continue;
      errors.push(
        `${surface.source}: changed user-facing copy has no corresponding translation update in ${target} — update it, or add an explicit i18n-copy-ignore marker only when the change is non-translatable`,
      );
    }
  }
  return errors.sort();
}

function main() {
  const addedLines = requireAddedLines(rootDir, "guard:i18n-changed-copy");
  const changedFiles = collectChangedFiles(rootDir);
  if (changedFiles === null) {
    console.error(
      "guard:i18n-changed-copy: could not determine changed files, so the check did not run.",
    );
    process.exit(2);
  }

  const surfaces = [
    ...collectCatalogSurfaces(addedLines, changedFiles),
    ...collectDocsSurfaces(changedFiles, addedLines),
  ];
  const errors = checkChangedCopyCoverage(surfaces);
  if (errors.length > 0) {
    console.error(`[guard:i18n-changed-copy] ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    console.error(
      "Update the affected locale catalogs/docs in the same change. Use i18n-copy-ignore only for a reviewed non-translatable or source-only edit.",
    );
    process.exit(1);
  }

  console.log(
    `[guard:i18n-changed-copy] checked ${surfaces.length} changed copy surface${surfaces.length === 1 ? "" : "s"}`,
  );
}

function collectCatalogSurfaces(
  addedLines: ReadonlyMap<string, ReadonlySet<number>>,
  changedFiles: ReadonlySet<string>,
): ChangedCopySurface[] {
  const surfaces: ChangedCopySurface[] = [];

  for (const catalogDir of findCatalogDirs()) {
    const sourceWrapper = path.join(catalogDir, `${DEFAULT_LOCALE}.ts`);
    if (!existsSync(sourceWrapper)) continue;

    const sourceImplementation = resolveCatalogSourceImplementation(
      catalogDir,
      sourceWrapper,
    );
    const sourceLines = addedLines.get(sourceImplementation);
    if (!changedFiles.has(sourceImplementation) || !sourceLines) continue;

    const sourceText = readFileSync(sourceImplementation, "utf8");
    const lines = sourceText.split(/\r?\n/);
    if (hasCopyIgnoreMarker(lines, sourceLines)) continue;

    if (sourceImplementation === sourceWrapper) {
      if (!hasCatalogCopyAddition(lines, sourceLines)) continue;
      const targets = readLocaleFiles(catalogDir)
        .filter((file) => file !== sourceWrapper)
        .map((file) => relative(file));
      surfaces.push({
        source: relative(sourceImplementation),
        targets,
        changedTargets: new Set(
          targets.filter((target) => changedFiles.has(absolute(target))),
        ),
      });
      continue;
    }

    const localeChanges = collectInlineLocaleChanges(lines, sourceLines);
    if (!hasInlineEnglishCopyAddition(lines, sourceLines)) {
      continue;
    }

    const importedLocaleFiles = collectImportedLocaleFiles(
      sourceImplementation,
      sourceText,
    );
    const targets: string[] = [];
    const changedTargets = new Set<string>();
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === DEFAULT_LOCALE) continue;
      const importedFile = importedLocaleFiles.get(locale);
      if (importedFile) {
        const target = relative(importedFile);
        targets.push(target);
        if (changedFiles.has(importedFile)) changedTargets.add(target);
        continue;
      }

      const target = `${relative(sourceImplementation)}#${locale}`;
      targets.push(target);
      if (localeChanges.has(locale)) changedTargets.add(target);
    }

    surfaces.push({
      source: relative(sourceImplementation),
      targets,
      changedTargets,
    });
  }

  return surfaces;
}

function collectDocsSurfaces(
  changedFiles: ReadonlySet<string>,
  addedLines: ReadonlyMap<string, ReadonlySet<number>>,
): ChangedCopySurface[] {
  const surfaces: ChangedCopySurface[] = [];
  for (const file of changedFiles) {
    if (!file.startsWith(`${sourceDocsDir}${path.sep}`)) continue;
    if (file.startsWith(`${localeDocsDir}${path.sep}`)) continue;
    if (!/\.(?:md|mdx)$/i.test(file)) continue;

    const sourceLines = addedLines.get(file);
    if (
      sourceLines &&
      hasCopyIgnoreMarker(
        existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [],
        sourceLines,
      )
    ) {
      continue;
    }

    const relativeSource = path.relative(sourceDocsDir, file);
    const sourceSlug = relativeSource.replace(/\.(?:md|mdx)$/i, "");
    const targets: string[] = [];
    const changedTargets = new Set<string>();
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === DEFAULT_LOCALE) continue;
      const targetFile = findLocalizedDocFile(locale, sourceSlug);
      if (!targetFile) continue;
      const target = relative(targetFile);
      targets.push(target);
      if (changedFiles.has(targetFile)) changedTargets.add(target);
    }

    surfaces.push({
      source: relative(file),
      targets,
      changedTargets,
    });
  }
  return surfaces;
}

function resolveCatalogSourceImplementation(
  catalogDir: string,
  sourceWrapper: string,
): string {
  const wrapper = readFileSync(sourceWrapper, "utf8");
  const importPath = wrapper.match(/from\s+["']([^"']*i18n-data)["']/)?.[1];
  if (!importPath) return sourceWrapper;

  const candidate = path.resolve(
    path.dirname(sourceWrapper),
    `${importPath}.ts`,
  );
  return existsSync(candidate) ? candidate : sourceWrapper;
}

function readLocaleFiles(catalogDir: string): string[] {
  return SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE)
    .map((locale) => path.join(catalogDir, `${locale}.ts`))
    .filter((file) => existsSync(file));
}

function collectImportedLocaleFiles(
  sourceFile: string,
  sourceText: string,
): ReadonlyMap<string, string> {
  const imported = new Map<string, string>();
  for (const match of sourceText.matchAll(
    /from\s+["']([^"']*\/((?:zh-CN|zh-TW|es-ES|fr-FR|de-DE|ja-JP|ko-KR|pt-BR|hi-IN|ar-SA)))["']/g,
  )) {
    const locale = match[2];
    if (!locale) continue;
    const base = path.resolve(path.dirname(sourceFile), match[1]!);
    const candidate = `${base}.ts`;
    if (existsSync(candidate)) imported.set(locale, candidate);
  }
  return imported;
}

function collectInlineLocaleChanges(
  lines: readonly string[],
  addedLineNumbers: ReadonlySet<number>,
): Map<string, Set<number>> {
  const markers = lines.flatMap((line, index) => {
    const match = line.match(localeMarkerPattern);
    const locale = match?.[1] ?? findLocaleAlias(line);
    return locale ? [{ line: index + 1, locale }] : [];
  });
  const changes = new Map<string, Set<number>>();
  for (const lineNumber of addedLineNumbers) {
    const marker = [...markers]
      .reverse()
      .find((candidate) => candidate.line <= lineNumber);
    if (!marker) continue;
    const lineSet = changes.get(marker.locale) ?? new Set<number>();
    lineSet.add(lineNumber);
    changes.set(marker.locale, lineSet);
  }
  return changes;
}

function findLocaleAlias(line: string): string | undefined {
  for (const [locale, alias] of localeAliases) {
    if (
      new RegExp(`\\b${alias}\\b`).test(line) &&
      /^(?:\s*const\s+|\s*let\s+)/.test(line)
    ) {
      return locale;
    }
  }
  return undefined;
}

function hasInlineEnglishCopyAddition(
  lines: readonly string[],
  addedLineNumbers: ReadonlySet<number>,
): boolean {
  const firstMarker = lines.findIndex((line) => localeMarkerPattern.test(line));
  if (firstMarker < 0) return false;
  const sourceBoundary = firstMarker + 1;
  return [...addedLineNumbers].some((lineNumber) => {
    if (lineNumber > sourceBoundary) return false;
    return isCatalogCopyLine(lines[lineNumber - 1] ?? "");
  });
}

function hasCatalogCopyAddition(
  lines: readonly string[],
  addedLineNumbers: ReadonlySet<number>,
): boolean {
  return [...addedLineNumbers].some((lineNumber) =>
    isCatalogCopyLine(lines[lineNumber - 1] ?? ""),
  );
}

function isCatalogCopyLine(line: string): boolean {
  const trimmed = line.trim();
  return /[A-Za-z]/.test(trimmed) && catalogCopyPattern.test(trimmed);
}

function hasCopyIgnoreMarker(
  lines: readonly string[],
  addedLineNumbers: ReadonlySet<number>,
): boolean {
  return [...addedLineNumbers].some((lineNumber) =>
    (lines[lineNumber - 1] ?? "").includes("i18n-copy-ignore"),
  );
}

function findLocalizedDocFile(
  locale: string,
  sourceSlug: string,
): string | undefined {
  for (const extension of [".mdx", ".md"]) {
    const candidate = path.join(
      localeDocsDir,
      locale,
      `${sourceSlug}${extension}`,
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function collectChangedFiles(cwd: string): Set<string> | null {
  const base = resolveDiffBase(cwd);
  if (!base) return null;
  let mergeBase: string;
  try {
    mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", mergeBase],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(
      output
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => path.resolve(cwd, file)),
    );
  } catch (error) {
    console.error(
      `guard:i18n-changed-copy: git diff failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function relative(file: string): string {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

function absolute(file: string): string {
  return path.resolve(rootDir, file);
}

const entrypoint = process.argv[1];
if (
  entrypoint &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  main();
}
