const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const URL_USERINFO_PATTERN =
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s,;)}\]"'<>]*@)/gi;
const ASSIGNMENT_PREFIX_PATTERN =
  /(?<![\w$])((?:\\+["']|["']))(?=([A-Za-z_$][A-Za-z0-9$]*(?:[._ -]+[A-Za-z0-9$]+)*))\2\1(\s*(?:=>|[:=])\s*)|(?<![\w$._-])(?:-+)?((?:authorization[ ]+(?:header|value)|auth[ ]+(?:header|value)|api[ ]+key[ ]+(?:used|provided|value)|access[ ]+key[ ]+id|(?:api|private|access|secret|signing|encryption)[ ]+key|[A-Za-z_$][A-Za-z0-9$]*[ ]+(?:token|secret|signature|password|passwd|pwd|pw|pass|passphrase|credential|credentials|cookie|authorization)))(\s*(?:=>|[:=])\s*)|(?<![\w$._-])(?:-+)?(?=([A-Za-z_$][A-Za-z0-9$]*(?:[._-]+[A-Za-z0-9$]+)*))\6(\s*(?:=>|[:=])\s*)|(?<![\w$._-])(-{1,2})([A-Za-z][A-Za-z0-9_-]*)([ \t]+)(?![=])/gi;
const MAX_NESTED_ASSIGNMENT_DEPTH = 8;
const MAX_STRUCTURED_JSON_DEPTH = 128;
const MAX_NESTED_JSON_STRING_DEPTH = 8;

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
    "jwt",
    "sid",
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
    lastWord === "sig" ||
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
    lastWord === "jwt" ||
    lastWord === "sid" ||
    (lastWord === "id" && words[words.length - 2] === "session") ||
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

  let end = start;
  while (end < value.length && !/[&\s"'<>),;}\]]/.test(value[end])) {
    end += 1;
  }
  if (end === start) return null;

  const firstWord = value.slice(start, end);
  if (/^(?:Bearer|Basic)$/i.test(firstWord) && /\s/.test(value[end] ?? "")) {
    while (/\s/.test(value[end] ?? "")) end += 1;
    const credentialStart = end;
    while (end < value.length && !/[&\s"'<>),;}\]]/.test(value[end])) {
      end += 1;
    }
    if (end > credentialStart) return { kind: "bare", end };
  }
  return { kind: "bare", end };
}

function findNextAssignment(
  value: string,
  start: number,
): { index: number; end: number; key: string; prefix: string } | null {
  ASSIGNMENT_PREFIX_PATTERN.lastIndex = start;
  const match = ASSIGNMENT_PREFIX_PATTERN.exec(value);
  if (!match) return null;
  const key = match[2] ?? match[4] ?? match[6] ?? match[9];
  if (!key) return null;
  return {
    index: match.index,
    end: ASSIGNMENT_PREFIX_PATTERN.lastIndex,
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
  let cursor = start;
  while (
    cursor < value.length &&
    value[cursor] !== "\r" &&
    value[cursor] !== "\n"
  ) {
    cursor += 1;
  }
  return cursor;
}

function isQuotedValueStart(value: string, start: number): boolean {
  let cursor = start;
  while (value[cursor] === "\\") cursor += 1;
  return value[cursor] === '"' || value[cursor] === "'";
}

function isStructuredValueStart(value: string, start: number): boolean {
  let cursor = start;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  if (value.startsWith("[redacted]", cursor)) return false;
  return value[cursor] === "{" || value[cursor] === "[";
}

function hasNonWhitespace(value: string, start: number): boolean {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (!/\s/.test(value[cursor])) return true;
  }
  return false;
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

function redactStandalonePemBlocks(value: string): string {
  const privateKeyStart =
    /-----BEGIN ((?:[A-Z0-9][A-Z0-9 -]* )?PRIVATE KEY)-----/g;
  let result = "";
  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    privateKeyStart.lastIndex = searchFrom;
    const match = privateKeyStart.exec(value);
    if (!match) break;
    const blockEnd = findPemBlockEnd(value, match.index);
    if (blockEnd === null) {
      searchFrom = match.index + match[0].length;
      continue;
    }
    result += value.slice(cursor, match.index) + "[redacted]";
    cursor = blockEnd;
    searchFrom = blockEnd;
  }
  return result + value.slice(cursor);
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
          // coercion-ok: Invalid JSON must make the caller redact the entire sensitive tail.
          return null;
        }
        return valueEnd;
      }
    }
  }
  return null;
}

