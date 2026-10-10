const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(^|[^\w$])(["']?)([A-Za-z_$][A-Za-z0-9_$.-]*(?:[ _-]+[A-Za-z0-9_$.-]+)*)\2(\s*[:=]\s*)(?:(\\"|")((?:\\.|[^"\\])*)(\5)|(\\'|')((?:\\.|[^'\\])*)(\8)|((?:Bearer|Basic)\s+[^&\s"'<>),;}\]]+)|([^&\s"'<>),;}\]]+))/gi;
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
    lastWord === "authorization" ||
    (lastWord === "key" &&
      ["api", "private", "access", "secret"].includes(words[words.length - 2]))
  );
}

function redactAssignments(value: string, depth = 0): string {
  const pattern = new RegExp(SENSITIVE_ASSIGNMENT_PATTERN.source, "gi");
  return value.replace(
    pattern,
    (
      match,
      boundary: string,
      keyQuote: string,
      key: string,
      separator: string,
      doubleOpeningQuote: string | undefined,
      doubleQuotedValue: string | undefined,
      doubleClosingQuote: string | undefined,
      singleOpeningQuote: string | undefined,
      singleQuotedValue: string | undefined,
      singleClosingQuote: string | undefined,
    ) => {
      const openingQuote = doubleOpeningQuote ?? singleOpeningQuote ?? "";
      const closingQuote = doubleClosingQuote ?? singleClosingQuote ?? "";
      const quotedValue = doubleQuotedValue ?? singleQuotedValue;
      const prefix = `${boundary}${keyQuote}${key}${keyQuote}${separator}`;
      if (isSensitiveAssignmentKey(key)) {
        return prefix + openingQuote + "[redacted]" + closingQuote;
      }
      if (quotedValue === undefined) return match;
      if (depth >= MAX_NESTED_ASSIGNMENT_DEPTH) {
        return prefix + openingQuote + "[redacted]" + closingQuote;
      }

      const redactedNestedValue = redactAssignments(quotedValue, depth + 1);
      if (redactedNestedValue === quotedValue) return match;
      return prefix + openingQuote + redactedNestedValue + closingQuote;
    },
  );
}

export function redactExportDiagnostic(value: string): string {
  return redactAssignments(value.replace(URL_PATTERN, "[URL]"));
}
