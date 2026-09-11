export const MAX_INLINE_MATH_LENGTH = 1_000;

export type InlineMathSyntax = "plain" | "github";

export interface InlineMathMatch {
  from: number;
  to: number;
  latex: string;
  syntax: InlineMathSyntax;
}

export function isEscapedInlineDelimiter(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function matchGithubInlineMath(
  text: string,
  start: number,
): InlineMathMatch | null {
  if (!text.startsWith("$`", start)) return null;

  const close = text.indexOf("`$", start + 2);
  if (close === -1 || close - (start + 2) > MAX_INLINE_MATH_LENGTH) {
    return null;
  }

  return {
    from: start,
    to: close + 2,
    latex: text.slice(start + 2, close),
    syntax: "github",
  };
}

function matchPlainInlineMath(
  text: string,
  start: number,
): InlineMathMatch | null {
  if (
    text[start] !== "$" ||
    text[start + 1] === "$" ||
    text[start + 1] === "`" ||
    !text[start + 1] ||
    /\s/.test(text[start + 1])
  ) {
    return null;
  }

  const searchLimit = Math.min(text.length, start + MAX_INLINE_MATH_LENGTH + 2);
  for (let close = start + 1; close < searchLimit; close++) {
    const char = text[close];
    if (char === "\n" || char === "\r") return null;
    if (
      char !== "$" ||
      isEscapedInlineDelimiter(text, close) ||
      text[close - 1] === "$" ||
      text[close + 1] === "$" ||
      /\s/.test(text[close - 1]) ||
      /\d/.test(text[close + 1] || "")
    ) {
      continue;
    }

    return {
      from: start,
      to: close + 1,
      latex: text.slice(start + 1, close),
      syntax: "plain",
    };
  }

  return null;
}

export function matchInlineMathAt(
  text: string,
  start: number,
): InlineMathMatch | null {
  if (text[start] !== "$" || isEscapedInlineDelimiter(text, start)) {
    return null;
  }

  return (
    matchGithubInlineMath(text, start) ?? matchPlainInlineMath(text, start)
  );
}

export function findTrailingPlainInlineMath(
  text: string,
): InlineMathMatch | null {
  if (!text.endsWith("$") || text.endsWith("$$")) return null;

  for (let start = text.length - 2; start >= 0; start--) {
    if (text[start] !== "$") continue;
    const match = matchInlineMathAt(text, start);
    if (
      match?.syntax === "plain" &&
      match.to === text.length &&
      !hasUnclosedCodeSpan(text.slice(0, start))
    ) {
      return match;
    }
  }

  return null;
}

function hasUnclosedCodeSpan(text: string): boolean {
  let openRun = 0;

  for (let cursor = 0; cursor < text.length; cursor++) {
    if (text[cursor] !== "`" || isEscapedInlineDelimiter(text, cursor)) {
      continue;
    }

    let run = 1;
    while (text[cursor + run] === "`") run += 1;
    if (openRun === 0) openRun = run;
    else if (openRun === run) openRun = 0;
    cursor += run - 1;
  }

  return openRun !== 0;
}