type JsonNode =
  | { kind: "string"; start: number; end: number; value: string }
  | { kind: "array"; start: number; end: number; items: JsonNode[] }
  | {
      kind: "object";
      start: number;
      end: number;
      entries: Array<{ key: string; value: JsonNode }>;
    }
  | { kind: "other"; start: number; end: number };

function skipJsonWhitespace(value: string, start: number): number {
  let cursor = start;
  while (/[\t\n\r ]/.test(value[cursor] ?? "")) cursor += 1;
  return cursor;
}

function parseJsonNode(
  value: string,
  start: number,
  depth = 0,
): JsonNode | null {
  if (depth > MAX_STRUCTURED_JSON_DEPTH) return null;
  const valueStart = skipJsonWhitespace(value, start);
  const first = value[valueStart];
  if (first === '"') {
    let cursor = valueStart + 1;
    while (cursor < value.length) {
      if (value[cursor] === "\\") cursor += 2;
      else if (value[cursor] === '"') {
        const end = cursor + 1;
        try {
          return {
            kind: "string",
            start: valueStart,
            end,
            value: JSON.parse(value.slice(valueStart, end)) as string,
          };
        } catch {
          // coercion-ok: Invalid JSON strings must trigger the caller's sensitive-tail redaction.
          return null;
        }
      } else cursor += 1;
    }
    return null;
  }

  if (first === "{") {
    const entries: Array<{ key: string; value: JsonNode }> = [];
    let cursor = skipJsonWhitespace(value, valueStart + 1);
    if (value[cursor] === "}") {
      return { kind: "object", start: valueStart, end: cursor + 1, entries };
    }
    while (cursor < value.length) {
      const key = parseJsonNode(value, cursor, depth + 1);
      if (!key || key.kind !== "string") return null;
      cursor = skipJsonWhitespace(value, key.end);
      if (value[cursor] !== ":") return null;
      const child = parseJsonNode(value, cursor + 1, depth + 1);
      if (!child) return null;
      entries.push({ key: key.value, value: child });
      cursor = skipJsonWhitespace(value, child.end);
      if (value[cursor] === "}") {
        return { kind: "object", start: valueStart, end: cursor + 1, entries };
      }
      if (value[cursor] !== ",") return null;
      cursor = skipJsonWhitespace(value, cursor + 1);
    }
    return null;
  }

  if (first === "[") {
    const items: JsonNode[] = [];
    let cursor = skipJsonWhitespace(value, valueStart + 1);
    if (value[cursor] === "]") {
      return { kind: "array", start: valueStart, end: cursor + 1, items };
    }
    while (cursor < value.length) {
      const child = parseJsonNode(value, cursor, depth + 1);
      if (!child) return null;
      items.push(child);
      cursor = skipJsonWhitespace(value, child.end);
      if (value[cursor] === "]") {
        return { kind: "array", start: valueStart, end: cursor + 1, items };
      }
      if (value[cursor] !== ",") return null;
      cursor = skipJsonWhitespace(value, cursor + 1);
    }
    return null;
  }

  let end = valueStart;
  while (end < value.length && !/[\s,}\]]/.test(value[end])) end += 1;
  if (end === valueStart) return null;
  try {
    JSON.parse(value.slice(valueStart, end));
    return { kind: "other", start: valueStart, end };
  } catch {
    // coercion-ok: Invalid JSON primitives must trigger the caller's sensitive-tail redaction.
    return null;
  }
}

type JsonReplacement = { start: number; end: number; value: string };

function applyJsonReplacements(
  value: string,
  start: number,
  end: number,
  replacements: JsonReplacement[],
): string {
  replacements.sort((left, right) => left.start - right.start);
  let result = "";
  let replacementCursor = start;
  for (const replacement of replacements) {
    result +=
      value.slice(replacementCursor, replacement.start) + replacement.value;
    replacementCursor = replacement.end;
  }
  return result + value.slice(replacementCursor, end);
}

function parseCompleteJsonValue(value: string): JsonNode | null {
  const start = skipJsonWhitespace(value, 0);
  const node = parseJsonNode(value, start);
  if (!node || skipJsonWhitespace(value, node.end) !== value.length) {
    return null;
  }
  return node;
}

