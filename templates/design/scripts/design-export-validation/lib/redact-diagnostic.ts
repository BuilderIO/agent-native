const URL_PATTERN = /https?:\/\/[^\s)"'<>]+/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(^|[^\w$])(["']?)([A-Za-z_$][A-Za-z0-9_$.-]*(?:[ _-]+[A-Za-z0-9_$.-]+)*)\2(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:Bearer|Basic)\s+[^&\s"'<>),;}\]]+)|([^&\s"'<>),;}\]]+))/gi;

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
      ["api", "private", "access"].includes(words[words.length - 2]))
  );
}

export function redactExportDiagnostic(value: string): string {
  return value
    .replace(URL_PATTERN, "[URL]")
    .replace(
      SENSITIVE_ASSIGNMENT_PATTERN,
      (
        match,
        boundary: string,
        keyQuote: string,
        key: string,
        separator: string,
        doubleQuotedValue: string | undefined,
        singleQuotedValue: string | undefined,
      ) => {
        if (!isSensitiveAssignmentKey(key)) return match;
        const quote =
          doubleQuotedValue !== undefined
            ? '"'
            : singleQuotedValue !== undefined
              ? "'"
              : "";
        return `${boundary}${keyQuote}${key}${keyQuote}${separator}${quote}[redacted]${quote}`;
      },
    );
}
