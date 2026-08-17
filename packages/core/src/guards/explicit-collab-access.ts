/**
 * Require generated apps to choose how collaboration events are scoped.
 * Legacy `resourceType` callers remain valid during the access-option
 * migration; this guard only reports implicit createCollabPlugin configs.
 */

import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const CALL = /\bcreateCollabPlugin\s*\(/g;
const EXPLICIT_ACCESS_KEYS = new Set(["access", "resourceType"]);
const FINDING_MESSAGE =
  'createCollabPlugin must declare access explicitly. Use access: { mode: "resource", resourceType: "..." } for scoped resources or access: { mode: "all-authenticated" } when deployment-wide delivery is intentional. Legacy resourceType is also accepted during migration.';

function maskCommentsAndStrings(contents: string): string {
  const masked = contents.split("");
  for (let i = 0; i < contents.length; i++) {
    const char = contents[i];
    if (char === '"' || char === "'" || char === "`") {
      const end = skipQuoted(contents, i);
      for (let cursor = i; cursor < end; cursor++) {
        if (masked[cursor] !== "\n") masked[cursor] = " ";
      }
      i = end - 1;
      continue;
    }
    if (contents.startsWith("//", i)) {
      const newline = contents.indexOf("\n", i + 2);
      const end = newline === -1 ? contents.length : newline;
      for (let cursor = i; cursor < end; cursor++) masked[cursor] = " ";
      i = end - 1;
      continue;
    }
    if (contents.startsWith("/*", i)) {
      const commentEnd = contents.indexOf("*/", i + 2);
      const end = commentEnd === -1 ? contents.length : commentEnd + 2;
      for (let cursor = i; cursor < end; cursor++) {
        if (masked[cursor] !== "\n") masked[cursor] = " ";
      }
      i = end - 1;
    }
  }
  return masked.join("");
}

function skipQuoted(contents: string, start: number): number {
  const quote = contents[start];
  let escaped = false;
  for (let i = start + 1; i < contents.length; i++) {
    const char = contents[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return i + 1;
    }
  }
  return contents.length;
}

function skipTrivia(contents: string, start: number): number {
  let i = start;
  while (i < contents.length) {
    if (/\s/.test(contents[i] ?? "")) {
      i++;
      continue;
    }
    if (contents.startsWith("//", i)) {
      const newline = contents.indexOf("\n", i + 2);
      i = newline === -1 ? contents.length : newline + 1;
      continue;
    }
    if (contents.startsWith("/*", i)) {
      const end = contents.indexOf("*/", i + 2);
      i = end === -1 ? contents.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function findObjectEnd(contents: string, start: number): number | null {
  let depth = 0;
  for (let i = start; i < contents.length; i++) {
    const char = contents[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipQuoted(contents, i) - 1;
      continue;
    }
    if (contents.startsWith("//", i)) {
      const newline = contents.indexOf("\n", i + 2);
      i = newline === -1 ? contents.length : newline;
      continue;
    }
    if (contents.startsWith("/*", i)) {
      const end = contents.indexOf("*/", i + 2);
      i = end === -1 ? contents.length : end + 1;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return i;
  }
  return null;
}

function hasExplicitAccessProperty(
  contents: string,
  objectStart: number,
  objectEnd: number,
): boolean {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let expectingProperty = true;

  for (let i = objectStart + 1; i < objectEnd; i++) {
    i = skipTrivia(contents, i);
    if (i >= objectEnd) break;
    const char = contents[i];

    if (expectingProperty && (char === '"' || char === "'")) {
      const tokenEnd = skipQuoted(contents, i);
      const key = contents.slice(i + 1, tokenEnd - 1);
      const afterKey = skipTrivia(contents, tokenEnd);
      if (EXPLICIT_ACCESS_KEYS.has(key) && contents[afterKey] === ":") {
        return true;
      }
      i = tokenEnd - 1;
      expectingProperty = false;
      continue;
    }

    if (expectingProperty && /[A-Za-z_$]/.test(char ?? "")) {
      let tokenEnd = i + 1;
      while (/[A-Za-z0-9_$]/.test(contents[tokenEnd] ?? "")) tokenEnd++;
      const key = contents.slice(i, tokenEnd);
      const afterKey = skipTrivia(contents, tokenEnd);
      const delimiter = contents[afterKey];
      if (
        EXPLICIT_ACCESS_KEYS.has(key) &&
        (delimiter === ":" || delimiter === "," || afterKey >= objectEnd)
      ) {
        return true;
      }
      i = tokenEnd - 1;
      expectingProperty = false;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      i = skipQuoted(contents, i) - 1;
      continue;
    }
    if (contents.startsWith("//", i) || contents.startsWith("/*", i)) {
      i = skipTrivia(contents, i) - 1;
      continue;
    }

    if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (
      char === "," &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      expectingProperty = true;
    }
  }

  return false;
}

export function scanExplicitCollabAccess(
  options: GuardScanOptions,
): GuardResult {
  const { root } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    if (!SOURCE_FILE.test(file) || file.endsWith(".d.ts")) continue;
    const contents = readFileSafe(file);
    if (contents === null || !contents.includes("createCollabPlugin")) continue;
    const searchable = maskCommentsAndStrings(contents);

    CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL.exec(searchable)) !== null) {
      const callStart = match.index;
      const objectStart = skipTrivia(contents, CALL.lastIndex);
      if (contents[objectStart] !== "{") {
        if (contents[objectStart] === ")") {
          const { line } = lineColForOffset(contents, callStart);
          findings.push({
            file: relPosix(root, file),
            line,
            message: FINDING_MESSAGE,
          });
        }
        continue;
      }
      const objectEnd = findObjectEnd(contents, objectStart);
      if (objectEnd === null) continue;
      CALL.lastIndex = objectEnd + 1;

      if (hasExplicitAccessProperty(contents, objectStart, objectEnd)) continue;
      const { line } = lineColForOffset(contents, callStart);
      findings.push({
        file: relPosix(root, file),
        line,
        message: FINDING_MESSAGE,
      });
    }
  }

  return { name: "explicit-collab-access", findings };
}