function redactSerializedJsonValue(
  value: string,
  nestedStringDepth: number,
): string | null {
  const node = parseCompleteJsonValue(value);
  if (!node) {
    return hasHarCredentialPairIndicator(value) ? "[redacted]" : null;
  }

  if (node.kind === "string") {
    if (nestedStringDepth >= MAX_NESTED_JSON_STRING_DEPTH) {
      // Deeply encoded JSON is uncommon and cannot be inspected safely without
      // unbounded decoding, so redact the complete value at the depth limit.
      return "[redacted]";
    }
    const nested = redactSerializedJsonValue(node.value, nestedStringDepth + 1);
    return nested === null ? null : JSON.stringify(nested);
  }

  if (node.kind !== "object" && node.kind !== "array") return null;

  const replacements: JsonReplacement[] = [];
  collectHarCredentialReplacements(node, replacements, nestedStringDepth);
  if (replacements.length === 0) return null;
  return (
    value.slice(0, node.start) +
    applyJsonReplacements(value, node.start, node.end, replacements) +
    value.slice(node.end)
  );
}

function collectHarCredentialReplacements(
  node: JsonNode,
  replacements: JsonReplacement[],
  nestedStringDepth = 0,
): void {
  if (node.kind === "string") {
    const redactedValue = redactSerializedJsonValue(
      node.value,
      nestedStringDepth + 1,
    );
    if (redactedValue !== null) {
      replacements.push({
        start: node.start,
        end: node.end,
        value: JSON.stringify(redactedValue),
      });
    }
    return;
  }

  if (node.kind === "object") {
    const label = node.entries.find(
      ({ key, value }) =>
        (key === "name" || key === "key") &&
        value.kind === "string" &&
        isSensitiveAssignmentKey(value.value),
    );
    const pairedValue = node.entries.find(({ key }) => key === "value")?.value;
    if (label && pairedValue) {
      replacements.push({
        start: pairedValue.start,
        end: pairedValue.end,
        value: JSON.stringify("[redacted]"),
      });
    }
    for (const { value } of node.entries) {
      if (value !== pairedValue || !label) {
        collectHarCredentialReplacements(
          value,
          replacements,
          nestedStringDepth,
        );
      }
    }
    return;
  }

  if (node.kind === "array") {
    const [label, pairedValue] = node.items;
    const isHeaderPair =
      node.items.length === 2 &&
      label?.kind === "string" &&
      isSensitiveAssignmentKey(label.value);
    if (isHeaderPair && pairedValue) {
      replacements.push({
        start: pairedValue.start,
        end: pairedValue.end,
        value: JSON.stringify("[redacted]"),
      });
    }
    for (const item of node.items) {
      if (item !== pairedValue || !isHeaderPair) {
        collectHarCredentialReplacements(item, replacements, nestedStringDepth);
      }
    }
  }
}

function hasHarCredentialPairIndicator(value: string): boolean {
  if (!/"value"\s*:/i.test(value)) return false;
  const labelPattern = /"(?:name|key)"\s*:\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(value)) !== null) {
    if (isSensitiveAssignmentKey(match[1])) return true;
  }
  return false;
}

function redactHarCredentialPairs(value: string): string {
  let result = "";
  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const character = value[searchFrom];
    if (character !== "{" && character !== "[") {
      searchFrom += 1;
      continue;
    }

    const node = parseJsonNode(value, searchFrom);
    if (!node) {
      // Malformed containers have no trustworthy boundary; consume the suffix
      // once when it identifies a credential header, including multiline values.
      if (hasHarCredentialPairIndicator(value.slice(searchFrom))) {
        result += value.slice(cursor, searchFrom) + "[redacted]";
        cursor = value.length;
      }
      break;
    }

    const replacements: JsonReplacement[] = [];
    collectHarCredentialReplacements(node, replacements);
    if (replacements.length > 0) {
      result += value.slice(cursor, searchFrom);
      result += applyJsonReplacements(
        value,
        searchFrom,
        node.end,
        replacements,
      );
      cursor = node.end;
    }
    searchFrom = node.end;
  }
  return result + value.slice(cursor);
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
  value = redactHarCredentialPairs(value);
  let result = "";
  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const assignment = findNextAssignment(value, searchFrom);
    if (!assignment) break;
    const isSensitive = isSensitiveAssignmentKey(assignment.key);
    const startsQuotedValue = isQuotedValueStart(value, assignment.end);
    const parsedValue =
      isSensitive || startsQuotedValue
        ? parseAssignmentValue(value, assignment.end)
        : null;
    result += value.slice(cursor, assignment.index) + assignment.prefix;

    const startsStructuredValue = isStructuredValueStart(value, assignment.end);
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
      if (hasNonWhitespace(value, assignment.end)) {
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
    redactStandalonePemBlocks(
      value
        .replace(URL_USERINFO_PATTERN, "$1[redacted]@")
        .replace(URL_PATTERN, "[URL]"),
    ),
  );
}
