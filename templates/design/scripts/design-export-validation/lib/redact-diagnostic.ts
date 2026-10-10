const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const ASSIGNMENT_PREFIX_PATTERN =
  /((?:\\+["']|["'])?)([A-Za-z_$][A-Za-z0-9_$.-]*(?:[ _-]+[A-Za-z0-9_$.-]+)*)\1(\s*[:=]\s*)/gi;
const ASSIGNMENT_BARE_VALUE_PATTERN =
  /^(?:((?:Bearer|Basic)\s+[^&\s"'<>),;}\]]+)|([^&\s"'<>),;}\]]+))/i;
const MAX_NESTED_ASSIGNMENT_DEPTH = 8;

function isSensitiveAssignmentKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const lastWord = words[words.length - 1];

  return (
    lastWord === "token" ||
    lastWord === "secret" ||
    lastWord === "signature" ||
    lastWord === "password" ||
    lastWord === "apikey" ||
    lastWord === "passwd" ||
    lastWord === "pwd" ||
    lastWord === "cookie" ||
    lastWord === "authorization" ||
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
  while (true) {
    const match = pattern.exec(value);
    if (!match) return null;
    const previous = match.index > 0 ? value[match.index - 1] : "";
    if (previous && /[\w$]/.test(previous)) {
      pattern.lastIndex = match.index + 1;
      continue;
    }
    return {
      index: match.index,
      end: pattern.lastIndex,
      key: match[2],
      prefix: match[0],
    };
  }
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
      const lineEnd = value.indexOf("\n", assignment.end);
      const end = lineEnd < 0 ? value.length : lineEnd;
      result += "[redacted]";
      cursor = end;
      searchFrom = end;
      continue;
    }

    if (isSensitive && startsStructuredValue) {
      result += "[redacted]";
      cursor = value.length;
      searchFrom = value.length;
      continue;
    }

    if (isSensitive && startsQuotedValue && parsedValue?.kind !== "quoted") {
      result += "[redacted]";
      cursor = value.length;
      searchFrom = value.length;
      continue;
    }

    if (isSensitive && parsedValue) {
      result +=
        parsedValue.kind === "quoted"
          ? `${parsedValue.opening}[redacted]${parsedValue.closing}`
          : "[redacted]";
      cursor = parsedValue.end;
      searchFrom = cursor;
      continue;
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
  return redactAssignments(value.replace(URL_PATTERN, "[URL]"));
}
