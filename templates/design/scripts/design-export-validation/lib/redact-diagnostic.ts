const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const URL_USERINFO_PATTERN =
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s,;)}\]"'<>]*@)/gi;
const ASSIGNMENT_PREFIX_PATTERN =
  /(?<![\w$])((?:\\+["']|["']))(?=([A-Za-z_$][A-Za-z0-9$]*(?:[._ -]+[A-Za-z0-9$]+)*))\2\1(\s*(?:=>|[:=])\s*)|(?<![\w$._-])(?:-+)?((?:authorization[ ]+(?:header|value)|auth[ ]+(?:header|value)|api[ ]+key[ ]+(?:used|provided|value)|access[ ]+key[ ]+id|(?:api|private|access|secret|signing|encryption)[ ]+key|[A-Za-z_$][A-Za-z0-9$]*[ ]+(?:token|secret|signature|password|passwd|pwd|pw|pass|passphrase|credential|credentials|cookie|authorization)))(\s*(?:=>|[:=])\s*)|(?<![\w$._-])(?:-+)?(?=([A-Za-z_$][A-Za-z0-9$]*(?:[._-]+[A-Za-z0-9$]+)*))\6(\s*(?:=>|[:=])\s*)/gi;
const ASSIGNMENT_BARE_VALUE_PATTERN =
  /^(?:((?:Bearer|Basic)\s+[^&\s"'<>),;}\]]+)|([^&\s"'<>),;}\]]+))/i;
const MAX_NESTED_ASSIGNMENT_DEPTH = 8;
const MAX_STRUCTURED_JSON_DEPTH = 128;

function isSensitiveAssignmentKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const lastWord = words[words.length - 1];
  const compactKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const hasCredentialSuffix = [
    "authorization",
    "credentials",
    "credential",
    "passphrase",
    "password",
    "passwd",
    "signature",
    "token",
    "secret",
    "cookie",
    "apikey",
  ].some(
    (suffix) =>
      compactKey.length > suffix.length && compactKey.endsWith(suffix),
  );
  const normalizedWords = words.join(" ");
  const hasReviewDescriptor =
    normalizedWords === "authorization header" ||
    normalizedWords === "authorization value" ||
    normalizedWords === "auth" ||
    normalizedWords === "auth header" ||
    normalizedWords === "auth value" ||
    normalizedWords === "api key used" ||
    normalizedWords === "api key provided" ||
    normalizedWords === "api key value";

  return (
    hasCredentialSuffix ||
    hasReviewDescriptor ||
    lastWord === "token" ||
    lastWord === "secret" ||
    lastWord === "signature" ||
    lastWord === "password" ||
    lastWord === "apikey" ||
    lastWord === "passwd" ||
    lastWord === "pwd" ||
    lastWord === "pw" ||
    lastWord === "pass" ||
    lastWord === "passphrase" ||
    lastWord === "credential" ||
    lastWord === "credentials" ||
    lastWord === "cookie" ||
    lastWord === "authorization" ||
    words.slice(-3).join(" ") === "access key id" ||
    (lastWord === "key" &&
      ["api", "private", "access", "secret", "signing", "encryption"].includes(
        words[words.length - 2],
      ))
  );
}

type ParsedValue =
  | {
      kind: "quoted";
      opening: string;
      content: string;
      closing: string;
      end: number;
    }
  | { kind: "bare"; end: number };

function parseAssignmentValue(
  value: string,
  start: number,
): ParsedValue | null {
  let quoteStart = start;
  while (value[quoteStart] === "\\") quoteStart += 1;
  const quote = value[quoteStart];
  if (quote === '"' || quote === "'") {
    const delimiter = value.slice(start, quoteStart + 1);
    const delimiterSlashCount = quoteStart - start;
    for (let cursor = quoteStart + 1; cursor < value.length; cursor += 1) {
      if (value[cursor] !== quote) continue;
      let slashStart = cursor;
      while (slashStart > quoteStart + 1 && value[slashStart - 1] === "\\") {
        slashStart -= 1;
      }
      const slashCount = cursor - slashStart;
      const delimiterPeriod = 2 * (delimiterSlashCount + 1);
      if (slashCount % delimiterPeriod !== delimiterSlashCount) continue;
      const closingStart = cursor - delimiterSlashCount;

      return {
        kind: "quoted",
        opening: delimiter,
        content: value.slice(quoteStart + 1, closingStart),
        closing: value.slice(closingStart, cursor + 1),
        end: cursor + 1,
      };
    }
    return null;
  }

  const match = ASSIGNMENT_BARE_VALUE_PATTERN.exec(value.slice(start));
  if (!match) return null;
  return { kind: "bare", end: start + match[0].length };
}

function findNextAssignment(
  value: string,
  start: number,
): { index: number; end: number; key: string; prefix: string } | null {
  const pattern = new RegExp(ASSIGNMENT_PREFIX_PATTERN.source, "gi");
  pattern.lastIndex = start;
  const match = pattern.exec(value);
  if (!match) return null;
  const key = match[2] ?? match[4] ?? match[6];
  if (!key) return null;
  return {
    index: match.index,
    end: pattern.lastIndex,
    key,
    prefix: match[0],
  };
}

function hasStructuredValueContinuation(value: string, start: number): boolean {
  let cursor = start;
  let hasSeparator = false;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  hasSeparator = cursor > start;
  if (cursor >= value.length) return true;

  if (value[cursor] === ",") {
    hasSeparator = true;
    cursor += 1;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  }

  return hasSeparator && findNextAssignment(value, cursor)?.index === cursor;
}

function findLineEnd(value: string, start: number): number {
  const offset = value.slice(start).search(/[\r\n]/);
  return offset < 0 ? value.length : start + offset;
}

function findPemBlockEnd(value: string, start: number): number | null {
  const firstLineEnd = findLineEnd(value, start);
  const firstLine = value.slice(start, firstLineEnd);
  const beginMatch = /^\s*-----BEGIN ([A-Z0-9][A-Z0-9 -]*?)-----/.exec(
    firstLine,
  );
  if (!beginMatch) return null;

  const endMarker = `-----END ${beginMatch[1]}-----`;
  let lineStart = firstLineEnd;
  while (lineStart < value.length) {
    if (value[lineStart] === "\r") lineStart += 1;
    if (value[lineStart] === "\n") lineStart += 1;
    const lineEnd = findLineEnd(value, lineStart);
    const line = value.slice(lineStart, lineEnd);
    if (line.startsWith(endMarker)) return lineEnd;
    lineStart = lineEnd;
  }

  // Without a matching footer, hide the rest of the diagnostic rather than
  // risk exposing an incomplete key block.
  return value.length;
}

function findStructuredJsonValueEnd(
  value: string,
  start: number,
): number | null {
  let valueStart = start;
  while (/\s/.test(value[valueStart] ?? "")) valueStart += 1;
  const first = value[valueStart];
  if (first !== "{" && first !== "[") return null;

  const closers = [first === "{" ? "}" : "]"];
  let inString = false;
  for (let cursor = valueStart + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (inString) {
      if (character === "\\") cursor += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      if (closers.length >= MAX_STRUCTURED_JSON_DEPTH) return null;
      closers.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (closers.pop() !== character) return null;
      if (closers.length === 0) {
        const valueEnd = cursor + 1;
        try {
          JSON.parse(value.slice(valueStart, valueEnd));
        } catch {
          return null;
        }
        return valueEnd;
      }
    }
  }
  return null;
}

function findJsonValueEnd(value: string, start: number): number | null {
  let valueStart = start;
  while (/\s/.test(value[valueStart] ?? "")) valueStart += 1;
  if (valueStart >= value.length) return null;

  const first = value[valueStart];
  let valueEnd: number | null = null;
  if (first === '"') {
    for (let cursor = valueStart + 1; cursor < value.length; cursor += 1) {
      if (value[cursor] === "\\") {
        cursor += 1;
      } else if (value[cursor] === '"') {
        valueEnd = cursor + 1;
        break;
      }
    }
  } else if (first === "{" || first === "[") {
    valueEnd = findStructuredJsonValueEnd(value, valueStart);
  } else {
    const primitive =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        value.slice(valueStart),
      );
    if (primitive) valueEnd = valueStart + primitive[0].length;
  }

  if (valueEnd === null) return null;
  let delimiter = valueEnd;
  while (/\s/.test(value[delimiter] ?? "")) delimiter += 1;
  return ",}]".includes(value[delimiter] ?? "") ? valueEnd : null;
}

function redactAssignments(value: string, depth = 0): string {
  let result = "";
  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const assignment = findNextAssignment(value, searchFrom);
    if (!assignment) break;
    const parsedValue = parseAssignmentValue(value, assignment.end);
    const isSensitive = isSensitiveAssignmentKey(assignment.key);
    result += value.slice(cursor, assignment.index) + assignment.prefix;

    const rawValue = value.slice(assignment.end);
    const startsQuotedValue = /^(?:\\+["']|["'])/.test(rawValue);
    const startsStructuredValue = /^\s*[{[]/.test(rawValue);
    const isCookieCredential =
      isSensitive && /^(?:set-)?cookie$/i.test(assignment.key);
    const isCookieHeader =
      isCookieCredential &&
      !/^(?:\\+["']|["'])/.test(assignment.prefix) &&
      /:\s*$/.test(assignment.prefix);
    const isBareCookieAssignment =
      isCookieCredential &&
      !/:\s*$/.test(assignment.prefix) &&
      parsedValue?.kind !== "quoted";
    if (isCookieHeader || isBareCookieAssignment) {
      result += "[redacted]";
      cursor = findLineEnd(value, assignment.end);
      searchFrom = cursor;
      continue;
    }

    const isQuotedJsonProperty =
      /^(?:\\+)?["']/.test(assignment.prefix) &&
      /:\s*$/.test(assignment.prefix);
    if (isSensitive && isQuotedJsonProperty && parsedValue?.kind !== "quoted") {
      const jsonValueEnd = findJsonValueEnd(value, assignment.end);
      if (jsonValueEnd !== null) {
        result += "[redacted]";
        cursor = jsonValueEnd;
        searchFrom = cursor;
        continue;
      }
    }

    if (isSensitive && startsStructuredValue) {
      const jsonValueEnd = findStructuredJsonValueEnd(value, assignment.end);
      result += "[redacted]";
      cursor =
        jsonValueEnd !== null &&
        hasStructuredValueContinuation(value, jsonValueEnd)
          ? jsonValueEnd
          : value.length;
      searchFrom = cursor;
      continue;
    }

    if (isSensitive && startsQuotedValue && parsedValue?.kind !== "quoted") {
      result += "[redacted]";
      cursor = value.length;
      searchFrom = value.length;
      continue;
    }

    if (isSensitive && parsedValue) {
      if (parsedValue.kind === "quoted") {
        result += `${parsedValue.opening}[redacted]${parsedValue.closing}`;
        cursor = parsedValue.end;
      } else {
        const pemBlockEnd = findPemBlockEnd(value, assignment.end);
        result += "[redacted]";
        // Bare secrets can contain whitespace and assignment-like text. A PEM
        // block has an explicit footer; otherwise consume through the line.
        cursor = pemBlockEnd ?? findLineEnd(value, assignment.end);
      }
      searchFrom = cursor;
      continue;
    }

    if (isSensitive && !parsedValue) {
      const remainder = value.slice(assignment.end);
      if (remainder.trim().length > 0) {
        result += "[redacted]";
        cursor = findLineEnd(value, assignment.end);
        searchFrom = cursor;
        continue;
      }
    }

    if (parsedValue?.kind === "quoted") {
      if (depth >= MAX_NESTED_ASSIGNMENT_DEPTH) {
        result += `${parsedValue.opening}[redacted]${parsedValue.closing}`;
      } else {
        result += `${parsedValue.opening}${redactAssignments(parsedValue.content, depth + 1)}${parsedValue.closing}`;
      }
      cursor = parsedValue.end;
      searchFrom = cursor;
      continue;
    }

    // Leave non-sensitive bare values unconsumed so assignments nested in them
    // remain visible to this scanner.
    cursor = assignment.end;
    searchFrom = assignment.end;
  }
  return result + value.slice(cursor);
}

export function redactExportDiagnostic(value: string): string {
  return redactAssignments(
    value
      .replace(URL_USERINFO_PATTERN, "$1[redacted]@")
      .replace(URL_PATTERN, "[URL]"),
  );
}
