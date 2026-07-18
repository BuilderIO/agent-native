import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BARE_CLIENT_ENTRY = "@agent-native/core/client";
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__tests__",
  "build",
  "corpus",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

export type ClientBarrelViolation = {
  file: string;
  line: number;
};

function isIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$]/.test(value));
}

function isExcludedDirectoryName(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name) || name.startsWith("corpus.tmp-");
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function skipSpaceAndComments(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "//") {
      const lineEnd = source.indexOf("\n", cursor + 2);
      cursor = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "/*") {
      const blockEnd = source.indexOf("*/", cursor + 2);
      cursor = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }
    return cursor;
  }
  return cursor;
}

function readQuotedString(
  source: string,
  start: number,
): { end: number; value: string } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? "";
    if (character === "\\") {
      value += source[cursor + 1] ?? "";
      cursor += 1;
      continue;
    }
    if (character === quote) return { end: cursor + 1, value };
    value += character;
  }
  return null;
}

function scanStaticModuleSpecifiers(
  source: string,
): Array<{ index: number; value: string }> {
  const specifiers: Array<{ index: number; value: string }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor] ?? "";
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") cursor += 2;
        else if (source[cursor] === quote) {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "//") {
      const lineEnd = source.indexOf("\n", cursor + 2);
      cursor = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }
    if (source.slice(cursor, cursor + 2) === "/*") {
      const blockEnd = source.indexOf("*/", cursor + 2);
      cursor = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }

    const keyword = source.slice(cursor).match(/^(?:import|export)\b/)?.[0];
    if (!keyword || isIdentifierCharacter(source[cursor - 1])) {
      cursor += 1;
      continue;
    }
    const declarationStart = cursor;
    cursor = skipSpaceAndComments(source, cursor + keyword.length);
    const directSpecifier = readQuotedString(source, cursor);
    if (keyword === "import" && directSpecifier) {
      specifiers.push({ index: cursor, value: directSpecifier.value });
      cursor = directSpecifier.end;
      continue;
    }

    for (;;) {
      if (cursor >= source.length || source[cursor] === ";") break;
      if (source.slice(cursor, cursor + 2) === "//") {
        const lineEnd = source.indexOf("\n", cursor + 2);
        cursor = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
      if (source.slice(cursor, cursor + 2) === "/*") {
        const blockEnd = source.indexOf("*/", cursor + 2);
        cursor = blockEnd === -1 ? source.length : blockEnd + 2;
        continue;
      }
      if (
        source.slice(cursor, cursor + 4) === "from" &&
        !isIdentifierCharacter(source[cursor - 1]) &&
        !isIdentifierCharacter(source[cursor + 4])
      ) {
        const specifierStart = skipSpaceAndComments(source, cursor + 4);
        const specifier = readQuotedString(source, specifierStart);
        if (specifier) {
          specifiers.push({ index: specifierStart, value: specifier.value });
          cursor = specifier.end;
          break;
        }
      }
      if (
        source[cursor] === "'" ||
        source[cursor] === '"' ||
        source[cursor] === "`"
      ) {
        const quote = source[cursor] ?? "";
        cursor += 1;
        while (cursor < source.length && source[cursor] !== quote) {
          cursor += source[cursor] === "\\" ? 2 : 1;
        }
      }
      cursor += 1;
      if (cursor - declarationStart > 20_000) break;
    }
  }
  return specifiers;
}

export function findCoreClientBarrelImports(
  file: string,
  source: string,
): ClientBarrelViolation[] {
  return scanStaticModuleSpecifiers(source)
    .filter((specifier) => specifier.value === BARE_CLIENT_ENTRY)
    .map((specifier) => ({ file, line: lineAt(source, specifier.index) }));
}

export function shouldScanCoreClientBarrelFile(relativeFile: string): boolean {
  const normalized = relativeFile.split(path.sep).join("/");
  if (!/^(?:packages|templates)\//.test(normalized)) return false;
  if (!/\.(?:ts|tsx)$/.test(normalized)) return false;
  if (/\.(?:spec|test)\.(?:ts|tsx)$/.test(normalized)) return false;
  if (/\.(?:generated|gen)\.(?:ts|tsx)$/.test(normalized)) return false;
  if (normalized === "packages/core/src/client/index.ts") return false;
  return !normalized
    .split("/")
    .some((segment) => isExcludedDirectoryName(segment));
}

function discoverFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (absolutePath: string): void => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      const relative = path.relative(repoRoot, child);
      if (entry.isDirectory()) {
        if (!isExcludedDirectoryName(entry.name)) visit(child);
      } else if (entry.isFile() && shouldScanCoreClientBarrelFile(relative)) {
        files.push(relative);
      }
    }
  };
  for (const root of ["packages", "templates"])
    visit(path.join(repoRoot, root));
  return files;
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const violations = discoverFiles(repoRoot).flatMap((file) =>
    findCoreClientBarrelImports(
      file,
      readFileSync(path.join(repoRoot, file), "utf8"),
    ),
  );
  if (violations.length > 0) {
    console.error(
      `[guard:no-core-client-barrel-imports] ${violations.length} violation(s):\n${violations.map((item) => `- ${item.file}:${item.line} imports the deprecated ${BARE_CLIENT_ENTRY} barrel; use a focused subpath instead.`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:no-core-client-barrel-imports] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
