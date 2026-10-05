import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".react-router",
  ".generated",
  ".claude",
  "out",
  "coverage",
]);

export function* walk(
  dir: string,
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS,
): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      yield* walk(full, skipDirs);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export function lineColForOffset(
  contents: string,
  offset: number,
): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (contents.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

export function isCommentLine(lineText: string): boolean {
  const trimmed = lineText.trimStart();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*")
  );
}

export function relPosix(root: string, file: string): string {
  return path.relative(root, file).replaceAll("\\", "/");
}

export function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function isExtraExempt(
  rel: string,
  extraExemptPaths: string[] | undefined,
): boolean {
  if (!extraExemptPaths || extraExemptPaths.length === 0) return false;
  return extraExemptPaths.includes(rel);
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

const CONTROL_FLOW_KEYWORDS = new Set(["if", "while", "for", "with"]);

function wordEndingAt(chars: string[], end: number): string {
  let start = end;
  while (start > 0 && /[\w$]/.test(chars[start - 1] ?? "")) start -= 1;
  return chars.slice(start, end + 1).join("");
}

/** Heuristic: a `/` in code starts a regex literal unless it follows an
 * operand (identifier, number, literal, `)` or `]`) or `<` (a JSX closing
 * tag), in which case it is not a regex. `chars` must already be masked
 * before `index`, so parens and words inside earlier strings or comments are
 * ignored; `lastLiteralEnd` marks where the latest masked literal closed. */
function slashStartsRegex(
  chars: string[],
  index: number,
  lastLiteralEnd: number,
): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(chars[cursor] ?? "")) cursor -= 1;
  if (lastLiteralEnd > cursor) return false;
  if (cursor < 0) return true;
  const prev = chars[cursor] ?? "";
  if (prev === "]" || prev === "<") return false;
  // Postfix `i++ /` and `i-- /` are division.
  if ((prev === "+" || prev === "-") && chars[cursor - 1] === prev) {
    return false;
  }
  if (prev === ")") {
    let depth = 0;
    for (; cursor >= 0; cursor -= 1) {
      if (chars[cursor] === ")") depth += 1;
      else if (chars[cursor] === "(" && --depth === 0) break;
    }
    cursor -= 1;
    while (cursor >= 0 && /\s/.test(chars[cursor] ?? "")) cursor -= 1;
    return CONTROL_FLOW_KEYWORDS.has(wordEndingAt(chars, cursor));
  }
  if (!/[\w$]/.test(prev)) return true;
  return REGEX_PRECEDING_KEYWORDS.has(wordEndingAt(chars, cursor));
}

/** Mask comments, string literals, and regex literals while preserving
 * offsets and newlines. Code inside template `${...}` stays visible. */
export function maskNonCode(source: string): string {
  const output = source.split("");
  let state:
    | "code"
    | "line"
    | "block"
    | "single"
    | "double"
    | "template"
    | "regex" = "code";
  let escaped = false;
  let inRegexClass = false;
  let lastLiteralEnd = -1;
  let quoteStart = -1;
  let plainQuoteAt = -1;
  // Brace depth for each open template `${` expression, innermost last.
  const templateDepths: number[] = [];

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
      } else if (
        char === "/" &&
        slashStartsRegex(output, index, lastLiteralEnd)
      ) {
        output[index] = " ";
        state = "regex";
        inRegexClass = false;
      } else if ((char === "'" || char === '"') && index !== plainQuoteAt) {
        output[index] = " ";
        state = char === "'" ? "single" : "double";
        quoteStart = index;
      } else if (char === "`") {
        output[index] = " ";
        state = "template";
      } else if (char === "{" && templateDepths.length > 0) {
        templateDepths[templateDepths.length - 1] += 1;
      } else if (char === "}" && templateDepths.length > 0) {
        const depth = templateDepths[templateDepths.length - 1] ?? 0;
        if (depth === 0) {
          templateDepths.pop();
          output[index] = " ";
          state = "template";
        } else {
          templateDepths[templateDepths.length - 1] = depth - 1;
        }
      }
      continue;
    }

    if (state === "line") {
      if (char === "\n") {
        state = "code";
      } else if (char !== "\r") {
        output[index] = " ";
      }
      continue;
    }
    if (char !== "\n" && char !== "\r") output[index] = " ";
    if (state === "block") {
      if (char === "*" && next === "/") {
        output[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (escaped) {
      // An escaped CRLF is one line continuation, not two characters.
      escaped = char === "\r" && next === "\n";
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (state === "regex") {
      if (char === "\n") {
        state = "code";
      } else if (char === "[") {
        inRegexClass = true;
      } else if (char === "]") {
        inRegexClass = false;
      } else if (char === "/" && !inRegexClass) {
        state = "code";
        lastLiteralEnd = index;
      }
      continue;
    }
    // Quoted strings cannot span lines, so an unclosed quote (e.g. an
    // apostrophe in JSX text) is plain code: unmask and rescan from it.
    if ((state === "single" || state === "double") && char === "\n") {
      for (let i = quoteStart; i < index; i += 1) output[i] = source[i] ?? "";
      plainQuoteAt = quoteStart;
      state = "code";
      escaped = false;
      index = quoteStart - 1;
      continue;
    }
    if (state === "template" && char === "$" && next === "{") {
      output[index + 1] = " ";
      templateDepths.push(0);
      state = "code";
      index += 1;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
      lastLiteralEnd = index;
    }
  }

  return output.join("");
}
