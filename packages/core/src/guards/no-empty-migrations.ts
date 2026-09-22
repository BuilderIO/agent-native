/**
 * Refuse empty `runMigrations([])` plugins. The migration runner itself is
 * safe for an empty list, but an empty plugin usually means a serverless boot
 * is still paying for a database migration check that has no work to do.
 */

import path from "node:path";

import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const EMPTY_MIGRATIONS_RE = /\brunMigrations\s*\(\s*\[\s*\]/g;
const ALLOW_MARKER_RE = /guard:allow-empty-migrations\s*[—-]\s*\S/;
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const TEST_FILE = /\.(?:spec|test)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

/** Mask comments and string literals while preserving offsets and newlines. */
function maskNonCode(source: string): string {
  const output = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" =
    "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (state === "code") {
      if (char === "/" && next === "/") {
        output[index] = output[index + 1] = " ";
        state = "line";
        index += 1;
      } else if (char === "/" && next === "*") {
        output[index] = output[index + 1] = " ";
        state = "block";
        index += 1;
      } else if (char === "'") {
        output[index] = " ";
        state = "single";
      } else if (char === '"') {
        output[index] = " ";
        state = "double";
      } else if (char === "`") {
        output[index] = " ";
        state = "template";
      }
      continue;
    }

    if (char !== "\n" && char !== "\r") output[index] = " ";
    if (state === "line") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        output[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
    }
  }

  return output.join("");
}

function hasAdjacentAllow(source: string, line: number): boolean {
  const lines = source.split(/\r?\n/);
  const current = line - 1;
  for (let index = current; index >= Math.max(0, current - 2); index -= 1) {
    const text = lines[index] ?? "";
    if (ALLOW_MARKER_RE.test(text)) return true;
    if (index < current && text.trim() && !/^\s*(?:\/\/|\/\*|\*)/.test(text)) {
      break;
    }
  }
  return false;
}

export interface EmptyMigrationsSourceOptions {
  file: string;
  source: string;
}

export function analyzeEmptyMigrationsSource({
  file,
  source,
}: EmptyMigrationsSourceOptions): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const code = maskNonCode(source);

  for (const match of code.matchAll(EMPTY_MIGRATIONS_RE)) {
    const line = lineColForOffset(source, match.index ?? 0).line;
    if (hasAdjacentAllow(source, line)) continue;
    findings.push({
      file,
      line,
      message:
        "empty runMigrations list performs needless migration startup work; remove the call or provide real migrations",
    });
  }

  return findings;
}

export function shouldScanEmptyMigrationsFile(relativeFile: string): boolean {
  const normalized = relativeFile.split(path.sep).join("/");
  if (!SOURCE_EXTENSIONS.test(normalized) || TEST_FILE.test(normalized)) {
    return false;
  }
  return !normalized
    .split("/")
    .some((segment) => segment === "node_modules" || segment === "vendor");
}

export function scanEmptyMigrations({ root }: GuardScanOptions): GuardResult {
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    const relativeFile = relPosix(root, file);
    if (!shouldScanEmptyMigrationsFile(relativeFile)) continue;
    const source = readFileSafe(file);
    if (source === null) continue;
    findings.push(
      ...analyzeEmptyMigrationsSource({ file: relativeFile, source }),
    );
  }

  return { name: "no-empty-migrations", findings };
}
